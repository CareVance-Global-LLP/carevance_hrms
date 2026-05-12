<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendanceHoliday;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\BrowserTrackingConnection;
use App\Models\LeaveRequest;
use App\Models\Project;
use App\Models\ReportGroup;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Monitoring\ActivityFeedService;
use App\Services\Reports\ActivityProductivityService;
use App\Services\Reports\DashboardSummaryService;
use App\Services\Reports\ReportPayloadBuilder;
use App\Services\Reports\TimeBreakdownService;
use App\Services\Reports\UsageProcessingService;
use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Throwable;

class ReportController extends Controller
{
    private const LIVE_MONITORING_UTILITY_TOOL_LABELS = [
        'snippingtool.exe',
        'snipping tool',
        'windows explorer',
        'windows shell experience host',
        'searchhost.exe',
        'startmenuexperiencehost.exe',
        'shellexperiencehost.exe',
    ];

    private const LIVE_MONITORING_MEANINGFUL_ACTIVITY_WINDOW_SECONDS = 120;

    public function __construct(
        private readonly ActivityProductivityService $activityProductivityService,
        private readonly DashboardSummaryService $dashboardSummaryService,
        private readonly ReportPayloadBuilder $reportPayloadBuilder,
        private readonly TimeBreakdownService $timeBreakdownService,
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly UsageProcessingService $usageProcessingService,
        private readonly ActivityFeedService $activityFeedService,
    ) {
    }

    private function canViewAll(?User $user): bool
    {
        return $user && in_array($user->role, ['admin', 'manager'], true);
    }

    private function canViewOrganization(?User $user): bool
    {
        return $user?->role === 'admin';
    }

    private function restrictMonitoringToEmployees(?User $user): bool
    {
        return $user?->role === 'manager';
    }

