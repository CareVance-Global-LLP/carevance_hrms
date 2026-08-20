<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\ReportGroup;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\ExternalTimestamp;
use App\Services\Attendance\UserTimezoneResolver;
use App\Services\Monitoring\ActivityFeedService;
use App\Services\Monitoring\IdleResolutionService;
use App\Services\Monitoring\TrackerPolicyResolver;
use App\Services\Reports\UsageProcessingService;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;
use Illuminate\Support\Facades\Log;
use Throwable;

class ActivityController extends Controller
{
    use \App\Http\Controllers\Api\Concerns\GuardsMonitoringConsent;

    public function __construct(
        private readonly ActivityFeedService $activityFeedService,
        private readonly UsageProcessingService $usageProcessingService,
        private readonly IdleResolutionService $idleResolution,
        private readonly TrackerPolicyResolver $trackerPolicy,
    ) {
    }

    /**
     * Apply the organization's idle policy the moment an idle span is recorded.
     *
     * Deliberately server-side. If this lived only in the desktop prompt, then
     * quitting the app, closing the lid or a crash would leave a `never_keep`
     * organization's idle time silently KEPT — the exact opposite of the
     * policy, in a number that TimeEntry duration and payroll are computed
     * from. The client still skips its prompt under these policies;
     * IdleResolutionService is idempotent (it returns early once
     * `idle_resolution` is set), so both paths running cannot deduct the same
     * minutes twice.
     */
    private function applyIdlePolicy(Activity $activity, ?User $actor): void
    {
        if ($activity->type !== 'idle' || $activity->idle_resolution !== null || ! $actor) {
            return;
        }

        $action = match ($this->trackerPolicy->idleResolutionPolicyForUser($actor)) {
            TrackerPolicyResolver::IDLE_POLICY_ALWAYS_KEEP => IdleResolutionService::KEPT,
            TrackerPolicyResolver::IDLE_POLICY_NEVER_KEEP => IdleResolutionService::DISCARDED,
            // prompt: leave it unanswered so the person is the one who decides.
            default => null,
        };

        if ($action === null) {
            return;
        }

        $this->idleResolution->resolve($activity, $actor, $action);
    }

