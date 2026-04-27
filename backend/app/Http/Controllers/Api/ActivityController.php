<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\ReportGroup;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Monitoring\ActivityFeedService;
use App\Services\Reports\UsageProcessingService;
use Illuminate\Http\Request;
use Illuminate\Pagination\LengthAwarePaginator;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Validation\Rule;

class ActivityController extends Controller
{
    public function __construct(
        private readonly ActivityFeedService $activityFeedService,
        private readonly UsageProcessingService $usageProcessingService,
    ) {
    }

    private function canViewAll(?\App\Models\User $user): bool
    {
        return $user && in_array($user->role, ['admin', 'manager'], true);
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
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

        $perPage = (int) $request->get('per_page', 10);
        $perPage = max(1, min($perPage, 10));
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

        if ($request->boolean('processed') || $request->boolean('normalized')) {
            $processedRows = $this->buildProcessedTimelineRows($feed, $usersById);

            $paginator = new LengthAwarePaginator(
                $processedRows->take($perPage)->values(),
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
                $toolType = (string) ($row['tool_type'] ?? 'software');
                $label = (string) ($row['label'] ?? '');
                $rawName = (string) ($row['raw_name'] ?? '');

                return [
                    'id' => (int) ($row['id'] ?? 0),
                    'user_id' => (int) ($row['user_id'] ?? 0),
                    'time_entry_id' => (int) ($row['time_entry_id'] ?? 0),
                    'type' => (string) ($row['type'] ?? 'app'),
                    'name' => $rawName !== '' ? $rawName : ($label !== '' ? $label : 'Unknown'),
                    'duration' => (int) ($row['duration'] ?? 0),
                    'recorded_at' => $this->formatApiTimestamp($recordedAt),
                    'normalized_label' => $label !== '' ? $label : null,
                    'normalized_domain' => $toolType === 'website' && $label !== '' ? $label : null,
                    'software_name' => $toolType === 'software' && $label !== '' ? $label : null,
                    'tool_type' => $toolType,
                    'classification' => (string) ($row['classification'] ?? 'neutral'),
                    'classification_reason' => (string) ($row['classification_reason'] ?? ''),
                    'start_at' => $this->formatApiTimestamp(data_get($row, 'start_at')),
                    'end_at' => $this->formatApiTimestamp(data_get($row, 'end_at')),
                    'user' => $usersById->get((int) ($row['user_id'] ?? 0)),
                    'raw_events_count' => (int) ($row['raw_events_count'] ?? 1),
                ];
            })
            ->values();
    }

    private function isCareVanceWorkspaceRow(array $row): bool
    {
        $label = strtolower(trim((string) ($row['label'] ?? '')));
        $rawName = strtolower(trim((string) ($row['raw_name'] ?? '')));

        return $label === 'carevance' || str_contains($rawName, 'carevance hrms');
    }

    private function formatApiTimestamp(mixed $value): ?string
    {
        if ($value instanceof Carbon) {
            return $value->toIso8601String();
        }

        if ($value === null || $value === '') {
            return null;
        }

        return Carbon::parse((string) $value)->toIso8601String();
    }

    private function mapFeedItemForResponse(object $item, Collection $usersById): array
    {
        $startedAt = $item->started_at ?? null;
        $endedAt = $item->ended_at ?? null;

        return [
            'id' => (int) ($item->id ?? 0),
            'source' => (string) ($item->source ?? 'activity'),
            'user_id' => (int) ($item->user_id ?? 0),
            'time_entry_id' => $item->time_entry_id ? (int) $item->time_entry_id : null,
            'type' => (string) ($item->type ?? 'app'),
            'name' => (string) ($item->name ?? 'Unknown'),
            'duration' => max(0, (int) ($item->duration ?? 0)),
            'recorded_at' => $item->recorded_at instanceof Carbon
                ? $item->recorded_at->toIso8601String()
                : (string) ($item->recorded_at ?? ''),
            'normalized_label' => $item->normalized_label ?? null,
            'normalized_domain' => $item->normalized_domain ?? null,
            'software_name' => $item->software_name ?? null,
            'tool_type' => $item->tool_type ?? null,
            'classification' => $item->classification ?? null,
            'classification_reason' => $item->classification_reason ?? null,
            'app_name' => $item->app_name ?? null,
            'window_title' => $item->window_title ?? null,
            'url' => $item->url ?? null,
            'started_at' => $startedAt instanceof Carbon
                ? $startedAt->toIso8601String()
                : null,
            'ended_at' => $endedAt instanceof Carbon
                ? $endedAt->toIso8601String()
                : null,
            'confidence' => $item->confidence ?? null,
            'metadata' => $item->metadata ?? null,
            'user' => $usersById->get((int) ($item->user_id ?? 0)),
        ];
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
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
        ]);

        if ($request->user()) {
            // Employees can only submit their own telemetry.
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
            ? Carbon::parse((string) $validated['recorded_at'])
            : now();
        $validated['started_at'] = isset($validated['started_at'])
            ? Carbon::parse((string) $validated['started_at'])->startOfSecond()
            : null;
        $validated['last_seen_at'] = isset($validated['last_seen_at'])
            ? Carbon::parse((string) $validated['last_seen_at'])->startOfSecond()
            : null;
        $validated['ended_at'] = isset($validated['ended_at'])
            ? Carbon::parse((string) $validated['ended_at'])->startOfSecond()
            : null;

        $existingActivity = null;

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

            return response()->json($existingActivity, 200);
        }

        $activity = Activity::create($validated);

        return response()->json($activity, 201);
    }

    /**
     * Display the specified resource.
     */
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

    /**
     * Update the specified resource in storage.
     */
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

        $activity->update($validated);

        return response()->json($activity);
    }

    /**
     * Remove the specified resource from storage.
     */
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