    private function managerGroupIds(User $user): array
    {
        return $user->groups()
            ->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function visibleUsersQuery(User $user, bool $employeesOnlyForManager = false): Builder
    {
        $query = User::query()->where('organization_id', $user->organization_id);

        if ($user->role === 'admin') {
            return $query;
        }

        if ($user->role === 'manager') {
            $groupIds = $this->managerGroupIds($user);
            if ($groupIds === []) {
                return User::query()->whereRaw('1 = 0');
            }

            if ($employeesOnlyForManager) {
                $query->where('role', 'employee');
            }

            return $query->whereHas('groups', fn (Builder $groupQuery) => $groupQuery->whereIn('groups.id', $groupIds));
        }

        return $query->whereKey($user->id);
    }

    private function visibleUserIds(?User $user, bool $employeesOnlyForManager = false): Collection
    {
        if (!$user || !$user->organization_id) {
            return collect();
        }

        return $this->visibleUsersQuery($user, $employeesOnlyForManager)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values();
    }

    private function summarizeBrowserTrackingConnections(Collection $connections): array
    {
        if ($connections->isEmpty()) {
            return [
                'status' => 'disconnected',
                'device_label' => null,
                'connection_count' => 0,
                'connected_connections' => 0,
                'browsers' => [],
                'last_seen_at' => null,
                'last_sync_at' => null,
                'disconnect_reason' => 'not_paired',
                'needs_attention' => true,
                'is_exact_tracking_active' => false,
            ];
        }

        $sortedConnections = $connections
            ->sortByDesc(function (BrowserTrackingConnection $connection) {
                $sortTimestamp = $connection->last_seen_at
                    ?? $connection->last_sync_at
                    ?? $connection->disconnected_at
                    ?? $connection->connected_at
                    ?? $connection->updated_at
                    ?? $connection->created_at;

                return $sortTimestamp ? Carbon::parse($sortTimestamp)->getTimestamp() : 0;
            })
            ->values();

        $latestConnection = $sortedConnections->first();
        $connectedConnections = $sortedConnections
            ->filter(fn (BrowserTrackingConnection $connection) => (string) $connection->status === 'connected')
            ->values();
        $primaryConnection = $connectedConnections->first() ?: $latestConnection;

        return [
            'status' => $connectedConnections->isNotEmpty()
                ? 'connected'
                : (string) ($latestConnection?->status ?: 'unknown'),
            'device_label' => $primaryConnection?->device_label,
            'connection_count' => $sortedConnections->count(),
            'connected_connections' => $connectedConnections->count(),
            'browsers' => $sortedConnections
                ->pluck('browser_name')
                ->filter()
                ->map(fn ($browserName) => strtolower((string) $browserName))
                ->unique()
                ->values()
                ->all(),
            'last_seen_at' => optional($primaryConnection?->last_seen_at)->toIso8601String(),
            'last_sync_at' => optional($latestConnection?->last_sync_at)->toIso8601String(),
            'disconnect_reason' => $connectedConnections->isNotEmpty()
                ? null
                : $latestConnection?->disconnect_reason,
            'needs_attention' => $connectedConnections->isEmpty()
                && in_array((string) ($latestConnection?->status ?: ''), ['disconnected', 'disabled'], true),
            'is_exact_tracking_active' => $connectedConnections->isNotEmpty(),
        ];
    }

    private function isLiveMonitoringUtilityActivity(?object $activity): bool
    {
        if (! $activity) {
            return false;
        }

        $toolType = strtolower(trim((string) ($activity->tool_type ?? '')));
        $activityType = strtolower(trim((string) ($activity->type ?? '')));

        if ($toolType === 'website' || $activityType === 'url') {
            return false;
        }

        $candidates = [
            (string) ($activity->normalized_label ?? ''),
            (string) ($activity->software_name ?? ''),
            (string) ($activity->display_name ?? ''),
            (string) ($activity->app_name ?? ''),
            (string) ($activity->name ?? ''),
        ];

        foreach ($candidates as $candidate) {
            $normalized = strtolower(trim($candidate));
            if ($normalized === '') {
                continue;
            }

            if (in_array($normalized, self::LIVE_MONITORING_UTILITY_TOOL_LABELS, true)) {
                return true;
            }
        }

        return false;
    }

    private function selectPreferredLiveMonitoringActivity(Collection $activities): ?object
    {
        if ($activities->isEmpty()) {
            return null;
        }

        $sorted = $activities
            ->filter(fn ($activity) => isset($activity->recorded_at))
            ->sort(function ($left, $right) {
                $recordedAtComparison = $this->compareLiveMonitoringActivityTimestamps(
                    $right->recorded_at ?? null,
                    $left->recorded_at ?? null,
                );

                if ($recordedAtComparison !== 0) {
                    return $recordedAtComparison;
                }

                $startedAtComparison = $this->compareLiveMonitoringActivityTimestamps(
                    $right->started_at ?? null,
                    $left->started_at ?? null,
                );

                if ($startedAtComparison !== 0) {
                    return $startedAtComparison;
                }

                return (int) ($right->id ?? 0) <=> (int) ($left->id ?? 0);
            })
            ->values();

        $latest = $sorted->first();
        if (! $latest) {
            return null;
        }

        if (! $this->isLiveMonitoringUtilityActivity($latest)) {
            return $latest;
        }

        $latestTimestamp = Carbon::parse((string) $latest->recorded_at);
        $preferredMeaningful = $sorted->first(function ($activity) use ($latestTimestamp) {
            if ($this->isLiveMonitoringUtilityActivity($activity)) {
                return false;
            }

            $activityTimestamp = Carbon::parse((string) $activity->recorded_at);
            return $latestTimestamp->diffInSeconds($activityTimestamp) <= self::LIVE_MONITORING_MEANINGFUL_ACTIVITY_WINDOW_SECONDS;
        });

        return $preferredMeaningful ?: $latest;
    }

    private function compareLiveMonitoringActivityTimestamps(mixed $left, mixed $right): int
    {
        $leftTimestamp = $left ? Carbon::parse((string) $left)->getTimestamp() : 0;
        $rightTimestamp = $right ? Carbon::parse((string) $right)->getTimestamp() : 0;

        return $leftTimestamp <=> $rightTimestamp;
    }

    private function shouldPreferDesktopWindowTitle(?string $appName, ?string $windowTitle): bool
    {
        $normalizedAppName = strtolower(trim((string) $appName));
        $normalizedWindowTitle = strtolower(trim((string) $windowTitle));

        if ($normalizedWindowTitle === '') {
            return false;
        }

        foreach (['explorer.exe', 'windows explorer', 'file explorer'] as $keyword) {
            if (str_contains($normalizedAppName, $keyword)) {
                return true;
            }
        }

        return false;
    }

    private function resolveLiveMonitoringToolLabel(?object $activity, array $toolDescriptor = []): ?string
    {
        if (! $activity) {
            return null;
        }

        $toolType = strtolower(trim((string) ($activity->tool_type ?? '')));
        $activityType = strtolower(trim((string) ($activity->type ?? 'app')));

        if ($toolType === 'website' || $activityType === 'url') {
            foreach ([
                $activity->normalized_domain ?? null,
                $activity->normalized_label ?? null,
                $toolDescriptor['label'] ?? null,
                $activity->name ?? null,
                $activity->url ?? null,
            ] as $candidate) {
                $value = trim((string) $candidate);
                if ($value !== '') {
                    return $value;
                }
            }

            return null;
        }

        $appName = trim((string) ($activity->app_name ?? ''));
        $windowTitle = trim((string) ($activity->window_title ?? ''));

        if ($this->shouldPreferDesktopWindowTitle($appName, $windowTitle)) {
            return $windowTitle;
        }

        foreach ([
            $activity->display_name ?? null,
            $activity->app_name ?? null,
            $activity->name ?? null,
            $activity->window_title ?? null,
            $activity->software_name ?? null,
            $activity->normalized_label ?? null,
            $toolDescriptor['label'] ?? null,
        ] as $candidate) {
            $value = trim((string) $candidate);
            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    private function calculateAttendanceWorkedSeconds(AttendanceRecord $record): int
    {
        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        $closedWorkedSeconds = (int) $record->punches
            ->filter(fn (AttendancePunch $punch) => (bool) $punch->punch_out_at)
            ->sum(fn (AttendancePunch $punch) => max(
                (int) $punch->worked_seconds,
                (int) Carbon::parse($punch->punch_in_at)->diffInSeconds(Carbon::parse($punch->punch_out_at))
            ));

        $openWorkedSeconds = 0;
        $openPunch = $record->punches->first(fn (AttendancePunch $punch) => !$punch->punch_out_at);
        if ($openPunch) {
            $openWorkedSeconds = max(0, Carbon::parse($openPunch->punch_in_at)->diffInSeconds(now()));
        } elseif ($record->check_in_at && !$record->check_out_at) {
            // Fall back to the attendance record timestamps when an open punch row is missing
            // or has not been hydrated as expected. This keeps live worked time visible in reports.
            $openWorkedSeconds = max(0, Carbon::parse($record->check_in_at)->diffInSeconds(now()));
        }

        return (int) max(
            0,
            $closedWorkedSeconds + $openWorkedSeconds + (int) ($record->manual_adjustment_seconds ?? 0)
        );
    }

    private function buildOverallAttendanceSummary(Collection $attendanceRecords, int $calendarDaysCount): array
    {
        $safeCalendarDaysCount = max(1, $calendarDaysCount);
        $presentDates = $attendanceRecords
            ->filter(fn (AttendanceRecord $record) => (bool) $record->check_in_at)
            ->map(fn (AttendanceRecord $record) => Carbon::parse((string) $record->attendance_date)->toDateString())
            ->filter()
            ->unique()
            ->values();
        $firstCheckInTimestamp = $attendanceRecords
            ->filter(fn (AttendanceRecord $record) => (bool) $record->check_in_at)
            ->map(fn (AttendanceRecord $record) => Carbon::parse((string) $record->check_in_at)->getTimestamp())
            ->filter(fn ($timestamp) => is_int($timestamp) && $timestamp > 0)
            ->min();
        $lastCheckOutTimestamp = $attendanceRecords
            ->filter(fn (AttendanceRecord $record) => (bool) $record->check_out_at)
            ->map(fn (AttendanceRecord $record) => Carbon::parse((string) $record->check_out_at)->getTimestamp())
            ->filter(fn ($timestamp) => is_int($timestamp) && $timestamp > 0)
            ->max();

        return [
            'attendance_days_present' => $presentDates->count(),
            'attendance_days_in_range' => $safeCalendarDaysCount,
            'attendance_rate' => (float) round(($presentDates->count() / $safeCalendarDaysCount) * 100, 2),
            'first_check_in_at' => $firstCheckInTimestamp
                ? Carbon::createFromTimestamp($firstCheckInTimestamp)->toIso8601String()
                : null,
            'last_check_out_at' => $lastCheckOutTimestamp
                ? Carbon::createFromTimestamp($lastCheckOutTimestamp)->toIso8601String()
                : null,
        ];
    }

    private function limitToolBreakdown(array $toolBreakdown, int $limit = 10): array
    {
        return [
            'productive' => collect($toolBreakdown['productive'] ?? [])->take($limit)->values()->all(),
            'unproductive' => collect($toolBreakdown['unproductive'] ?? [])->take($limit)->values()->all(),
            'neutral' => collect($toolBreakdown['neutral'] ?? [])->take($limit)->values()->all(),
            'context_dependent' => collect($toolBreakdown['context_dependent'] ?? [])->take($limit)->values()->all(),
        ];
    }

    private function safeCalculateIdleTime(iterable $activities, array $context = []): int
    {
        try {
            return $this->usageProcessingService->calculateIdleTime($activities);
        } catch (Throwable $exception) {
            Log::warning('Idle time calculation failed for report request; falling back to 0.', [
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
                'context' => $context,
            ]);

            return 0;
        }
    }

    public function dashboard(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        return response()->json($this->dashboardSummaryService->build($user));
    }

    public function daily(Request $request)
    {
        $date = $request->get('date', Carbon::today()->toDateString());
        $scope = $request->get('scope', 'self');

        $user = $request->user();
        if (!$user) {
            return response()->json($this->reportPayloadBuilder->emptyReport(['date' => $date]));
        }

        $query = TimeEntry::with('project', 'task', 'user')
            ->whereDate('start_time', $date)
            ->orderBy('start_time', 'desc');

        if ($this->canViewAll($user) && $scope === 'organization' && $user->organization_id) {
            $query->whereIn('user_id', $this->visibleUserIds($user));
        } else {
            $query->where('user_id', $user->id);
        }

        $timeEntries = $query->get();

        return response()->json(array_merge(
            ['date' => $date],
            $this->reportPayloadBuilder->buildCommonReportPayload($timeEntries)
        ));
    }

    public function weekly(Request $request)
    {
        $scope = $request->get('scope', 'self');
        $startDate = Carbon::parse($request->get('start_date', Carbon::now()->startOfWeek()->toDateString()))->startOfDay();
        $endDate = Carbon::parse($request->get('end_date', Carbon::now()->endOfWeek()->toDateString()))->endOfDay();

        $user = $request->user();
        if (!$user) {
            return response()->json($this->reportPayloadBuilder->emptyReport([
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
            ]));
        }

        $query = TimeEntry::with('project', 'task', 'user')
            ->whereBetween('start_time', [$startDate, $endDate])
            ->orderBy('start_time', 'desc');

        if ($this->canViewAll($user) && $scope === 'organization' && $user->organization_id) {
            $query->whereIn('user_id', $this->visibleUserIds($user));
        } else {
            $query->where('user_id', $user->id);
        }

        $timeEntries = $query->get();

        return response()->json(array_merge(
            [
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
            ],
            $this->reportPayloadBuilder->buildCommonReportPayload($timeEntries)
        ));
    }

    public function monthly(Request $request)
    {
        $scope = $request->get('scope', 'self');
        $startDate = $request->get('start_date');
        $endDate = $request->get('end_date');

        if (!$startDate || !$endDate) {
            $date = Carbon::now();
            $startDate = $date->copy()->startOfMonth()->toDateString();
            $endDate = $date->copy()->endOfMonth()->toDateString();
        }
        $startDate = Carbon::parse($startDate)->startOfDay();
        $endDate = Carbon::parse($endDate)->endOfDay();

        $user = $request->user();
        if (!$user) {
            return response()->json($this->reportPayloadBuilder->emptyReport([
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
            ]));
        }

        $query = TimeEntry::with('project', 'task', 'user')
            ->whereBetween('start_time', [$startDate, $endDate])
            ->orderBy('start_time', 'desc');

        if ($this->canViewAll($user) && $scope === 'organization' && $user->organization_id) {
            $query->whereIn('user_id', $this->visibleUserIds($user));
        } else {
            $query->where('user_id', $user->id);
        }

        $timeEntries = $query->get();

        $resolvedNow = now();
        $byDay = $timeEntries->groupBy(function ($entry) {
            return Carbon::parse($entry->start_time)->toDateString();
        })->map(function ($entries) use ($resolvedNow) {
            return [
                'date' => Carbon::parse($entries->first()->start_time)->toDateString(),
                'total_time' => $this->timeEntryDurationService->sumEffectiveDuration($entries, $resolvedNow),
            ];
        })->values();

        return response()->json(array_merge(
            [
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
                'by_day' => $byDay,
            ],
            $this->reportPayloadBuilder->buildCommonReportPayload($timeEntries)
        ));
    }

    public function productivity(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json([
                'productivity_score' => 0,
                'tracked_time' => 0,
                'working_time' => 0,
                'idle_time' => 0,
                'active_time' => 0,
            ] + $this->timeBreakdownService->build(0, 0));
        }

        $startDate = Carbon::parse($request->get('start_date', Carbon::now()->startOfWeek()->toDateString()))->startOfDay();
        $endDate = Carbon::parse($request->get('end_date', Carbon::now()->endOfWeek()->toDateString()))->endOfDay();
        if ($startDate->greaterThan($endDate)) {
            [$startDate, $endDate] = [$endDate->copy()->startOfDay(), $startDate->copy()->endOfDay()];
        }

        $entries = TimeEntry::where('user_id', $user->id)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->get();

        $trackedDuration = $this->timeEntryDurationService->sumEffectiveDuration($entries)
            + (int) AttendanceRecord::query()
                ->where('user_id', $user->id)
                ->whereDate('attendance_date', '>=', $startDate->toDateString())
                ->whereDate('attendance_date', '<=', $endDate->toDateString())
                ->sum('manual_adjustment_seconds');
        $activities = $this->activityFeedService->forUsersInRange([$user->id], $startDate, $endDate);
        $idleDuration = $this->safeCalculateIdleTime($activities, [
            'report' => 'productivity',
            'user_id' => $user->id,
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
        ]);
        $timeBreakdown = $this->timeBreakdownService->build($trackedDuration, $idleDuration);
        $score = $this->timeBreakdownService->productivityScore($trackedDuration, $idleDuration);

        return response()->json([
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'productivity_score' => $score,
            'tracked_time' => $timeBreakdown['total_duration'],
            'working_time' => $timeBreakdown['working_duration'],
            'active_time' => $timeBreakdown['working_duration'],
            'idle_time' => $timeBreakdown['idle_duration'],
            'stats' => [
                'activity_events' => $activities->count(),
            ],
        ] + $timeBreakdown);
    }

    public function team(Request $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['by_user' => []]);
        }

        $startDate = $request->get('start_date', Carbon::now()->startOfWeek()->toDateString());
        $endDate = $request->get('end_date', Carbon::now()->endOfWeek()->toDateString());

        $users = User::where('organization_id', $currentUser->organization_id)->get();
        $resolvedNow = now();
        $byUser = $users->map(function (User $user) use ($startDate, $endDate, $resolvedNow) {
            $entries = TimeEntry::where('user_id', $user->id)
                ->whereBetween('start_time', [$startDate, $endDate])
                ->get();

            return [
                'user' => $user,
                'total_time' => $this->timeEntryDurationService->sumEffectiveDuration($entries, $resolvedNow),
                'entries' => $entries,
            ];
        });

        return response()->json([
            'start_date' => $startDate,
            'end_date' => $endDate,
            'by_user' => $byUser,
        ]);
    }