    /**
     * Record what an idle stretch actually was.
     *
     * Only the person it belongs to may answer — a manager deciding on
     * somebody's behalf that they were slacking is exactly the dynamic this
     * prompt exists to remove.
     */
    public function resolveIdle(Request $request, Activity $activity)
    {
        $user = $request->user();
        if (! $user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        if ((int) $activity->user_id !== (int) $user->id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if ($activity->type !== 'idle') {
            return response()->json(['message' => 'That activity is not an idle period.'], 422);
        }

        $validated = $request->validate([
            'action' => 'required|in:kept,discarded',
        ]);

        $result = $this->idleResolution->resolve($activity, $user, $validated['action']);

        return response()->json([
            'message' => $result['resolution'] === \App\Services\Monitoring\IdleResolutionService::KEPT
                ? 'Idle time kept.'
                : 'Idle time discarded.',
            'resolution' => $result['resolution'],
            'seconds_removed' => $result['seconds_removed'],
            'activity' => $activity->fresh(),
        ]);
    }

    private function canViewAll(?\App\Models\User $user): bool
    {
        return $user && in_array($user->role, ['admin', 'manager'], true);
    }

    public function index(Request $request)
    {
        try {
            $user = $request->user();
            if (!$user) {
                return response()->json(['data' => []]);
            }

            $canViewAll = $this->canViewAll($user);
            $groupUserIds = null;
            $selectedGroupIds = collect($request->input('group_ids', []))
                ->map(fn ($id) => (int) $id)
                ->filter(fn ($id) => $id > 0)
                ->unique()
                ->values();

            if ($canViewAll && $selectedGroupIds->isNotEmpty()) {
                $groupUserIds = ReportGroup::query()
                    ->where('organization_id', $user->organization_id)
                    ->whereIn('id', $selectedGroupIds)
                    ->with('users:id')
                    ->get()
                    ->flatMap(fn (ReportGroup $group) => $group->users->pluck('id'))
                    ->map(fn ($id) => (int) $id)
                    ->unique()
                    ->values();

                if ($groupUserIds->isEmpty()) {
                    return response()->json(Activity::query()->whereRaw('1 = 0')->paginate(10));
                }
            }

            $isProcessed = $request->boolean('processed') || $request->boolean('normalized');
            // Processed timeline rows are assembled in memory and sliced, so a
            // larger page is free — it lets the swimlane view load a person-day
            // in one request. Raw feed pagination keeps the tight cap.
            $perPage = (int) $request->get('per_page', 10);
            $perPage = max(1, min($perPage, $isProcessed ? 200 : 10));
            $page = max(1, (int) $request->get('page', 1));

            $scopedUserIds = User::query()
                ->where('organization_id', $user->organization_id)
                ->when(! $canViewAll, fn ($query) => $query->where('id', $user->id))
                ->when($canViewAll && $request->user_id, fn ($query) => $query->where('id', (int) $request->user_id))
                ->when($canViewAll && $groupUserIds !== null, function ($query) use ($groupUserIds, $request) {
                    $selectedUserId = $request->user_id ? (int) $request->user_id : null;
                    if ($selectedUserId) {
                        $query->whereIn('id', $groupUserIds->intersect([$selectedUserId]));
                    } else {
                        $query->whereIn('id', $groupUserIds);
                    }
                })
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->filter(fn ($id) => $id > 0)
                ->values();

            if ($scopedUserIds->isEmpty()) {
                return response()->json(new LengthAwarePaginator(
                    collect(),
                    0,
                    $perPage,
                    $page,
                    [
                        'path' => $request->url(),
                        'query' => $request->query(),
                    ]
                ));
            }

            $startDate = $request->start_date
                ? Carbon::parse((string) $request->start_date)->startOfDay()
                : null;
            $endDate = $request->end_date
                ? Carbon::parse((string) $request->end_date)->endOfDay()
                : null;
            $simplePagination = $request->boolean('simple');

            $usersById = User::query()
                ->whereIn('id', $scopedUserIds)
                ->get(['id', 'name', 'email', 'role'])
                ->mapWithKeys(fn (User $scopedUser) => [
                    (int) $scopedUser->id => [
                        'id' => (int) $scopedUser->id,
                        'name' => $scopedUser->name,
                        'email' => $scopedUser->email,
                        'role' => $scopedUser->role,
                    ],
                ]);

            if ($request->boolean('processed') || $request->boolean('normalized')) {
                $processedRows = $this->filterProcessedTimelineRows(
                    $this->buildProcessedTimelineRows(
                        $this->activityFeedService->forUsersInRange($scopedUserIds, $startDate, $endDate),
                        $usersById,
                    ),
                    $request,
                )->values();
                $total = $processedRows->count();
                $offset = ($page - 1) * $perPage;
                $pageRows = $processedRows->slice($offset, $perPage)->values();
                $hasMore = $processedRows->count() > ($offset + $perPage);

                $paginator = new LengthAwarePaginator(
                    $pageRows,
                    $total,
                    $perPage,
                    $page,
                    [
                        'path' => $request->url(),
                        'query' => $request->query(),
                    ]
                );

                return response()->json($this->withHasMore($paginator, $hasMore));
            }

            $feedPage = $this->activityFeedService->pageForUsersInRange(
                $scopedUserIds,
                $startDate,
                $endDate,
                $page,
                $perPage,
                $request->type ? (string) $request->type : null,
                $request->classification ? (string) $request->classification : null,
                $request->tool_type ? (string) $request->tool_type : null,
                ! $simplePagination,
            );
            $feed = $feedPage['items'];
            $hasMore = (bool) ($feedPage['has_more'] ?? false);
            $total = $feedPage['total'] === null
                ? (($page - 1) * $perPage) + $feed->count() + ($hasMore ? 1 : 0)
                : (int) $feedPage['total'];

            $rows = $feed->map(fn (object $item) => $this->mapFeedItemForResponse($item, $usersById))
                ->values();

            $paginator = new LengthAwarePaginator(
                $rows->take($perPage)->values(),
                $total,
                $perPage,
                $page,
                [
                    'path' => $request->url(),
                    'query' => $request->query(),
                ]
            );

            return response()->json($this->withHasMore($paginator, $hasMore));
        } catch (Throwable $e) {
            Log::error('Activity index error', [
                'error' => $e->getMessage(),
                'user_id' => $request->user()?->id,
            ]);
            return response()->json([
                'data' => [],
                'message' => 'Failed to load timeline data',
                'error' => 'Server error'
            ], 500);
        }
    }

    private function withHasMore(LengthAwarePaginator $paginator, bool $hasMore): array
    {
        $payload = $paginator->toArray();
        $payload['has_more'] = $hasMore;

        return $payload;
    }

    private function buildProcessedTimelineRows(iterable $activities, Collection $usersById): Collection
    {
        return $this->usageProcessingService->buildTimelineRows($activities)
            ->reject(fn (array $row) => $this->isCareVanceWorkspaceRow($row))
            ->map(function (array $row) use ($usersById) {
                $recordedAt = data_get($row, 'recorded_at');
                $rowUserId = (int) ($row['user_id'] ?? 0);
                $toolType = (string) ($row['tool_type'] ?? 'software');
                $label = (string) ($row['label'] ?? '');
                $rawName = (string) ($row['raw_name'] ?? '');

                return [
                    'id' => (int) ($row['id'] ?? 0),
                    'user_id' => (int) ($row['user_id'] ?? 0),
                    'time_entry_id' => (int) ($row['time_entry_id'] ?? 0),
                    'type' => (string) ($row['type'] ?? 'app'),
                    // Sanitised: a processed row is named from the raw name, which
                    // for a website row is the address it was captured at.
                    'name' => $this->stripUrlSecrets($rawName !== '' ? $rawName : ($label !== '' ? $label : 'Unknown')),
                    'duration' => (int) ($row['duration'] ?? 0),
                    'recorded_at' => $this->formatApiTimestamp($recordedAt, $rowUserId),
                    'normalized_label' => $label !== '' ? $label : null,
                    'normalized_domain' => $toolType === 'website' && $label !== '' ? $label : null,
                    'software_name' => $toolType === 'software' && $label !== '' ? $label : null,
                    'tool_type' => $toolType,
                    'classification' => (string) ($row['classification'] ?? 'neutral'),
                    'classification_reason' => (string) ($row['classification_reason'] ?? ''),
                    'start_at' => $this->formatApiTimestamp(data_get($row, 'start_at'), $rowUserId),
                    'end_at' => $this->formatApiTimestamp(data_get($row, 'end_at'), $rowUserId),
                    // The timestamps above already carry this employee's own
                    // offset, but an offset is not a zone: a client cannot
                    // label "+08:00" as Manila. Without the name a viewer in
                    // Mumbai sees a colleague's 09:00 start drawn at 05:30 and
                    // nothing on screen explains why.
                    'timezone' => $this->timezoneForUser($rowUserId),
                    'user' => $usersById->get((int) ($row['user_id'] ?? 0)),
                    'raw_events_count' => (int) ($row['raw_events_count'] ?? 1),
                ];
            })
            ->values();
    }

    private function filterProcessedTimelineRows(Collection $rows, Request $request): Collection
    {
        $type = strtolower(trim((string) $request->input('type', '')));
        $classification = strtolower(trim((string) $request->input('classification', '')));
        $toolType = strtolower(trim((string) $request->input('tool_type', '')));

        return $rows
            ->when($type !== '', fn (Collection $items) => $items->filter(
                fn (array $row) => strtolower((string) ($row['type'] ?? '')) === $type
            ))
            ->when($classification !== '', fn (Collection $items) => $items->filter(
                fn (array $row) => strtolower((string) ($row['classification'] ?? '')) === $classification
            ))
            ->when($toolType !== '', fn (Collection $items) => $items->filter(
                fn (array $row) => strtolower((string) ($row['tool_type'] ?? '')) === $toolType
            ))
            ->values();
    }

    /**
     * Strip the parts of a URL that carry secrets rather than describe a page.
     *
     * The mirror of `stripUrlSecrets` in the desktop agent's
     * normalize-captured-url.cjs, applied here at the point of DISPLAY because
     * the agent-side rule only protects rows written after it shipped
     * (17 Aug 2026). Rows recorded before it are still in the database and were
     * still being rendered in full: read out of this install 20 Aug 2026, the
     * timeline was showing two complete OAuth callbacks — a live `code`, plus
     * `state` — to every admin who opened the page.
     *
     * A query string is where single-use credentials live and nothing in a
     * productivity report needs it; the path already says which page somebody
     * was on. The fragment is kept, because hash routing puts the real page
     * there (`#/me/attendance`), unless it carries `key=value` pairs, which is
     * how the OAuth implicit flow returns `access_token`. Userinfo goes too:
     * `https://user:password@host` must never reach a report.
     *
     * Anything that is not a URL is returned untouched — most names are a
     * window title, not an address.
     */
    private function stripUrlSecrets(?string $value): string
    {
        $value = trim((string) $value);
        if ($value === '' || ! preg_match('#^[a-z][a-z0-9+.-]*://#i', $value)) {
            return $value;
        }

        $parts = parse_url($value);
        if ($parts === false || empty($parts['scheme']) || empty($parts['host'])) {
            return $value;
        }

        $host = $parts['host'].(isset($parts['port']) ? ':'.$parts['port'] : '');
        $fragment = isset($parts['fragment']) && ! str_contains($parts['fragment'], '=')
            ? '#'.$parts['fragment']
            : '';

        return $parts['scheme'].'://'.$host.($parts['path'] ?? '').$fragment;
    }

    private function isCareVanceWorkspaceRow(array $row): bool
    {
        // Idle records must always be visible in the timeline even if their
        // label/name mentions CareVance HRMS (e.g. "System Idle - CareVance HRMS
        // Workspace"). Reports correctly count this idle time, so hiding it
        // here would create the 48-min-report / 0-entries mismatch.
        if (($row['type'] ?? null) === 'idle' || ($row['tool_type'] ?? null) === 'idle') {
            return false;
        }

        $label = strtolower(trim((string) ($row['label'] ?? '')));
        $rawName = strtolower(trim((string) ($row['raw_name'] ?? '')));
        /*
         * The window title is checked as well as the name, because the name is
         * no longer guaranteed to mention the product.
         *
         * A website row is named after its SITE now, so the workspace opened in
         * a browser reaches here as "carevancetracker.duckdns.org" — which
         * matches neither test above, and every workspace row reappeared in the
         * timeline. The title still says "CareVance HRMS Workspace", which is
         * the same evidence this rule was always relying on, just read from the
         * field that still carries it.
         */
        $windowTitle = strtolower(trim((string) ($row['window_title'] ?? '')));

        return $label === 'carevance'
            || str_contains($rawName, 'carevance hrms')
            || str_contains($windowTitle, 'carevance hrms');
    }

    /**
     * Render an instant in the wall clock of the person the row belongs to.
     *
     * Timeline rows are per-employee, so `config('app.timezone')` was only ever
     * right for tenants who happen to sit in the app's default zone. Everyone
     * else read their own day shifted by the offset between the two.
     *
     * A null/0 $userId means no user is in scope and falls back to the app
     * timezone through UserTimezoneResolver.
     */
    private function formatApiTimestamp(mixed $value, ?int $userId = null): ?string
    {
        if ($value === null || $value === '') {
            return null;
        }

        return ExternalTimestamp::parseToUserTimezone($value, $userId)?->toIso8601String();
    }

    /**
     * The IANA zone a row's timestamps were rendered in, so the client can
     * label them. Same resolution the timestamps went through, so the name and
     * the offset can never disagree.
     */
    private function timezoneForUser(?int $userId): string
    {
        return app(UserTimezoneResolver::class)->forUserId($userId > 0 ? $userId : null);
    }

    private function mapFeedItemForResponse(object $item, Collection $usersById): array
    {
        $startedAt = $item->started_at ?? null;
        $endedAt = $item->ended_at ?? null;
        // Same reasoning as the processed rows: a feed row belongs to one
        // person, so it is rendered in that person's wall clock.
        $itemUserId = (int) ($item->user_id ?? 0);

        return [
            'id' => (int) ($item->id ?? 0),
            'source' => (string) ($item->source ?? 'activity'),
            'user_id' => (int) ($item->user_id ?? 0),
            'time_entry_id' => $item->time_entry_id ? (int) $item->time_entry_id : null,
            'type' => (string) ($item->type ?? 'app'),
            'name' => $this->stripUrlSecrets((string) ($item->name ?? 'Unknown')),
            'duration' => max(0, (int) ($item->duration ?? 0)),
            'recorded_at' => $item->recorded_at instanceof Carbon
                ? (string) $this->formatApiTimestamp($item->recorded_at, $itemUserId)
                : (string) ($item->recorded_at ?? ''),
            'normalized_label' => $item->normalized_label ?? null,
            'normalized_domain' => $item->normalized_domain ?? null,
            'software_name' => $item->software_name ?? null,
            'tool_type' => $item->tool_type ?? null,
            'classification' => $item->classification ?? null,
            'classification_reason' => $item->classification_reason ?? null,
            'app_name' => $item->app_name ?? null,
            'window_title' => $item->window_title ?? null,
            // `?? null` rather than a `=== null` test: not every feed item even
            // declares the property, and reading an undefined one is a fatal
            // here, not a null.
            'url' => ($item->url ?? null) === null ? null : $this->stripUrlSecrets((string) $item->url),
            'started_at' => $startedAt instanceof Carbon
                ? $this->formatApiTimestamp($startedAt, $itemUserId)
                : null,
            'ended_at' => $endedAt instanceof Carbon
                ? $this->formatApiTimestamp($endedAt, $itemUserId)
                : null,
            'confidence' => $item->confidence ?? null,
            'metadata' => $item->metadata ?? null,
            'user' => $usersById->get((int) ($item->user_id ?? 0)),
        ];
    }

    public function store(Request $request)
    {
        // Application names, window titles and URLs are a record of what a
        // person did all day. Refused before it is read, not after it is
        // stored.
        if ($refusal = $this->refuseIfCaptureNotConsented($request->user(), 'activity')) {
            return $refusal;
        }

        $validated = $request->validate([
            'user_id' => 'nullable|exists:users,id',
            'time_entry_id' => 'nullable|exists:time_entries,id',
            'type' => 'required|in:app,url,idle',
            'name' => 'required|string|max:255',
            'session_key' => 'nullable|string|max:120',
            'app_name' => 'nullable|string|max:255',
            'window_title' => 'nullable|string|max:255',
            'url' => 'nullable|string|max:2048',
            'duration' => 'nullable|numeric|min:0',
            'recorded_at' => 'nullable|date',
            'started_at' => 'nullable|date',
            'last_seen_at' => 'nullable|date',
            'ended_at' => 'nullable|date',
            // Sent by the desktop tracker when replaying its offline queue.
            'local_id' => 'nullable|string|max:120',
            'device_id' => 'nullable|string|max:120',
        ]);

        if ($request->user()) {
            $validated['user_id'] = $request->user()->id;
        }

        if (!empty($validated['time_entry_id'])) {
            $timeEntryBelongsToUser = TimeEntry::whereKey($validated['time_entry_id'])
                ->where('user_id', $validated['user_id'])
                ->exists();

            if (!$timeEntryBelongsToUser) {
                return response()->json(['message' => 'Selected time entry is invalid for this user.'], 422);
            }
        }

        $validated['duration'] = max(0, (int) floor((float) ($validated['duration'] ?? 0)));
        $validated['recorded_at'] = isset($validated['recorded_at'])
            ? ExternalTimestamp::parseToAppTimezone($validated['recorded_at'])
            : now();
        $validated['started_at'] = isset($validated['started_at'])
            ? ExternalTimestamp::parseToAppTimezone($validated['started_at'])?->startOfSecond()
            : null;
        $validated['last_seen_at'] = isset($validated['last_seen_at'])
            ? ExternalTimestamp::parseToAppTimezone($validated['last_seen_at'])?->startOfSecond()
            : null;
        $validated['ended_at'] = isset($validated['ended_at'])
            ? ExternalTimestamp::parseToAppTimezone($validated['ended_at'])?->startOfSecond()
            : null;

        $existingActivity = null;

        // Offline replay wins over every other match. The desktop queue retries
        // a record until the server acknowledges it, so an acknowledgement lost
        // in transit brings the same (device_id, local_id) back — and without
        // this it would fall through to the heuristics below, which only catch
        // a duplicate within a 5-second window and would happily insert a
        // second row for a punch replayed hours later.
        if (!empty($validated['local_id']) && !empty($validated['device_id'])) {
            $existingActivity = Activity::query()
                ->where('local_id', $validated['local_id'])
                ->where('device_id', $validated['device_id'])
                ->first();

            if ($existingActivity) {
                return response()->json($existingActivity, 200);
            }
        }

        if (!empty($validated['session_key'])) {
            $existingActivity = Activity::query()
                ->where('user_id', $validated['user_id'])
                ->where('session_key', $validated['session_key'])
                ->first();
        }

        if (!$existingActivity) {
            $existingActivity = Activity::query()
                ->where('user_id', $validated['user_id'])
                ->where('time_entry_id', $validated['time_entry_id'] ?? null)
                ->where('type', $validated['type'])
                ->where('name', $validated['name'])
                ->whereBetween('recorded_at', [
                    $validated['recorded_at']->copy()->subSeconds(5),
                    $validated['recorded_at']->copy()->addSeconds(5),
                ])
                ->orderByDesc('recorded_at')
                ->first();
        }

        if ($existingActivity) {
            $existingActivity->fill([
                'time_entry_id' => $validated['time_entry_id'] ?? $existingActivity->time_entry_id,
                'session_key' => $validated['session_key'] ?? $existingActivity->session_key,
                // Stamp the offline key onto the row the heuristics merged into,
                // so a later replay of the same capture resolves by key instead
                // of falling through to the 5-second window again.
                'local_id' => $validated['local_id'] ?? $existingActivity->local_id,
                'device_id' => $validated['device_id'] ?? $existingActivity->device_id,
                'type' => $validated['type'],
                'name' => $validated['name'],
                'app_name' => $validated['app_name'] ?? $existingActivity->app_name,
                'window_title' => $validated['window_title'] ?? $existingActivity->window_title,
                'url' => $validated['url'] ?? $existingActivity->url,
                'duration' => max((int) $existingActivity->duration, $validated['duration']),
                'recorded_at' => $validated['recorded_at']->greaterThan($existingActivity->recorded_at)
                    ? $validated['recorded_at']
                    : $existingActivity->recorded_at,
                'started_at' => $validated['started_at']
                    ? ($existingActivity->started_at
                        ? $existingActivity->started_at->copy()->min($validated['started_at'])
                        : $validated['started_at'])
                    : $existingActivity->started_at,
                'last_seen_at' => $validated['last_seen_at']
                    ? ($existingActivity->last_seen_at
                        ? $existingActivity->last_seen_at->copy()->max($validated['last_seen_at'])
                        : $validated['last_seen_at'])
                    : $existingActivity->last_seen_at,
                'ended_at' => $validated['ended_at']
                    ? ($existingActivity->ended_at
                        ? $existingActivity->ended_at->copy()->max($validated['ended_at'])
                        : $validated['ended_at'])
                    : $existingActivity->ended_at,
            ]);
            $existingActivity->save();

            // Bust idle cache so reports pick up fresh idle durations immediately
            if (($validated['type'] ?? '') === 'idle') {
                $this->usageProcessingService->bustIdleCacheForUser(
                    (int) $validated['user_id'],
                    $validated['recorded_at'] instanceof Carbon ? $validated['recorded_at'] : now(),
                );
            }

            return response()->json($existingActivity, 200);
        }

        try {
            $activity = Activity::create($validated);
        } catch (\Illuminate\Database\QueryException $e) {
            // Two retries of the same queued record can clear the check above
            // concurrently; the unique index is what actually decides. Losing
            // that race is a successful sync, not an error.
            $activity = !empty($validated['local_id']) && !empty($validated['device_id'])
                ? Activity::query()
                    ->where('local_id', $validated['local_id'])
                    ->where('device_id', $validated['device_id'])
                    ->first()
                : null;

            if (!$activity) {
                throw $e;
            }

            return response()->json($activity, 200);
        }

        // Bust idle cache so reports pick up fresh idle durations immediately
        if (($validated['type'] ?? '') === 'idle') {
            $this->applyIdlePolicy($activity, $request->user());
            $this->usageProcessingService->bustIdleCacheForUser(
                (int) $validated['user_id'],
                $validated['recorded_at'] instanceof Carbon ? $validated['recorded_at'] : now(),
            );
        }

        return response()->json($activity->fresh(), 201);
    }

    public function show(Activity $activity)
    {
        $requestUser = request()->user();
        if (!$requestUser) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($activity->user?->organization_id !== $requestUser->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if (!$this->canViewAll($requestUser) && $activity->user_id !== $requestUser->id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json($activity);
    }

    public function update(Request $request, Activity $activity)
    {
        $requestUser = $request->user();
        if (!$requestUser) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($activity->user?->organization_id !== $requestUser->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if (!$this->canViewAll($requestUser) && $activity->user_id !== $requestUser->id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $validated = $request->validate([
            'time_entry_id' => 'nullable|exists:time_entries,id',
            'type' => 'sometimes|in:app,url,idle',
            'name' => 'sometimes|string|max:255',
            'app_name' => 'nullable|string|max:255',
            'window_title' => 'nullable|string|max:255',
            'url' => 'nullable|string|max:2048',
            'duration' => 'nullable|integer|min:0',
            'recorded_at' => 'nullable|date',
        ]);

        if (array_key_exists('time_entry_id', $validated) && !empty($validated['time_entry_id'])) {
            $timeEntryBelongsToUser = TimeEntry::whereKey($validated['time_entry_id'])
                ->where('user_id', $activity->user_id)
                ->exists();

            if (!$timeEntryBelongsToUser) {
                return response()->json(['message' => 'Selected time entry is invalid for this user.'], 422);
            }
        }

        if (array_key_exists('recorded_at', $validated)) {
            $validated['recorded_at'] = ExternalTimestamp::parseToAppTimezone($validated['recorded_at']);
        }

        $activity->update($validated);

        // Bust idle cache so reports pick up fresh idle durations immediately
        if (($validated['type'] ?? $activity->type) === 'idle') {
            $this->usageProcessingService->bustIdleCacheForUser(
                (int) $activity->user_id,
                isset($validated['recorded_at']) && $validated['recorded_at'] instanceof Carbon
                    ? $validated['recorded_at']
                    : ($activity->recorded_at ?? now()),
            );
        }

        return response()->json($activity);
    }

    public function destroy(Activity $activity)
    {
        $requestUser = request()->user();
        if (!$requestUser) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($activity->user?->organization_id !== $requestUser->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if (!$this->canViewAll($requestUser) && $activity->user_id !== $requestUser->id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $activity->delete();

        return response()->json(['message' => 'Activity deleted successfully']);
    }
}
