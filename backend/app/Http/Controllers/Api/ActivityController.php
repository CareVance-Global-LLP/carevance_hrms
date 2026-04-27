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
        );
        $feed = $feedPage['items'];
        $total = (int) $feedPage['total'];

        if ($request->boolean('processed')) {
            $processedRows = $this->buildProcessedTimelineRows($feed, $usersById);

            return response()->json(new LengthAwarePaginator(
                $processedRows->take($perPage)->values(),
                $total,
                $perPage,
                $page,
                [
                    'path' => $request->url(),
                    'query' => $request->query(),
                ]
            ));
        }

        $rows = $feed->map(fn (object $item) => $this->mapFeedItemForResponse($item, $usersById))
            ->values();

        return response()->json(new LengthAwarePaginator(
            $rows->take($perPage)->values(),
            $total,
            $perPage,
            $page,
            [
                'path' => $request->url(),
                'query' => $request->query(),
            ]
        ));
    }

    private function buildProcessedTimelineRows(iterable $activities, Collection $usersById): Collection
    {
        return $this->usageProcessingService->buildTimelineRows($activities)
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
                    'recorded_at' => $recordedAt instanceof Carbon
                        ? $recordedAt->toIso8601String()
                        : (string) $recordedAt,
                    'normalized_label' => $label !== '' ? $label : null,
                    'normalized_domain' => $toolType === 'website' && $label !== '' ? $label : null,
                    'software_name' => $toolType === 'software' && $label !== '' ? $label : null,
                    'tool_type' => $toolType,
                    'classification' => (string) ($row['classification'] ?? 'neutral'),
                    'classification_reason' => (string) ($row['classification_reason'] ?? ''),
                    'user' => $usersById->get((int) ($row['user_id'] ?? 0)),
                    'raw_events_count' => (int) ($row['raw_events_count'] ?? 1),
                ];
            })
            ->values();
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
            'app_name' => 'nullable|string|max:255',
            'window_title' => 'nullable|string|max:255',
            'url' => 'nullable|string|max:2048',
            'duration' => 'nullable|integer|min:0',
            'recorded_at' => 'nullable|date',
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

        $validated['duration'] = $validated['duration'] ?? 0;
        $validated['recorded_at'] = $validated['recorded_at'] ?? now();

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