    public function overall(Request $request)
    {
        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'user_ids' => 'nullable|array',
            'user_ids.*' => 'integer',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
            'dashboard_lite' => 'nullable',
            'skip_activity' => 'nullable',
            'page' => 'nullable|integer|min:1',
            'per_page' => 'nullable|integer|min:1|max:100',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $startDate = Carbon::parse($request->get('start_date', Carbon::now()->startOfMonth()->toDateString()))->startOfDay();
        $endDate = Carbon::parse($request->get('end_date', Carbon::now()->toDateString()))->endOfDay();
        if ($startDate->greaterThan($endDate)) {
            [$startDate, $endDate] = [$endDate->copy()->startOfDay(), $startDate->copy()->endOfDay()];
        }

        $selectedIds = collect($request->input('user_ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();
        $selectedGroupIds = collect($request->input('group_ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        $usersQuery = $this->visibleUsersQuery($currentUser, $this->restrictMonitoringToEmployees($currentUser));
        if ($selectedGroupIds->isNotEmpty()) {
            $groupUserIds = ReportGroup::where('organization_id', $currentUser->organization_id)
                ->whereIn('id', $selectedGroupIds)
                ->with('users:id')
                ->get()
                ->flatMap(fn (ReportGroup $group) => $group->users->pluck('id'))
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values();

            if ($groupUserIds->isEmpty()) {
                return response()->json([
                    'start_date' => $startDate->toDateString(),
                    'end_date' => $endDate->toDateString(),
                    'summary' => [
                        'users_count' => 0,
                        'active_users' => 0,
                    ] + $this->timeBreakdownService->build(0, 0),
                    'by_user' => [],
                    'by_day' => [],
                ]);
            }

            $usersQuery->whereIn('id', $groupUserIds);
        }

        if ($selectedIds->isNotEmpty()) {
            $usersQuery->whereIn('id', $selectedIds);
        }
        $allUsers = $usersQuery->orderBy('name')->get(['id', 'name', 'email', 'role']);
        $shouldPaginateUsers = $request->has('page') || $request->has('per_page');
        $page = max(1, (int) $request->integer('page', 1));
        $perPage = min(100, max(1, (int) $request->integer('per_page', 25)));
        $totalUsers = $allUsers->count();
        $users = $shouldPaginateUsers
            ? $allUsers->slice(($page - 1) * $perPage, $perPage)->values()
            : $allUsers;
        $calendarDaysCount = max(1, CarbonPeriod::create($startDate->toDateString(), $endDate->toDateString())->count());
        if ($users->isEmpty()) {
            $emptyResponse = [
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
                'summary' => [
                    'users_count' => 0,
                    'active_users' => 0,
                ] + $this->timeBreakdownService->build(0, 0),
                'by_user' => [],
                'by_day' => [],
            ];

            if ($shouldPaginateUsers) {
                $emptyResponse['pagination'] = [
                    'current_page' => $page,
                    'per_page' => $perPage,
                    'total' => $totalUsers,
                    'last_page' => max(1, (int) ceil($totalUsers / $perPage)),
                ];
            }

            return response()->json($emptyResponse);
        }

        $userIds = $users->pluck('id');

        $entries = TimeEntry::whereIn('user_id', $userIds)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->get(['id', 'user_id', 'start_time', 'end_time', 'duration']);
        $attendanceAdjustments = AttendanceRecord::query()
            ->whereIn('user_id', $userIds)
            ->whereDate('attendance_date', '>=', $startDate->toDateString())
            ->whereDate('attendance_date', '<=', $endDate->toDateString())
            ->get(['id', 'user_id', 'attendance_date', 'check_in_at', 'check_out_at', 'manual_adjustment_seconds']);

        $activeUserIds = TimeEntry::whereIn('user_id', $userIds)
            ->whereNull('end_time')
            ->distinct()
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id);

        if ($request->boolean('dashboard_lite')) {
            return response()->json($this->buildLiteOverallReport(
                $users,
                $entries,
                $attendanceAdjustments,
                $activeUserIds,
                $calendarDaysCount,
                $startDate,
                $endDate,
                $request->boolean('skip_activity'),
            ));
        }

        $skipActivity = $request->boolean('skip_activity');
        $activities = $skipActivity
            ? collect()
            : $this->activityFeedService->forUsersInRange($userIds, $startDate, $endDate);

        $entriesByUser = $entries->groupBy('user_id');
        $adjustmentsByUser = $attendanceAdjustments->groupBy('user_id');
        $activitiesByUser = $activities->groupBy('user_id');
        $activitiesByUserAndDay = $this->groupActivitiesByUserAndDay($activities);

        $resolvedNow = now();

        $byUser = $users->map(function ($user) use ($entriesByUser, $adjustmentsByUser, $activitiesByUser, $activeUserIds, $resolvedNow, $calendarDaysCount) {
            $userEntries = $entriesByUser->get($user->id, collect());
            $userActivities = $activitiesByUser->get($user->id, collect());
            $userAttendanceRecords = $adjustmentsByUser->get($user->id, collect());
            $userAdjustmentDuration = (int) $userAttendanceRecords
                ->sum(fn (AttendanceRecord $record) => (int) ($record->manual_adjustment_seconds ?? 0));
            $idleDuration = $this->safeCalculateIdleTime($userActivities, [
                'report' => 'overall',
                'user_id' => $user->id,
                'scope' => 'by_user',
            ]);
            $timeBreakdown = $this->timeBreakdownService->build(
                $this->timeEntryDurationService->sumEffectiveDuration($userEntries, $resolvedNow) + $userAdjustmentDuration,
                $idleDuration
            );
            $attendanceSummary = $this->buildOverallAttendanceSummary($userAttendanceRecords, $calendarDaysCount);

            return [
                'user' => $user,
                'entries_count' => $userEntries->count(),
                'last_activity_at' => $userActivities->max('recorded_at'),
                'is_working' => $activeUserIds->contains((int) $user->id),
            ] + $timeBreakdown + $attendanceSummary;
        })->values();

        $dayUserBuckets = [];
        foreach ($entries as $entry) {
            $date = Carbon::parse($entry->start_time)->toDateString();
            $key = (string) $entry->user_id.'|'.$date;

            if (! isset($dayUserBuckets[$key])) {
                $dayUserBuckets[$key] = [
                    'date' => $date,
                    'total_duration' => 0,
                    'idle_duration' => 0,
                ];
            }

            $dayUserBuckets[$key]['total_duration'] += $this->timeEntryDurationService->effectiveDuration($entry, $resolvedNow);
        }

        foreach ($attendanceAdjustments as $record) {
            $adjustmentSeconds = (int) ($record->manual_adjustment_seconds ?? 0);
            if ($adjustmentSeconds <= 0) {
                continue;
            }

            $date = Carbon::parse($record->attendance_date)->toDateString();
            $key = (string) $record->user_id.'|'.$date;

            if (! isset($dayUserBuckets[$key])) {
                $dayUserBuckets[$key] = [
                    'date' => $date,
                    'total_duration' => 0,
                    'idle_duration' => 0,
                ];
            }

            $dayUserBuckets[$key]['total_duration'] += $adjustmentSeconds;
        }

        foreach ($activitiesByUserAndDay as $key => $dayActivities) {
            [, $date] = explode('|', (string) $key, 2);
            if (! isset($dayUserBuckets[$key])) {
                $dayUserBuckets[$key] = [
                    'date' => $date,
                    'total_duration' => 0,
                    'idle_duration' => 0,
                ];
            }

            $dayUserBuckets[$key]['idle_duration'] = $this->safeCalculateIdleTime($dayActivities, [
                'report' => 'overall',
                'scope' => 'by_day',
                'bucket' => $key,
            ]);
        }

        $byDay = collect($dayUserBuckets)
            ->map(function (array $bucket) {
                return [
                    'date' => $bucket['date'],
                ] + $this->timeBreakdownService->build(
                    (int) ($bucket['total_duration'] ?? 0),
                    (int) ($bucket['idle_duration'] ?? 0)
                );
            })
            ->groupBy('date')
            ->map(function ($rows, $date) {
                return [
                    'date' => $date,
                ] + $this->timeBreakdownService->build(
                    (int) $rows->sum('total_duration'),
                    (int) $rows->sum('idle_duration')
                );
            })
            ->sortBy('date')
            ->values();

        $summaryBreakdown = $this->timeBreakdownService->build(
            (int) $byUser->sum('total_duration'),
            (int) $byUser->sum('idle_duration')
        );

        $response = [
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'summary' => [
                'users_count' => $shouldPaginateUsers ? $totalUsers : $users->count(),
                'page_users_count' => $users->count(),
                'active_users' => $activeUserIds->unique()->count(),
            ] + $summaryBreakdown,
            'users' => $users,
            'by_user' => $byUser,
            'by_day' => $byDay,
        ];

        if ($shouldPaginateUsers) {
            $response['pagination'] = [
                'current_page' => $page,
                'per_page' => $perPage,
                'total' => $totalUsers,
                'last_page' => max(1, (int) ceil($totalUsers / $perPage)),
            ];
        }

        return response()->json($response);
    }

    private function buildLiteOverallReport(
        Collection $users,
        Collection $entries,
        Collection $attendanceAdjustments,
        Collection $activeUserIds,
        int $calendarDaysCount,
        Carbon $startDate,
        Carbon $endDate,
        bool $skipActivity = false,
    ): array {
        $resolvedNow = now();
        $entriesByUser = $entries->groupBy('user_id');
        $adjustmentsByUser = $attendanceAdjustments->groupBy('user_id');
        $activities = $skipActivity
            ? collect()
            : $this->activityFeedService->forUsersInRange($users->pluck('id'), $startDate, $endDate);
        $activitiesByUser = $activities->groupBy('user_id');
        $activitiesByUserAndDay = $this->groupActivitiesByUserAndDay($activities);

        $byUser = $users->map(function ($user) use ($entriesByUser, $adjustmentsByUser, $activitiesByUser, $activeUserIds, $resolvedNow, $calendarDaysCount) {
            $userEntries = $entriesByUser->get($user->id, collect());
            $userActivities = $activitiesByUser->get($user->id, collect());
            $userAttendanceRecords = $adjustmentsByUser->get($user->id, collect());
            $adjustmentDuration = (int) $userAttendanceRecords
                ->sum(fn (AttendanceRecord $record) => (int) ($record->manual_adjustment_seconds ?? 0));
            $idleDuration = $this->safeCalculateIdleTime($userActivities, [
                'report' => 'overall_lite',
                'user_id' => $user->id,
                'scope' => 'by_user',
            ]);
            $timeBreakdown = $this->timeBreakdownService->build(
                $this->timeEntryDurationService->sumEffectiveDuration($userEntries, $resolvedNow) + $adjustmentDuration,
                $idleDuration
            );
            $attendanceSummary = $this->buildOverallAttendanceSummary($userAttendanceRecords, $calendarDaysCount);

            return [
                'user' => $user,
                'entries_count' => $userEntries->count(),
                'last_activity_at' => $userActivities->max('recorded_at'),
                'is_working' => $activeUserIds->contains((int) $user->id),
            ] + $timeBreakdown + $attendanceSummary;
        })->values();

        $dayUserBuckets = [];
        foreach ($entries as $entry) {
            $date = Carbon::parse($entry->start_time)->toDateString();
            $key = (string) $entry->user_id.'|'.$date;

            if (! isset($dayUserBuckets[$key])) {
                $dayUserBuckets[$key] = [
                    'date' => $date,
                    'total_duration' => 0,
                    'idle_duration' => 0,
                ];
            }

            $dayUserBuckets[$key]['total_duration'] += $this->timeEntryDurationService->effectiveDuration($entry, $resolvedNow);
        }

        foreach ($attendanceAdjustments as $record) {
            $adjustmentSeconds = (int) ($record->manual_adjustment_seconds ?? 0);
            if ($adjustmentSeconds <= 0) {
                continue;
            }

            $date = Carbon::parse($record->attendance_date)->toDateString();
            $key = (string) $record->user_id.'|'.$date;

            if (! isset($dayUserBuckets[$key])) {
                $dayUserBuckets[$key] = [
                    'date' => $date,
                    'total_duration' => 0,
                    'idle_duration' => 0,
                ];
            }

            $dayUserBuckets[$key]['total_duration'] += $adjustmentSeconds;
        }

        foreach ($activitiesByUserAndDay as $key => $dayActivities) {
            [, $date] = explode('|', (string) $key, 2);
            if (! isset($dayUserBuckets[$key])) {
                $dayUserBuckets[$key] = [
                    'date' => $date,
                    'total_duration' => 0,
                    'idle_duration' => 0,
                ];
            }

            $dayUserBuckets[$key]['idle_duration'] = $this->safeCalculateIdleTime($dayActivities, [
                'report' => 'overall_lite',
                'scope' => 'by_day',
                'bucket' => $key,
            ]);
        }

        $byDay = collect($dayUserBuckets)
            ->map(function (array $bucket) {
                return [
                    'date' => $bucket['date'],
                ] + $this->timeBreakdownService->build(
                    (int) ($bucket['total_duration'] ?? 0),
                    (int) ($bucket['idle_duration'] ?? 0)
                );
            })
            ->groupBy('date')
            ->map(function ($rows, $date) {
                return [
                    'date' => $date,
                ] + $this->timeBreakdownService->build(
                    (int) $rows->sum('total_duration'),
                    (int) $rows->sum('idle_duration')
                );
            })
            ->sortBy('date')
            ->values();

        $summaryBreakdown = $this->timeBreakdownService->build(
            (int) $byUser->sum('total_duration'),
            (int) $byUser->sum('idle_duration')
        );

        return [
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'summary' => [
                'users_count' => $users->count(),
                'active_users' => $activeUserIds->unique()->count(),
                'is_lite' => true,
            ] + $summaryBreakdown,
            'users' => $users,
            'by_user' => $byUser,
            'by_day' => $byDay,
        ];
    }

    private function groupActivitiesByUserAndDay(Collection $activities): Collection
    {
        return $activities
            ->map(function ($activity) {
                $userId = (int) data_get($activity, 'user_id', 0);
                $recordedAt = data_get($activity, 'recorded_at');
                $date = $this->resolveActivityDateString($recordedAt);

                if ($userId <= 0 || !$date) {
                    return null;
                }

                return [
                    'key' => sprintf('%d|%s', $userId, $date),
                    'activity' => $activity,
                ];
            })
            ->filter()
            ->groupBy('key')
            ->map(fn (Collection $rows) => $rows->pluck('activity')->values());
    }

    private function resolveActivityDateString(mixed $recordedAt): ?string
    {
        if ($recordedAt instanceof Carbon) {
            return $recordedAt->toDateString();
        }

        if ($recordedAt === null || $recordedAt === '') {
            return null;
        }

        try {
            return Carbon::parse((string) $recordedAt)->toDateString();
        } catch (\Throwable) {
            return null;
        }
    }

    public function project(Request $request, int $projectId)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $project = Project::where('organization_id', $currentUser->organization_id)->find($projectId);
        if (!$project) {
            return response()->json(['message' => 'Project not found'], 404);
        }

        $startDate = Carbon::parse($request->get('start_date', Carbon::now()->startOfMonth()->toDateString()))->startOfDay();
        $endDate = Carbon::parse($request->get('end_date', Carbon::now()->endOfMonth()->toDateString()))->endOfDay();
        if ($startDate->greaterThan($endDate)) {
            [$startDate, $endDate] = [$endDate->copy()->startOfDay(), $startDate->copy()->endOfDay()];
        }

        $entries = TimeEntry::with('user', 'task')
            ->where('project_id', $project->id)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->get();
        $idleDuration = 0;
        if ($entries->isNotEmpty()) {
            $activities = $this->activityFeedService->forTimeEntries($entries->pluck('id'), $startDate, $endDate);
            $idleDuration = $this->safeCalculateIdleTime($activities, [
                'report' => 'project',
                'project_id' => $project->id,
                'scope' => 'summary',
            ]);
        }
        $timeBreakdown = $this->timeBreakdownService->build(
            $this->timeEntryDurationService->sumEffectiveDuration($entries),
            $idleDuration
        );

        return response()->json([
            'project' => $project,
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'entries' => $entries,
            'total_time' => $timeBreakdown['total_duration'],
            'working_time' => $timeBreakdown['working_duration'],
            'billable_time' => $timeBreakdown['billable_time'],
            'idle_time' => $timeBreakdown['idle_duration'],
        ] + $timeBreakdown);
    }

    public function export(Request $request)
    {
        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'user_ids' => 'nullable|array',
            'user_ids.*' => 'integer',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $startDate = Carbon::parse($request->get('start_date', Carbon::now()->startOfMonth()->toDateString()))->startOfDay();
        $endDate = Carbon::parse($request->get('end_date', Carbon::now()->endOfMonth()->toDateString()))->endOfDay();
        if ($startDate->greaterThan($endDate)) {
            [$startDate, $endDate] = [$endDate->copy()->startOfDay(), $startDate->copy()->endOfDay()];
        }

        $entriesQuery = TimeEntry::with(['project', 'task', 'user'])
            ->whereBetween('start_time', [$startDate, $endDate]);

        if ($this->canViewAll($user) && $user->organization_id) {
            $organizationUserIds = $this->visibleUserIds($user);

            $selectedUserIds = collect($request->input('user_ids', []))
                ->map(fn ($id) => (int) $id)
                ->filter(fn ($id) => $id > 0)
                ->unique()
                ->values();
            $selectedGroupIds = collect($request->input('group_ids', []))
                ->map(fn ($id) => (int) $id)
                ->filter(fn ($id) => $id > 0)
                ->unique()
                ->values();

            if ($selectedGroupIds->isNotEmpty()) {
                $groupUserIds = ReportGroup::query()
                    ->where('organization_id', $user->organization_id)
                    ->whereIn('id', $selectedGroupIds)
                    ->with('users:id')
                    ->get()
                    ->flatMap(fn (ReportGroup $group) => $group->users->pluck('id'))
                    ->map(fn ($id) => (int) $id)
                    ->unique()
                    ->values();

                if ($selectedUserIds->isEmpty()) {
                    $selectedUserIds = $groupUserIds;
                } else {
                    $selectedUserIds = $selectedUserIds->intersect($groupUserIds)->values();
                }
            }

            $entriesQuery->whereIn(
                'user_id',
                $selectedUserIds->isNotEmpty() ? $selectedUserIds : $organizationUserIds
            );
        } else {
            $entriesQuery->where('user_id', $user->id);
        }

        $entries = $entriesQuery
            ->orderBy('start_time')
            ->get();

        $lines = [
            'Date,Employee,Project,Task,Description,Duration (seconds),Billable',
        ];

        foreach ($entries as $entry) {
            $lines[] = implode(',', [
                Carbon::parse($entry->start_time)->toDateString(),
                $this->csvValue($entry->user?->name ?? 'Unknown User'),
                $this->csvValue($entry->project?->name ?? 'No Project'),
                $this->csvValue($entry->task?->title ?? ''),
                $this->csvValue($entry->description ?? ''),
                $entry->duration,
                $entry->billable ? 'Yes' : 'No',
            ]);
        }

        $csv = implode("\n", $lines);
        $fileName = 'report-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    public function attendance(Request $request)
    {
        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'user_id' => 'nullable|integer',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
            'q' => 'nullable|string|max:255',
            'country' => 'nullable|string|max:64',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }

        $startDate = Carbon::parse($request->get('start_date', now()->startOfYear()->toDateString()))->startOfDay();
        $endDate = Carbon::parse($request->get('end_date', now()->endOfYear()->toDateString()))->endOfDay();
        if ($startDate->greaterThan($endDate)) {
            [$startDate, $endDate] = [$endDate->copy()->startOfDay(), $startDate->copy()->endOfDay()];
        }

        $allDatesInRange = collect(CarbonPeriod::create($startDate->copy()->startOfDay(), $endDate->copy()->startOfDay()))
            ->map(fn (Carbon $date) => $date->toDateString());
        $weekendDates = $allDatesInRange
            ->filter(fn (string $date) => Carbon::parse($date)->isWeekend())
            ->values();
        $workingDates = $allDatesInRange
            ->reject(fn (string $date) => Carbon::parse($date)->isWeekend())
            ->values();

        $usersQuery = $this->visibleUsersQuery($currentUser, $this->restrictMonitoringToEmployees($currentUser));
        if ($request->filled('user_id')) {
            $usersQuery->where('id', (int) $request->user_id);
        }
        if ($request->filled('q')) {
            $term = trim((string) $request->q);
            $usersQuery->where(function ($query) use ($term) {
                $query->where('name', 'like', "%{$term}%")
                    ->orWhere('email', 'like', "%{$term}%");
            });
        }

        $users = $usersQuery->orderBy('name')->get();
        $countryFilter = AttendanceHoliday::normalizeCountry((string) $request->get('country', 'ALL'));
        if ($countryFilter !== 'ALL') {
            $users = $users
                ->filter(fn (User $user) => AttendanceHoliday::countryForSettings($user->settings) === $countryFilter)
                ->values();
        }
        $calendarDaysCount = max(1, $allDatesInRange->count());
        $workingDaysCount = max(1, $workingDates->count());
        $userIds = $users->pluck('id')->map(fn ($id) => (int) $id)->filter(fn ($id) => $id > 0)->values();
        $activeTimeEntryUserIds = $userIds->isEmpty()
            ? collect()
            : TimeEntry::query()
                ->whereIn('user_id', $userIds)
                ->whereNull('end_time')
                ->distinct()
                ->pluck('user_id')
                ->map(fn ($id) => (int) $id)
                ->unique();
        $openAttendanceUserIds = $userIds->isEmpty()
            ? collect()
            : AttendanceRecord::query()
                ->where('organization_id', $currentUser->organization_id)
                ->whereIn('user_id', $userIds)
                ->whereDate('attendance_date', now()->toDateString())
                ->whereNotNull('check_in_at')
                ->whereNull('check_out_at')
                ->distinct()
                ->pluck('user_id')
                ->map(fn ($id) => (int) $id)
                ->unique();

        $rows = $users->map(function (User $user) use (
            $startDate,
            $endDate,
            $calendarDaysCount,
            $workingDaysCount,
            $workingDates,
            $weekendDates,
            $currentUser,
            $activeTimeEntryUserIds,
            $openAttendanceUserIds,
        ) {
            $records = AttendanceRecord::query()
                ->where('organization_id', $currentUser->organization_id)
                ->where('user_id', $user->id)
                ->whereDate('attendance_date', '>=', $startDate->toDateString())
                ->whereDate('attendance_date', '<=', $endDate->toDateString())
                ->with('punches')
                ->get(['id', 'attendance_date', 'check_in_at', 'check_out_at', 'worked_seconds', 'manual_adjustment_seconds']);

            $recordByDate = $records->keyBy(fn ($record) => Carbon::parse($record->attendance_date)->toDateString());
            $presentDates = $workingDates
                ->filter(fn (string $date) => (bool) $recordByDate->get($date)?->check_in_at)
                ->values();

            $approvedLeaveDates = LeaveRequest::query()
                ->where('organization_id', $currentUser->organization_id)
                ->where('user_id', $user->id)
                ->where('status', 'approved')
                ->whereDate('start_date', '<=', $endDate->toDateString())
                ->whereDate('end_date', '>=', $startDate->toDateString())
                ->get(['start_date', 'end_date'])
                ->flatMap(function ($leave) {
                    return collect(CarbonPeriod::create($leave->start_date, $leave->end_date))
                        ->filter(fn ($date) => !$date->isWeekend())
                        ->map(fn ($date) => $date->toDateString())
                        ->values();
                })
                ->unique()
                ->values();

            $absentDates = $workingDates
                ->filter(fn (string $date) => !$presentDates->contains($date))
                ->values();

            $workedSeconds = (int) $records->sum(fn (AttendanceRecord $record) => $this->calculateAttendanceWorkedSeconds($record));
            $daysPresent = $presentDates->count();
            $leaveDays = $approvedLeaveDates->count();
            $attendanceRate = (float) round(($daysPresent / $calendarDaysCount) * 100, 2);

            $isWorking = $activeTimeEntryUserIds->contains((int) $user->id)
                || $openAttendanceUserIds->contains((int) $user->id);

            return [
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                ],
                'days_present' => $daysPresent,
                'calendar_days_in_range' => $calendarDaysCount,
                'working_days_in_range' => $workingDaysCount,
                'leave_days' => $leaveDays,
                'attendance_rate' => $attendanceRate,
                'worked_seconds' => $workedSeconds,
                'worked_hours' => round($workedSeconds / 3600, 2),
                'is_working' => $isWorking,
                'present_dates' => $presentDates,
                'leave_dates' => $approvedLeaveDates,
                'absent_dates' => $absentDates,
                'weekend_dates' => $weekendDates,
            ];
        })->values();

        return response()->json([
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'calendar_days' => $allDatesInRange->count(),
            'weekend_days' => $weekendDates->count(),
            'working_days' => $workingDates->count(),
            'data' => $rows,
        ]);
    }

    public function employeeInsights(Request $request)
    {
        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'user_id' => 'nullable|integer',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
            'q' => 'nullable|string|max:255',
            'recent_screenshot_limit' => 'nullable|integer|min:1|max:50',
            'dashboard_lite' => 'nullable',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['matched_users' => [], 'selected_user' => null]);
        }

        $startDate = Carbon::parse($request->get('start_date', now()->startOfMonth()->toDateString()))->startOfDay();
        $endDate = Carbon::parse($request->get('end_date', now()->toDateString()))->endOfDay();
        if ($startDate->greaterThan($endDate)) {
            [$startDate, $endDate] = [$endDate->copy()->startOfDay(), $startDate->copy()->endOfDay()];
        }
        $recentScreenshotLimit = max(1, min((int) $request->integer('recent_screenshot_limit', 10), 50));

        $selectedGroupIds = collect($request->input('group_ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        $usersQuery = $this->visibleUsersQuery($currentUser, $this->restrictMonitoringToEmployees($currentUser));
        if ($selectedGroupIds->isNotEmpty()) {
            $groupUserIds = ReportGroup::where('organization_id', $currentUser->organization_id)
                ->whereIn('id', $selectedGroupIds)
                ->with('users:id')
                ->get()
                ->flatMap(fn (ReportGroup $group) => $group->users->pluck('id'))
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values();

            if ($groupUserIds->isEmpty()) {
                return response()->json([
                    'start_date' => $startDate->toDateString(),
                    'end_date' => $endDate->toDateString(),
                    'matched_users' => [],
                    'selected_user' => null,
                    'stats' => null,
                    'activity_breakdown' => [],
                    'selected_user_tools' => ['productive' => [], 'unproductive' => [], 'neutral' => [], 'context_dependent' => []],
                    'organization_tools' => ['productive' => [], 'unproductive' => [], 'neutral' => [], 'context_dependent' => []],
                    'organization_summary' => [
                        'productive_duration' => 0,
                        'unproductive_duration' => 0,
                        'neutral_duration' => 0,
                        'context_dependent_duration' => 0,
                        'productive_share' => 0,
                        'unproductive_share' => 0,
                        'neutral_share' => 0,
                        'context_dependent_share' => 0,
                    ],
                    'employee_rankings' => [
                        'most_productive' => null,
                        'most_unproductive' => null,
                        'by_productive_duration' => [],
                        'by_unproductive_duration' => [],
                    ],
                    'team_rankings' => [
                        'by_efficiency' => [],
                        'top_productive' => null,
                        'least_productive' => null,
                    ],
                    'live_monitoring' => [
                        'selected_user' => null,
                        'working_now' => [],
                        'all_users' => [],
                        'employees_active' => [],
                        'employees_inactive' => [],
                        'employees_on_leave' => [],
                    ],
                    'recent_screenshots' => [],
                ]);
            }

            $usersQuery->whereIn('id', $groupUserIds);
        }

        if ($request->filled('q')) {
            $term = trim((string) $request->q);
            $usersQuery->where(function ($query) use ($term) {
                $query->where('name', 'like', "%{$term}%")
                    ->orWhere('email', 'like', "%{$term}%");
            });
        }

        $matchedUsers = (clone $usersQuery)->orderBy('name')->limit(20)->get(['id', 'name', 'email', 'role']);
        $analyticsUsers = (clone $usersQuery)->orderBy('name')->get(['id', 'name', 'email', 'role']);
        $selectedUserId = $request->filled('user_id')
            ? (int) $request->user_id
            : (int) ($matchedUsers->first()->id ?? 0);

        if ($selectedUserId <= 0) {
            return response()->json([
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
                'matched_users' => [],
                'selected_user' => null,
                'stats' => null,
                'activity_breakdown' => [],
                'recent_screenshots' => [],
            ]);
        }

        $selectedUser = $this->visibleUsersQuery($currentUser, $this->restrictMonitoringToEmployees($currentUser))
            ->where('id', $selectedUserId)
            ->first();
        if (!$selectedUser) {
            return response()->json(['message' => 'User not found'], 404);
        }
        if (!$this->canViewAll($currentUser) && $selectedUser->id !== $currentUser->id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $entries = TimeEntry::where('user_id', $selectedUser->id)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->get(['id', 'start_time', 'end_time', 'duration']);
        $entriesCount = $entries->count();
        $resolvedNow = now();

        if ($request->boolean('dashboard_lite')) {
            return response()->json($this->buildLiteEmployeeInsights(
                $selectedUser,
                $matchedUsers,
                $entries,
                $entriesCount,
                $startDate,
                $endDate,
                $resolvedNow,
            ));
        }

        $activities = $this->activityFeedService->forUsersInRange([$selectedUser->id], $startDate, $endDate);
        $selectedUsageSummary = $this->usageProcessingService->buildWebAppUsageUserRangeSummary(
            (int) $selectedUser->id,
            $activities,
            $startDate,
            $endDate,
        );
        $selectedMetrics = (array) ($selectedUsageSummary['metrics'] ?? []);
        $totalIdle = (int) ($selectedMetrics['idle_time'] ?? 0);
        $selectedTrackedDuration = $this->timeEntryDurationService->sumEffectiveDuration($entries, $resolvedNow);
        $selectedTimeBreakdown = $this->timeBreakdownService->build($selectedTrackedDuration, $totalIdle);
        $idleCount = max(1, (int) ($selectedUsageSummary['idle_segments_count'] ?? 0));
        $avgIdle = (float) round(((int) ($selectedTimeBreakdown['idle_duration'] ?? 0)) / $idleCount, 2);
        $activityBreakdown = collect($selectedUsageSummary['activity_breakdown'] ?? [])->values();
        $selectedToolBreakdown = $this->limitToolBreakdown(
            (array) ($selectedUsageSummary['tools'] ?? ['productive' => [], 'unproductive' => [], 'neutral' => [], 'context_dependent' => []])
        );

        $recentScreenshots = Screenshot::query()
            ->whereHas('timeEntry', function ($query) use ($selectedUser, $startDate, $endDate) {
                $query->where('user_id', $selectedUser->id)
                    ->whereBetween('start_time', [$startDate, $endDate]);
            })
            ->orderByDesc('created_at')
            ->limit($recentScreenshotLimit)
            ->get();

        $analyticsUserIds = $analyticsUsers->pluck('id')->map(fn ($id) => (int) $id)->filter(fn ($id) => $id > 0)->values();
        $organizationEntries = $analyticsUserIds->isEmpty()
            ? collect()
            : TimeEntry::whereIn('user_id', $analyticsUserIds)
                ->whereBetween('start_time', [$startDate, $endDate])
                ->get(['id', 'user_id', 'start_time', 'end_time', 'duration']);
        $organizationEntriesByUser = $organizationEntries->groupBy(fn ($entry) => (int) $entry->user_id);
        $organizationActivities = $analyticsUserIds->isEmpty()
            ? collect()
            : $this->activityFeedService->forUsersInRange($analyticsUserIds, $startDate, $endDate);
        $organizationActivitiesByUser = collect($organizationActivities)->groupBy(fn ($activity) => (int) $activity->user_id);

        $toolTotalsByKey = [];
        $perUserScore = [];
        foreach ($analyticsUsers as $analyticsUser) {
            $userId = (int) $analyticsUser->id;
            $userUsageSummary = $this->usageProcessingService->buildWebAppUsageUserRangeSummary(
                $userId,
                $organizationActivitiesByUser->get($userId, collect()),
                $startDate,
                $endDate,
            );
            $userMetrics = (array) ($userUsageSummary['metrics'] ?? []);
            $userTrackedDuration = $this->timeEntryDurationService->sumEffectiveDuration(
                $organizationEntriesByUser->get($userId, collect()),
                $resolvedNow,
            );
            $userTimeBreakdown = $this->timeBreakdownService->build(
                $userTrackedDuration,
                (int) ($userMetrics['idle_time'] ?? 0),
            );
            $activityTotalDuration = (int) ($userMetrics['total_time'] ?? 0);

            $perUserScore[$userId] = [
                'user' => [
                    'id' => $userId,
                    'name' => $analyticsUser->name,
                    'email' => $analyticsUser->email,
                    'role' => $analyticsUser->role,
                ],
                'productive_duration' => (int) ($userMetrics['productive_time'] ?? 0),
                'unproductive_duration' => (int) ($userMetrics['unproductive_time'] ?? 0),
                'neutral_duration' => (int) ($userMetrics['neutral_time'] ?? 0),
                'context_dependent_duration' => (int) ($userMetrics['context_dependent_time'] ?? 0),
                'activity_total_duration' => $activityTotalDuration,
                'tracked_duration' => (int) ($userTimeBreakdown['total_duration'] ?? 0),
                'total_duration' => (int) ($userTimeBreakdown['total_duration'] ?? 0),
                'working_duration' => (int) ($userTimeBreakdown['working_duration'] ?? 0),
                'idle_duration' => (int) ($userTimeBreakdown['idle_duration'] ?? 0),
            ];

            foreach (['productive', 'unproductive', 'neutral', 'context_dependent'] as $classification) {
                foreach ((array) data_get($userUsageSummary, "tools.{$classification}", []) as $toolRow) {
                    $toolKey = strtolower(implode('|', [
                        (string) ($toolRow['classification'] ?? $classification),
                        (string) ($toolRow['type'] ?? 'software'),
                        (string) ($toolRow['label'] ?? 'unknown'),
                    ]));

                    if (! isset($toolTotalsByKey[$toolKey])) {
                        $toolTotalsByKey[$toolKey] = [
                            'label' => (string) ($toolRow['label'] ?? 'unknown'),
                            'type' => (string) ($toolRow['type'] ?? 'software'),
                            'classification' => (string) ($toolRow['classification'] ?? $classification),
                            'total_duration' => 0,
                            'total_events' => 0,
                            'users' => [],
                        ];
                    }

                    $toolTotalsByKey[$toolKey]['total_duration'] += (int) ($toolRow['total_duration'] ?? 0);
                    $toolTotalsByKey[$toolKey]['total_events'] += (int) ($toolRow['total_events'] ?? 0);
                    $toolTotalsByKey[$toolKey]['users'][$userId] = true;
                }
            }
        }

        $toolAnalytics = collect(array_values($toolTotalsByKey))->map(function (array $row) use ($analyticsUsers) {
            $usersCount = count($row['users']);
            $totalDuration = (int) $row['total_duration'];
            return [
                'label' => $row['label'],
                'type' => $row['type'],
                'classification' => $row['classification'],
                'total_duration' => $totalDuration,
                'total_events' => (int) $row['total_events'],
                'users_count' => $usersCount,
                'avg_duration_per_employee' => $analyticsUsers->count() > 0
                    ? (float) round($totalDuration / $analyticsUsers->count(), 2)
                    : 0.0,
            ];
        });

        $productiveTools = $toolAnalytics
            ->where('classification', 'productive')
            ->sortByDesc('total_duration')
            ->values();
        $unproductiveTools = $toolAnalytics
            ->where('classification', 'unproductive')
            ->sortByDesc('total_duration')
            ->values();
        $neutralTools = $toolAnalytics
            ->where('classification', 'neutral')
            ->sortByDesc('total_duration')
            ->values();
        $contextDependentTools = $toolAnalytics
            ->where('classification', 'context_dependent')
            ->sortByDesc('total_duration')
            ->values();

        $employeeScores = collect(array_values($perUserScore))
            ->filter(fn (array $row) => strtolower((string) ($row['user']['role'] ?? '')) === 'employee')
            ->map(function (array $row) {
                $activityTotal = max(1, (int) ($row['activity_total_duration'] ?? 0));
                $row['productive_share'] = (float) round(($row['productive_duration'] / $activityTotal) * 100, 2);
                $row['unproductive_share'] = (float) round(($row['unproductive_duration'] / $activityTotal) * 100, 2);
                $row['neutral_share'] = (float) round((((int) ($row['neutral_duration'] ?? 0)) / $activityTotal) * 100, 2);
                $row['context_dependent_share'] = (float) round((((int) ($row['context_dependent_duration'] ?? 0)) / $activityTotal) * 100, 2);
                return $row;
            })
            ->sortByDesc('productive_duration')
            ->values();

        $mostProductiveEmployee = $employeeScores
            ->sortByDesc('productive_duration')
            ->first(fn ($row) => (int) ($row['productive_duration'] ?? 0) > 0);
        $mostUnproductiveEmployee = $employeeScores
            ->sortByDesc('unproductive_duration')
            ->first(fn ($row) => (int) ($row['unproductive_duration'] ?? 0) > 0);

        $orgProductiveDuration = (int) $productiveTools->sum('total_duration');
        $orgUnproductiveDuration = (int) $unproductiveTools->sum('total_duration');
        $orgNeutralDuration = (int) $neutralTools->sum('total_duration');
        $orgContextDependentDuration = (int) $contextDependentTools->sum('total_duration');
        $orgActivityDuration = $orgProductiveDuration + $orgUnproductiveDuration + $orgNeutralDuration + $orgContextDependentDuration;
        $orgTimeBreakdown = $this->timeBreakdownService->build(
            (int) collect($perUserScore)->sum('total_duration'),
            (int) collect($perUserScore)->sum('idle_duration'),
        );

        $activeTimeEntryUserIds = $analyticsUserIds->isEmpty()
            ? collect()
            : TimeEntry::whereIn('user_id', $analyticsUserIds)
                ->whereNull('end_time')
                ->pluck('user_id')
                ->map(fn ($id) => (int) $id)
                ->unique();

        $todayDate = now()->toDateString();
        $onLeaveUserIds = $analyticsUserIds->isEmpty()
            ? collect()
            : LeaveRequest::query()
                ->whereIn('user_id', $analyticsUserIds)
                ->where('status', 'approved')
                ->whereDate('start_date', '<=', $todayDate)
                ->whereDate('end_date', '>=', $todayDate)
                ->where(function ($query) {
                    $query->whereNull('revoke_status')
                        ->orWhere('revoke_status', '!=', 'approved');
                })
                ->pluck('user_id')
                ->map(fn ($id) => (int) $id)
                ->unique();

        $userScoreById = collect($perUserScore);
        $orgGroups = ReportGroup::with(['users:id,name,email,role'])
            ->where('organization_id', $currentUser->organization_id)
            ->orderBy('name')
            ->get();

        $teamEfficiency = $orgGroups->map(function (ReportGroup $group) use ($userScoreById, $activeTimeEntryUserIds, $onLeaveUserIds) {
            $memberIds = collect($group->users ?? [])
                ->filter(fn ($u) => strtolower((string) ($u->role ?? '')) === 'employee')
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values();

            $memberScores = $memberIds
                ->map(fn ($id) => $userScoreById->get($id))
                ->filter()
                ->values();

            $productive = (int) $memberScores->sum(fn ($row) => (int) ($row['productive_duration'] ?? 0));
            $unproductive = (int) $memberScores->sum(fn ($row) => (int) ($row['unproductive_duration'] ?? 0));
            $neutral = (int) $memberScores->sum(fn ($row) => (int) ($row['neutral_duration'] ?? 0));
            $contextDependent = (int) $memberScores->sum(fn ($row) => (int) ($row['context_dependent_duration'] ?? 0));
            $total = $productive + $unproductive + $neutral + $contextDependent;
            $score = $total > 0 ? (float) round(($productive / $total) * 100, 2) : 0.0;

            return [
                'group' => [
                    'id' => (int) $group->id,
                    'name' => $group->name,
                ],
                'members_count' => $memberIds->count(),
                'active_members_count' => $memberIds->filter(fn ($id) => $activeTimeEntryUserIds->contains($id))->count(),
                'on_leave_members_count' => $memberIds->filter(fn ($id) => $onLeaveUserIds->contains($id))->count(),
                'productive_duration' => $productive,
                'unproductive_duration' => $unproductive,
                'neutral_duration' => $neutral,
                'context_dependent_duration' => $contextDependent,
                'total_duration' => $total,
                'efficiency_score' => $score,
            ];
        })->values();

        $teamEfficiencyRanked = $teamEfficiency
            ->sortByDesc('efficiency_score')
            ->values();

        $recentActivitiesByUser = $analyticsUserIds->isEmpty()
            ? collect()
            : $this->activityFeedService
                ->recentForUsers($analyticsUserIds, now()->subMinutes(5))
                ->groupBy('user_id');

        $browserTrackingByUser = $analyticsUserIds->isEmpty()
            ? collect()
            : BrowserTrackingConnection::query()
                ->whereIn('user_id', $analyticsUserIds)
                ->orderByDesc('last_seen_at')
                ->orderByDesc('last_sync_at')
                ->get()
                ->groupBy(fn (BrowserTrackingConnection $connection) => (int) $connection->user_id)
                ->map(fn (Collection $connections) => $this->summarizeBrowserTrackingConnections($connections));

        $liveMonitoringRows = $analyticsUsers->map(function ($user) use ($recentActivitiesByUser, $activeTimeEntryUserIds, $browserTrackingByUser) {
            $userRecentActivities = collect($recentActivitiesByUser->get((int) $user->id, collect()));
            $latest = $this->selectPreferredLiveMonitoringActivity($userRecentActivities);
            $classification = 'neutral';
            $toolLabel = null;
            $toolType = null;
            $activityType = null;

            if ($latest) {
                $toolDescriptor = $this->usageProcessingService->describeTool((string) ($latest->name ?? ''), (string) ($latest->type ?? 'app'));
                $toolLabel = $this->resolveLiveMonitoringToolLabel($latest, $toolDescriptor);
                $classification = (string) ($latest->classification ?: ($toolDescriptor['classification'] ?? 'neutral'));
                $toolType = (string) ($latest->tool_type ?: ($toolDescriptor['type'] ?? ''));
                $activityType = (string) ($latest->type ?? 'app');
            }

            return [
                'user' => [
                    'id' => (int) $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                ],
                'is_working' => $activeTimeEntryUserIds->contains((int) $user->id),
                'current_tool' => $toolLabel,
                'tool_type' => $toolType,
                'activity_type' => $activityType,
                'classification' => $classification,
                'last_activity_at' => $latest ? Carbon::parse($latest->recorded_at)->toIso8601String() : null,
                'browser_tracking' => $browserTrackingByUser->get((int) $user->id, $this->summarizeBrowserTrackingConnections(collect())),
            ];
        })->values();

        $liveMonitoringRows = $liveMonitoringRows->map(function (array $row) use ($onLeaveUserIds) {
            $isOnLeave = $onLeaveUserIds->contains((int) ($row['user']['id'] ?? 0));
            $row['is_on_leave'] = $isOnLeave;
            $row['work_status'] = $isOnLeave
                ? 'on_leave'
                : ((bool) ($row['is_working'] ?? false) ? 'active' : 'inactive');
            return $row;
        })->values();

        $employeeLiveRows = $liveMonitoringRows
            ->filter(fn (array $row) => strtolower((string) ($row['user']['role'] ?? '')) === 'employee')
            ->values();

        $selectedUserLive = $liveMonitoringRows->first(fn ($row) => (int) ($row['user']['id'] ?? 0) === (int) $selectedUser->id);

        return response()->json([
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'matched_users' => $matchedUsers,
            'analytics_users_count' => $analyticsUsers->count(),
            'selected_user' => $selectedUser,
            'stats' => [
                'entries_count' => $entriesCount,
                'tracked_duration' => (int) ($selectedTimeBreakdown['total_duration'] ?? 0),
                'tracked_hours' => round(((int) ($selectedTimeBreakdown['total_duration'] ?? 0)) / 3600, 2),
                'total_duration' => (int) ($selectedTimeBreakdown['total_duration'] ?? 0),
                'total_hours' => round(((int) ($selectedTimeBreakdown['total_duration'] ?? 0)) / 3600, 2),
                'working_duration' => (int) ($selectedTimeBreakdown['working_duration'] ?? 0),
                'working_hours' => round(((int) ($selectedTimeBreakdown['working_duration'] ?? 0)) / 3600, 2),
                'billable_duration' => (int) ($selectedTimeBreakdown['billable_duration'] ?? 0),
                'productive_duration' => (int) ($selectedMetrics['productive_time'] ?? 0),
                'unproductive_duration' => (int) ($selectedMetrics['unproductive_time'] ?? 0),
                'neutral_duration' => (int) ($selectedMetrics['neutral_time'] ?? 0),
                'context_dependent_duration' => (int) ($selectedMetrics['context_dependent_time'] ?? 0),
                'activity_total_duration' => (int) ($selectedMetrics['total_time'] ?? 0),
                'idle_total_duration' => (int) ($selectedTimeBreakdown['idle_duration'] ?? 0),
                'idle_avg_duration' => $avgIdle,
                'activity_events' => $activities->count(),
            ],
            'activity_breakdown' => $activityBreakdown,
            'selected_user_tools' => $selectedToolBreakdown,
            'organization_tools' => [
                'productive' => $productiveTools->take(10)->values(),
                'unproductive' => $unproductiveTools->take(10)->values(),
                'neutral' => $neutralTools->take(10)->values(),
                'context_dependent' => $contextDependentTools->take(10)->values(),
            ],
            'organization_summary' => [
                'tracked_duration' => (int) ($orgTimeBreakdown['total_duration'] ?? 0),
                'total_duration' => (int) ($orgTimeBreakdown['total_duration'] ?? 0),
                'working_duration' => (int) ($orgTimeBreakdown['working_duration'] ?? 0),
                'idle_duration' => (int) ($orgTimeBreakdown['idle_duration'] ?? 0),
                'activity_total_duration' => $orgActivityDuration,
                'productive_duration' => $orgProductiveDuration,
                'unproductive_duration' => $orgUnproductiveDuration,
                'neutral_duration' => $orgNeutralDuration,
                'context_dependent_duration' => $orgContextDependentDuration,
                'productive_share' => (float) round(($orgProductiveDuration / max(1, $orgActivityDuration)) * 100, 2),
                'unproductive_share' => (float) round(($orgUnproductiveDuration / max(1, $orgActivityDuration)) * 100, 2),
                'neutral_share' => (float) round(($orgNeutralDuration / max(1, $orgActivityDuration)) * 100, 2),
                'context_dependent_share' => (float) round(($orgContextDependentDuration / max(1, $orgActivityDuration)) * 100, 2),
            ],
            'employee_rankings' => [
                'most_productive' => $mostProductiveEmployee,
                'most_unproductive' => $mostUnproductiveEmployee,
                'by_productive_duration' => $employeeScores->sortByDesc('productive_duration')->take(10)->values(),
                'by_unproductive_duration' => $employeeScores->sortByDesc('unproductive_duration')->take(10)->values(),
            ],
            'team_rankings' => [
                'by_efficiency' => $teamEfficiencyRanked->take(10)->values(),
                'top_productive' => $teamEfficiencyRanked->first(),
                'least_productive' => $teamEfficiencyRanked->sortBy('efficiency_score')->first(),
            ],
            'live_monitoring' => [
                'selected_user' => $selectedUserLive,
                'working_now' => $liveMonitoringRows->where('is_working', true)->take(10)->values(),
                'all_users' => $liveMonitoringRows->take(10)->values(),
                'employees_active' => $employeeLiveRows->where('work_status', 'active')->take(10)->values(),
                'employees_inactive' => $employeeLiveRows->where('work_status', 'inactive')->take(10)->values(),
                'employees_on_leave' => $employeeLiveRows->where('work_status', 'on_leave')->take(10)->values(),
            ],
            'recent_screenshots' => $recentScreenshots,
        ]);
    }

    private function buildSelectedEmployeeSummary(
        User $selectedUser,
        Collection $entries,
        Carbon $startDate,
        Carbon $endDate,
        Carbon $resolvedNow,
    ): array {
        $activities = $this->activityFeedService->forUsersInRange([$selectedUser->id], $startDate, $endDate);
        $idleDuration = $this->safeCalculateIdleTime($activities, [
            'report' => 'dashboard_selected_employee',
            'user_id' => $selectedUser->id,
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
        ]);
        $timeBreakdown = $this->timeBreakdownService->build(
            $this->timeEntryDurationService->sumEffectiveDuration($entries, $resolvedNow),
            $idleDuration
        );
        $isWorking = TimeEntry::query()
            ->where('user_id', $selectedUser->id)
            ->whereNull('end_time')
            ->exists();
        $browserTracking = BrowserTrackingConnection::query()
            ->where('user_id', $selectedUser->id)
            ->orderByDesc('last_seen_at')
            ->orderByDesc('last_sync_at')
            ->get();
        $selectedUserLive = [
            'user' => [
                'id' => (int) $selectedUser->id,
                'name' => $selectedUser->name,
                'email' => $selectedUser->email,
                'role' => $selectedUser->role,
            ],
            'is_working' => $isWorking,
            'current_tool' => null,
            'tool_type' => null,
            'activity_type' => null,
            'classification' => 'neutral',
            'last_activity_at' => null,
            'browser_tracking' => $this->summarizeBrowserTrackingConnections($browserTracking),
            'is_on_leave' => false,
            'work_status' => $isWorking ? 'active' : 'inactive',
        ];
        $isEmployee = strtolower((string) $selectedUser->role) === 'employee';

        return [
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'matched_users' => $matchedUsers,
            'analytics_users_count' => 1,
            'selected_user' => $selectedUser,
            'stats' => [
                'entries_count' => $entriesCount,
                'tracked_duration' => (int) ($timeBreakdown['total_duration'] ?? 0),
                'tracked_hours' => round(((int) ($timeBreakdown['total_duration'] ?? 0)) / 3600, 2),
                'total_duration' => (int) ($timeBreakdown['total_duration'] ?? 0),
                'total_hours' => round(((int) ($timeBreakdown['total_duration'] ?? 0)) / 3600, 2),
                'working_duration' => (int) ($timeBreakdown['working_duration'] ?? 0),
                'working_hours' => round(((int) ($timeBreakdown['working_duration'] ?? 0)) / 3600, 2),
                'billable_duration' => (int) ($timeBreakdown['billable_duration'] ?? 0),
                'productive_duration' => 0,
                'unproductive_duration' => 0,
                'neutral_duration' => 0,
                'context_dependent_duration' => 0,
                'activity_total_duration' => 0,
                'idle_total_duration' => (int) ($timeBreakdown['idle_duration'] ?? 0),
                'idle_avg_duration' => (int) ($timeBreakdown['idle_duration'] ?? 0),
                'activity_events' => 0,
                'is_lite' => true,
            ],
            'activity_breakdown' => [],
            'selected_user_tools' => ['productive' => [], 'unproductive' => [], 'neutral' => [], 'context_dependent' => []],
            'organization_tools' => ['productive' => [], 'unproductive' => [], 'neutral' => [], 'context_dependent' => []],
            'organization_summary' => [
                'tracked_duration' => (int) ($timeBreakdown['total_duration'] ?? 0),
                'total_duration' => (int) ($timeBreakdown['total_duration'] ?? 0),
                'working_duration' => (int) ($timeBreakdown['working_duration'] ?? 0),
                'idle_duration' => (int) ($timeBreakdown['idle_duration'] ?? 0),
                'activity_total_duration' => 0,
                'productive_duration' => 0,
                'unproductive_duration' => 0,
                'neutral_duration' => 0,
                'context_dependent_duration' => 0,
                'productive_share' => 0,
                'unproductive_share' => 0,
                'neutral_share' => 0,
                'context_dependent_share' => 0,
                'is_lite' => true,
            ],
            'employee_rankings' => [
                'most_productive' => null,
                'most_unproductive' => null,
                'by_productive_duration' => [],
                'by_unproductive_duration' => [],
            ],
            'team_rankings' => [
                'by_efficiency' => [],
                'top_productive' => null,
                'least_productive' => null,
            ],
            'live_monitoring' => [
                'selected_user' => $selectedUserLive,
                'working_now' => $isWorking ? [$selectedUserLive] : [],
                'all_users' => [$selectedUserLive],
                'employees_active' => $isWorking && $isEmployee ? [$selectedUserLive] : [],
                'employees_inactive' => ! $isWorking && $isEmployee ? [$selectedUserLive] : [],
                'employees_on_leave' => [],
            ],
            'recent_screenshots' => [],
        ];
    }

    private function csvValue(string $value): string
    {
        $escaped = str_replace('"', '""', $value);
        return '"'.$escaped.'"';
    }
}
