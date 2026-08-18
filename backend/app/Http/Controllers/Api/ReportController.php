<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\AttendanceHoliday;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\BreakTime;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Project;
use App\Models\ReportGroup;
use App\Models\Screenshot;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Authorization\GroupAccessService;
use App\Services\Monitoring\ActivityFeedService;
use App\Services\Reports\ActivityProductivityService;
use App\Services\Reports\DashboardSummaryService;
use App\Services\Reports\IdleValidationService;
use App\Services\Reports\ReportPayloadBuilder;
use App\Services\Reports\TimeBreakdownService;
use App\Services\Reports\UsageProcessingService;
use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Throwable;

class ReportController extends Controller
{
    /** Hierarchy level at and below which a user is an ordinary employee. */
    private const EMPLOYEE_HIERARCHY_LEVEL = 100;

    private const CUSTOM_EXPORT_ALLOWED_FIELDS = [
        'start_date',
        'end_date',
        'employee_name',
        'employee_email',
        'employee_region',
        'department',
        'working_days',
        'present_days',
        'leave_days',
        'late_days',
        'absent_days',
        'attendance_rate',
        'tracked_time',
        'worked_time',
        'idle_time',
        'working_time',
        'overtime_time',
        'first_check_in_at',
        'last_check_out_at',
    ];

    private const CUSTOM_EXPORT_DEFAULT_FIELDS = [
        'start_date',
        'end_date',
        'employee_name',
        'employee_email',
        'employee_region',
        'department',
        'working_days',
        'present_days',
        'leave_days',
        'late_days',
        'absent_days',
        'attendance_rate',
        'tracked_time',
        'worked_time',
        'idle_time',
        'working_time',
        'overtime_time',
        'first_check_in_at',
        'last_check_out_at',
    ];

    private const CUSTOM_EXPORT_DURATION_FIELDS = [
        'tracked_time',
        'worked_time',
        'idle_time',
        'working_time',
        'overtime_time',
    ];

    private const CUSTOM_EXPORT_FIELD_LABELS = [
        'start_date' => 'Start Date',
        'end_date' => 'End Date',
        'employee_name' => 'Employee Name',
        'employee_email' => 'Employee Email',
        'employee_region' => 'Employee Region',
        'department' => 'Department',
        'working_days' => 'Working Days',
        'present_days' => 'Present Days',
        'leave_days' => 'Leave Days',
        'late_days' => 'Late Days',
        'absent_days' => 'Absent Days',
        'attendance_rate' => 'Attendance Rate (%)',
        'tracked_time' => 'Tracked Time',
        'worked_time' => 'Worked Time',
        'idle_time' => 'Idle Time',
        'working_time' => 'Working Time',
        'overtime_time' => 'Overtime Time',
        'first_check_in_at' => 'First Check-In',
        'last_check_out_at' => 'Last Check-Out',
    ];

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

    /**
     * Ceiling on how many employees the organisation-wide analytics loop covers.
     *
     * Generous rather than tight: the set it applies to is already narrowed to
     * people with something recorded in the range, so on any ordinary day it is
     * nowhere near reached. When it IS reached the response says so through
     * `analytics_users_truncated`, because a total quietly computed over part of
     * the workforce is the defect this constant exists to bound, not create.
     */
    private const ANALYTICS_USER_LIMIT = 200;

    public function __construct(
        private readonly ActivityProductivityService $activityProductivityService,
        private readonly DashboardSummaryService $dashboardSummaryService,
        private readonly IdleValidationService $idleValidationService,
        private readonly ReportPayloadBuilder $reportPayloadBuilder,
        private readonly TimeBreakdownService $timeBreakdownService,
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly UsageProcessingService $usageProcessingService,
        private readonly ActivityFeedService $activityFeedService,
        private readonly GroupAccessService $groupAccessService,
    ) {
    }

    private function canViewAll(?User $user): bool
    {
        return $user && $user->getHierarchyLevel() < 100;
    }

    private function hasManagerRole(User $user): bool
    {
        return $user->getHierarchyLevel() <= 50 && $user->getHierarchyLevel() > 10;
    }

    private function normalizeDepartmentIdsFilter(Request $request): void
    {
        if (! $request->exists('department_ids')) {
            return;
        }

        $departmentIds = $request->input('department_ids');

        if (! $request->exists('group_ids')) {
            $request->merge([
                'group_ids' => $departmentIds,
            ]);

            return;
        }

        $groupIds = $request->input('group_ids');
        if (is_array($groupIds) && is_array($departmentIds)) {
            $request->merge([
                'group_ids' => array_values(array_unique(array_merge($groupIds, $departmentIds))),
            ]);
        }
    }

    private function restrictMonitoringToEmployees(?User $user): bool
    {
        $level = $user?->getHierarchyLevel() ?? 999;
        return $level > 10 && $level < 100;
    }

    private function managerGroupIds(User $user): array
    {
        return $user->groups()
            ->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    /**
     * The employees organisation-wide analytics should actually aggregate over:
     * those with tracked time or recorded activity somewhere in the range.
     *
     * Both sources are consulted because they can disagree. A time entry with no
     * activity is someone whose timer ran while the tracker sent nothing, and
     * activity with no entry in range is a session that began the previous day.
     * Either way there are figures to account for, so both belong in the total.
     */
    private function analyticsUsersForRange(Builder $usersQuery, Carbon $startDate, Carbon $endDate): Collection
    {
        $visibleIds = (clone $usersQuery)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values();

        if ($visibleIds->isEmpty()) {
            return collect();
        }

        $withTrackedTime = TimeEntry::whereIn('user_id', $visibleIds)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->distinct()
            ->pluck('user_id');

        $withActivity = Activity::whereIn('user_id', $visibleIds)
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->distinct()
            ->pluck('user_id');

        $activeIds = $withTrackedTime
            ->merge($withActivity)
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        if ($activeIds->isEmpty()) {
            return collect();
        }

        return (clone $usersQuery)
            ->whereIn('id', $activeIds)
            ->orderBy('name')
            ->limit(self::ANALYTICS_USER_LIMIT)
            ->get(['id', 'name', 'email', 'role']);
    }

    private function visibleUsersQuery(User $user, bool $excludeHigherOrEqualRank = false): Builder
    {
        $query = User::query()->where('organization_id', $user->organization_id);
        $userLevel = $user->getHierarchyLevel();

        if ($userLevel <= 10) {
            return $query;
        }

        /*
         * Employee tier sees only themselves.
         *
         * Without this the next branch scopes by shared group membership, which
         * is a peer relationship rather than a chain of command — so an ordinary
         * employee in two groups could read the attendance rates, worked hours
         * and per-day absence dates of everyone in both. Colleagues' presence is
         * a real need and it is served by /attendance/team-presence, which is
         * scoped to one department and carries no analytics.
         *
         * The 100 boundary is the same one restrictMonitoringToEmployees() uses
         * to mean "below manager".
         */
        if ($userLevel >= self::EMPLOYEE_HIERARCHY_LEVEL) {
            return $query->where('id', $user->id);
        }

        $groupIds = $this->managerGroupIds($user);
        if ($groupIds === []) {
            return User::query()->whereRaw('1 = 0');
        }

        if ($excludeHigherOrEqualRank) {
            $query->where(function (Builder $q) use ($userLevel, $user) {
                $q->whereHas('customRole', fn (Builder $q2) => $q2->where('hierarchy_level', '>', $userLevel))
                    ->orWhere(function (Builder $q2) use ($userLevel) {
                        $q2->whereNull('role_id')
                            ->whereRaw("CASE role WHEN 'admin' THEN 10 WHEN 'manager' THEN 50 WHEN 'employee' THEN 100 ELSE 999 END > ?", [$userLevel]);
                    })
                    /*
                     * The caller is NOT added back in here.
                     *
                     * This branch runs only when the caller asked to exclude
                     * everyone at or above their own rank — it is reached as
                     * restrictMonitoringToEmployees(). A manager is at their own
                     * rank by definition, so re-adding them with an orWhere
                     * contradicted the flag and put the manager's own
                     * monitoring data into a report the organisation had
                     * restricted to employees.
                     *
                     * Seeing yourself in a report is a real need, but it belongs
                     * to the reports that do not pass this flag: those return
                     * the whole group, the caller included.
                     */
                    ;
            });
        }

        return $query->whereHas('groups', fn (Builder $groupQuery) => $groupQuery->whereIn('groups.id', $groupIds));
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

    private function resolveLastActivityByUser(iterable $userIds, Carbon $startDate, Carbon $endDate): array
    {
        $ids = collect($userIds)
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return [];
        }

        return Activity::query()
            ->selectRaw('user_id, MAX(recorded_at) as last_activity_at')
            ->whereIn('user_id', $ids->all())
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->groupBy('user_id')
            ->get()
            ->mapWithKeys(fn ($row) => [(int) $row->user_id => $row->last_activity_at])
            ->all();
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

    private function limitToolBreakdown(array $toolBreakdown, int $limit = 25): array
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

    private function resolveReportListEntries(Request $request, Builder $query, int $defaultLimit = 2000): array
    {
        if ($request->has('page') || $request->has('per_page')) {
            $page = max(1, (int) $request->integer('page', 1));
            $perPage = min(200, max(1, (int) $request->integer('per_page', 50)));
            $paginator = $query->paginate($perPage, page: $page);

            return [
                'entries' => $paginator->getCollection(),
                'pagination' => [
                    'current_page' => $paginator->currentPage(),
                    'per_page' => $paginator->perPage(),
                    'total' => $paginator->total(),
                    'last_page' => $paginator->lastPage(),
                ],
            ];
        }

        // Bounded safety cap so org-wide ranges can't materialize unbounded
        // rows into memory. Self-scope requests are effectively never near it.
        return [
            'entries' => $query->limit($defaultLimit)->get(),
            'pagination' => null,
        ];
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

        $resolved = $this->resolveReportListEntries($request, $query);
        $timeEntries = $resolved['entries'];

        $response = array_merge(
            ['date' => $date],
            $this->reportPayloadBuilder->buildCommonReportPayload(
                $timeEntries,
                Carbon::parse($date)->startOfDay(),
                Carbon::parse($date)->endOfDay()
            )
        );
        if ($resolved['pagination']) {
            $response['pagination'] = $resolved['pagination'];
        }

        return response()->json($response);
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

        $resolved = $this->resolveReportListEntries($request, $query);
        $timeEntries = $resolved['entries'];

        $response = array_merge(
            [
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
            ],
            $this->reportPayloadBuilder->buildCommonReportPayload($timeEntries, $startDate, $endDate)
        );
        if ($resolved['pagination']) {
            $response['pagination'] = $resolved['pagination'];
        }

        return response()->json($response);
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

        $resolved = $this->resolveReportListEntries($request, $query);
        $timeEntries = $resolved['entries'];

        $resolvedNow = now();
        $byDay = $timeEntries->where('is_break', false)->groupBy(function ($entry) {
            return Carbon::parse($entry->start_time)->toDateString();
        })->map(function ($entries) use ($resolvedNow) {
            return [
                'date' => Carbon::parse($entries->first()->start_time)->toDateString(),
                'total_time' => $this->timeEntryDurationService->sumEffectiveDuration($entries, $resolvedNow),
            ];
        })->values();

        $response = array_merge(
            [
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
                'by_day' => $byDay,
            ],
            $this->reportPayloadBuilder->buildCommonReportPayload($timeEntries, $startDate, $endDate)
        );
        if ($resolved['pagination']) {
            $response['pagination'] = $resolved['pagination'];
        }

        return response()->json($response);
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

        $resolvedNow = now();
        $workedEntries = $this->workedEntries($entries);
        $breakSeconds = $this->totalBreakSeconds($entries, $resolvedNow);

        $trackedDuration = $this->timeEntryDurationService->sumEffectiveDuration($workedEntries, $resolvedNow)
            + (int) AttendanceRecord::query()
                ->where('user_id', $user->id)
                ->whereBetween('attendance_date', [$startDate->toDateString(), $endDate->toDateString()])
                ->sum('manual_adjustment_seconds');
        $activities = $this->activityFeedService->forUsersInRangeForIdle([$user->id], $startDate, $endDate);
        $activityTotalDuration = (int) $activities->sum('duration');
        // Only non-idle activity for pro-rata (idle records inflate the total)
        $nonIdleActivityDuration = (int) $activities->reject(fn ($a) => ($a->type ?? null) === 'idle')->sum('duration');
        $idleDuration = $this->safeCalculateIdleTime($activities, [
            'report' => 'productivity',
            'user_id' => $user->id,
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
        ]);
        $timeBreakdown = $this->timeBreakdownService->build($trackedDuration, $idleDuration, $nonIdleActivityDuration);
        $score = $this->timeBreakdownService->productivityScore($trackedDuration, $idleDuration);

        return response()->json([
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'productivity_score' => $score,
            'tracked_time' => $timeBreakdown['total_duration'],
            'working_time' => $timeBreakdown['working_duration'],
            'active_time' => $timeBreakdown['working_duration'],
            'idle_time' => $timeBreakdown['idle_duration'],
            'break_seconds' => $breakSeconds,
            'break_hours' => round($breakSeconds / 3600, 2),
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
        $userIds = $users->pluck('id')->all();

        // Bulk-load all entries for the org in a single query, then group in
        // PHP. This replaces the previous per-user query loop (N+1) so the
        // query count stays constant regardless of org size. The result is
        // cached per org + date range + data fingerprint so repeated admin
        // views of the same range are essentially free (mirrors the
        // employee_insights buildCachedUserRangeSummary pattern).
        $fingerprint = $this->fingerprintTimeEntryRange($userIds, $startDate, $endDate);
        $ttl = (int) config('usage_processing.cache.ttl_seconds', 300);
        $ttl = max(30, min($ttl, 600));
        $cacheKey = sprintf(
            'reports.team:%d:%s:%s:%s',
            $currentUser->organization_id,
            $startDate,
            $endDate,
            $fingerprint
        );

        $byUser = Cache::remember($cacheKey, $ttl, function () use ($users, $userIds, $startDate, $endDate) {
            $entries = TimeEntry::with('project', 'task')
                ->whereIn('user_id', $userIds)
                ->whereBetween('start_time', [$startDate, $endDate])
                ->get();
            $entriesByUser = $entries->groupBy('user_id');

            $resolvedNow = now();

            return $users->map(function (User $user) use ($entriesByUser, $resolvedNow) {
                $userEntries = $entriesByUser->get($user->id, collect());

                return [
                    'user' => $user,
                    'total_time' => $this->timeEntryDurationService->sumEffectiveDuration($userEntries, $resolvedNow),
                    'entries' => $userEntries->values(),
                ];
            })->values();
        });

        return response()->json([
            'start_date' => $startDate,
            'end_date' => $endDate,
            'by_user' => $byUser,
        ]);
    }

    /**
     * Stable, short fingerprint for a range of time entries. Uses entry count
     * + max(id) + latest write timestamp so two requests over unchanged data
     * hash identically and cached report payloads stay valid.
     */
    private function fingerprintTimeEntryRange(array $userIds, $startDate, $endDate): string
    {
        if ($userIds === []) {
            return 'empty';
        }

        $row = TimeEntry::query()
            ->whereIn('user_id', $userIds)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->selectRaw('COUNT(*) as cnt, COALESCE(MAX(id), 0) as max_id, COALESCE(MAX(updated_at), MAX(created_at)) as max_ts')
            ->first();

        return substr(md5(sprintf('%d|%d|%s', (int) $row->cnt, (int) $row->max_id, (string) $row->max_ts)), 0, 16);
    }

    public function overall(Request $request)
    {
        $this->normalizeDepartmentIdsFilter($request);

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

        try {

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
                    'by_user_day' => [],
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
        // Overtime is measured against working days, not calendar days — a
        // Mon–Sun range owes 5 days of work, not 7. The client used to look for
        // these two keys on every row, but this report never sent them, so its
        // day count silently fell back to 1 and it reported nearly all tracked
        // time as overtime.
        $workingDaysCount = max(1, collect(CarbonPeriod::create($startDate->copy()->startOfDay(), $endDate->copy()->startOfDay()))
            ->reject(fn (Carbon $date) => $date->isWeekend())
            ->count());
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
                'by_user_day' => [],
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
            ->get(['id', 'user_id', 'start_time', 'end_time', 'duration', 'is_break']);
        $attendanceAdjustments = AttendanceRecord::query()
            ->whereIn('user_id', $userIds)
            ->whereBetween('attendance_date', [$startDate->toDateString(), $endDate->toDateString()])
            ->get(['id', 'user_id', 'attendance_date', 'check_in_at', 'check_out_at', 'manual_adjustment_seconds']);

        // is_break excluded: an open break entry is not "working". Without this
        // the reports and AttendanceService (which does filter) disagreed about
        // the same person at the same moment.
        $activeUserIds = TimeEntry::whereIn('user_id', $userIds)
            ->whereNull('end_time')
            ->where('is_break', false)
            ->distinct()
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id);

        // Date-scoped: an orphaned open break_times row from a previous day
        // otherwise reported the user as on-break forever.
        $onBreakUserIds = $userIds->isEmpty()
            ? collect()
            : BreakTime::whereIn('user_id', $userIds)
                ->whereNull('end_at')
                ->whereDate('break_date', now()->toDateString())
                ->pluck('user_id')
                ->map(fn ($id) => (int) $id)
                ->unique();

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
        $idleSummary = $skipActivity
            ? ['by_user' => [], 'by_user_day' => []]
            : $this->summarizeIdleDurationsForUsers($userIds, $startDate, $endDate);
        $idleDurationByUser = collect($idleSummary['by_user'] ?? [])
            ->mapWithKeys(fn ($duration, $id) => [(int) $id => (int) $duration])
            ->all();
        $idleDurationByUserDay = collect($idleSummary['by_user_day'] ?? [])
            ->mapWithKeys(fn ($duration, $key) => [(string) $key => (int) $duration])
            ->all();
        $lastActivityByUser = $skipActivity
            ? []
            : $this->resolveLastActivityByUser($userIds, $startDate, $endDate);

        $workedEntries = $this->workedEntries($entries);
        $totalBreakSeconds = $this->totalBreakSeconds($entries, $resolvedNow ?? now());
        $entriesByUser = $workedEntries->groupBy('user_id');
        $breakEntriesByUser = $entries->where('is_break', true)->values()->groupBy('user_id');
        $adjustmentsByUser = $attendanceAdjustments->groupBy('user_id');

        $resolvedNow = now();

        $byUser = $users->map(function ($user) use ($entriesByUser, $breakEntriesByUser, $adjustmentsByUser, $idleDurationByUser, $lastActivityByUser, $activeUserIds, $onBreakUserIds, $resolvedNow, $calendarDaysCount, $workingDaysCount) {
            $userEntries = $entriesByUser->get($user->id, collect());
            $userBreakSeconds = $this->totalBreakSeconds($breakEntriesByUser->get($user->id, collect()), $resolvedNow);
            $userAttendanceRecords = $adjustmentsByUser->get($user->id, collect());
            $userAdjustmentDuration = (int) $userAttendanceRecords
                ->sum(fn (AttendanceRecord $record) => (int) ($record->manual_adjustment_seconds ?? 0));
            $idleDuration = (int) ($idleDurationByUser[(int) $user->id] ?? 0);
            $timeBreakdown = $this->timeBreakdownService->build(
                $this->timeEntryDurationService->sumEffectiveDuration($userEntries, $resolvedNow) + $userAdjustmentDuration,
                $idleDuration
            );
            $attendanceSummary = $this->buildOverallAttendanceSummary($userAttendanceRecords, $calendarDaysCount);

            return [
                'user' => $user,
                'entries_count' => $userEntries->count(),
                'last_activity_at' => $lastActivityByUser[(int) $user->id] ?? null,
                'is_working' => $activeUserIds->contains((int) $user->id),
                'is_on_break' => $onBreakUserIds->contains((int) $user->id),
                'break_seconds' => $userBreakSeconds,
                'break_hours' => round($userBreakSeconds / 3600, 2),
                'calendar_days_in_range' => $calendarDaysCount,
                'working_days_in_range' => $workingDaysCount,
            ] + $timeBreakdown + $attendanceSummary;
        })->values();

        $dayUserBuckets = [];
        foreach ($workedEntries as $entry) {
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

        foreach ($idleDurationByUserDay as $key => $idleDuration) {
            [, $date] = explode('|', (string) $key, 2);
            if (! isset($dayUserBuckets[$key])) {
                $dayUserBuckets[$key] = [
                    'date' => $date,
                    'total_duration' => 0,
                    'idle_duration' => 0,
                ];
            }

            $dayUserBuckets[$key]['idle_duration'] = (int) $idleDuration;
        }

        // The per-user-per-day matrix used to be built here and then collapsed
        // away by the groupBy below, so nothing downstream could ever show that
        // someone logged fourteen hours on Tuesday and none on Wednesday. It is
        // returned as `by_user_day` now; `by_day` keeps its existing shape.
        $byUserDay = collect($dayUserBuckets)
            ->map(function (array $bucket, $key) {
                [$userId] = explode('|', (string) $key, 2);

                return [
                    'user_id' => (int) $userId,
                    'date' => $bucket['date'],
                ] + $this->timeBreakdownService->build(
                    (int) ($bucket['total_duration'] ?? 0),
                    (int) ($bucket['idle_duration'] ?? 0)
                );
            })
            ->sortBy(fn (array $row) => $row['user_id'].'|'.$row['date'])
            ->values();

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
                'total_break_seconds' => $totalBreakSeconds,
                'break_hours' => round($totalBreakSeconds / 3600, 2),
            ] + $summaryBreakdown,
            'users' => $users,
            'by_user' => $byUser,
            'by_day' => $byDay,
            'by_user_day' => $byUserDay,
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
        } catch (Throwable $exception) {
            Log::error('Overall report generation failed; returning safe fallback payload.', [
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
                'user_id' => $currentUser->id,
                'organization_id' => $currentUser->organization_id,
            ]);

            $fallback = [
                'start_date' => (string) $request->get('start_date', Carbon::now()->startOfMonth()->toDateString()),
                'end_date' => (string) $request->get('end_date', Carbon::now()->toDateString()),
                'summary' => [
                    'users_count' => 0,
                    'page_users_count' => 0,
                    'active_users' => 0,
                ] + $this->timeBreakdownService->build(0, 0),
                'users' => [],
                'by_user' => [],
                'by_day' => [],
                'by_user_day' => [],
            ];

            if ($request->has('page') || $request->has('per_page')) {
                $fallback['pagination'] = [
                    'current_page' => max(1, (int) $request->integer('page', 1)),
                    'per_page' => min(100, max(1, (int) $request->integer('per_page', 25))),
                    'total' => 0,
                    'last_page' => 1,
                ];
            }

            return response()->json($fallback);
        }
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
        $workedEntries = $this->workedEntries($entries);
        $totalBreakSeconds = $this->totalBreakSeconds($entries, $resolvedNow);
        $entriesByUser = $workedEntries->groupBy('user_id');
        $breakEntriesByUser = $entries->where('is_break', true)->values()->groupBy('user_id');
        $adjustmentsByUser = $attendanceAdjustments->groupBy('user_id');
        $userIds = $users->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values();
        // Date-scoped: an orphaned open break_times row from a previous day
        // otherwise reported the user as on-break forever.
        $onBreakUserIds = $userIds->isEmpty()
            ? collect()
            : BreakTime::whereIn('user_id', $userIds)
                ->whereNull('end_at')
                ->whereDate('break_date', now()->toDateString())
                ->pluck('user_id')
                ->map(fn ($id) => (int) $id)
                ->unique();
        $idleSummary = $skipActivity
            ? ['by_user' => [], 'by_user_day' => []]
            : $this->usageProcessingService->summarizeIdleDurationsFastForUsers($userIds, $startDate, $endDate);
        $idleDurationByUser = collect($idleSummary['by_user'] ?? [])
            ->mapWithKeys(fn ($duration, $id) => [(int) $id => (int) $duration])
            ->all();
        $idleDurationByUserDay = collect($idleSummary['by_user_day'] ?? [])
            ->mapWithKeys(fn ($duration, $key) => [(string) $key => (int) $duration])
            ->all();
        $lastActivityByUser = $skipActivity
            ? []
            : $this->resolveLastActivityByUser($userIds, $startDate, $endDate);

        // Fetch activity data for proper idle time calculation consistency with filtered views
        $activitiesByUser = collect();
        if (! $skipActivity) {
            $activities = $this->activityFeedService->forUsersInRangeForIdle($userIds, $startDate, $endDate);
            $activitiesByUser = $activities->groupBy(fn ($activity) => (int) ($activity->user_id ?? 0));
        }

        $byUser = $users->map(function ($user) use ($entriesByUser, $breakEntriesByUser, $adjustmentsByUser, $idleDurationByUser, $lastActivityByUser, $activeUserIds, $onBreakUserIds, $resolvedNow, $calendarDaysCount, $activitiesByUser, $startDate, $endDate) {
            $userEntries = $entriesByUser->get($user->id, collect());
            $userBreakSeconds = $this->totalBreakSeconds($breakEntriesByUser->get($user->id, collect()), $resolvedNow);
            $userAttendanceRecords = $adjustmentsByUser->get($user->id, collect());
            $adjustmentDuration = (int) $userAttendanceRecords
                ->sum(fn (AttendanceRecord $record) => (int) ($record->manual_adjustment_seconds ?? 0));
            $trackedDuration = $this->timeEntryDurationService->sumEffectiveDuration($userEntries, $resolvedNow) + $adjustmentDuration;
            $rawIdleDuration = (int) ($idleDurationByUser[(int) $user->id] ?? 0);
            
            // Non-idle activity duration for pro-rata scaling.
            // IMPORTANT: idle records inflate the total (cumulative updates sum to more
            // than the merged interval), which incorrectly reduces idle via pro-rata.
            $userActivities = $activitiesByUser->get($user->id, collect());
            $nonIdleActivityDuration = (int) $userActivities->reject(fn ($a) => ($a->type ?? null) === 'idle')->sum('duration');
            
            // Enhanced idle validation with automatic correction
            $validatedIdle = $this->idleValidationService->validateIdleTime(
                $user->id,
                $trackedDuration,
                $rawIdleDuration,
                $nonIdleActivityDuration,
                [
                    'source' => 'buildLiteOverallReport',
                    'start_date' => $startDate->toDateTimeString(),
                    'end_date' => $endDate->toDateTimeString(),
                    'original_idle' => $rawIdleDuration,
                ]
            );
            
            $idleDuration = $validatedIdle['idle_duration'];
            
            $timeBreakdown = $this->timeBreakdownService->build(
                $trackedDuration,
                $idleDuration,
                $nonIdleActivityDuration
            );
            $attendanceSummary = $this->buildOverallAttendanceSummary($userAttendanceRecords, $calendarDaysCount);

            return [
                'user' => $user,
                'entries_count' => $userEntries->count(),
                'last_activity_at' => $lastActivityByUser[(int) $user->id] ?? null,
                'is_working' => $activeUserIds->contains((int) $user->id),
                'is_on_break' => $onBreakUserIds->contains((int) $user->id),
                'break_seconds' => $userBreakSeconds,
                'break_hours' => round($userBreakSeconds / 3600, 2),
                'idle_validated' => $validatedIdle['corrected'],
                'idle_validation_reason' => $validatedIdle['reason'],
            ] + $timeBreakdown + $attendanceSummary;
        })->values();

        $dayUserBuckets = [];
        foreach ($workedEntries as $entry) {
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

        foreach ($idleDurationByUserDay as $key => $idleDuration) {
            [, $date] = explode('|', (string) $key, 2);
            if (! isset($dayUserBuckets[$key])) {
                $dayUserBuckets[$key] = [
                    'date' => $date,
                    'total_duration' => 0,
                    'idle_duration' => 0,
                ];
            }

            $dayUserBuckets[$key]['idle_duration'] = (int) $idleDuration;
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
                'total_break_seconds' => $totalBreakSeconds,
                'break_hours' => round($totalBreakSeconds / 3600, 2),
                'is_lite' => true,
            ] + $summaryBreakdown,
            'users' => $users,
            'by_user' => $byUser,
            'by_day' => $byDay,
        ];
    }

    private function summarizeIdleDurationsForUsers(iterable $userIds, Carbon $startDate, Carbon $endDate): array
    {
        return $this->usageProcessingService->summarizeIdleDurationsFastForUsers($userIds, $startDate, $endDate);
    }

    /**
     * Cached wrapper around UsageProcessingService::buildWebAppUsageUserRangeSummary.
     *
     * employeeInsights() runs this inside a per-user loop (up to ~50 users) and
     * is the most expensive endpoint in the report suite. The underlying
     * buildCachedDailySummary call already short-circuits unchanged days
     * (UsageProcessingService::buildFingerprint), but the per-day grouping,
     * combineUsageSummaries merge, and tool_breakdown fan-out are re-run for
     * every request. This cache wraps the whole range result with a short TTL
     * keyed on user + date range + a fingerprint of the input activity set, so
     * repeated admin views of the same range within ~2 minutes are free.
     */
    private function buildCachedUserRangeSummary(
        int $userId,
        iterable $activities,
        Carbon $startDate,
        Carbon $endDate,
        bool $includeProcessedLogs = true,
    ): array {
        $fingerprint = $this->fingerprintActivitySet($activities);
        $cacheKey = sprintf(
            'employee_insights.user_range:%d:%s:%s:%s:%d',
            $userId,
            $startDate->toDateString(),
            $endDate->toDateString(),
            $fingerprint,
            $includeProcessedLogs ? 1 : 0,
        );
        $ttl = (int) config('usage_processing.cache.ttl_seconds', 300);
        $ttl = max(30, min($ttl, 600));

        return Cache::remember(
            $cacheKey,
            $ttl,
            fn () => $this->usageProcessingService->buildWebAppUsageUserRangeSummary(
                $userId,
                collect($activities)->values(),
                $startDate,
                $endDate,
                activityEvents: [],
                includeProcessedLogs: $includeProcessedLogs,
            )
        );
    }

    /**
     * Stable, short fingerprint for an iterable of activity-like records.
     * Uses max(id) + count + max(recorded_at) so two requests with the same
     * underlying data hash identically. Falls back to count-only when ids
     * are missing (e.g. mocked test data).
     */
    private function fingerprintActivitySet(iterable $activities): string
    {
        $count = 0;
        $maxId = 0;
        $maxRecordedAt = '';
        foreach ($activities as $activity) {
            $count++;
            $id = (int) data_get($activity, 'id', 0);
            if ($id > $maxId) {
                $maxId = $id;
            }
            $recordedAt = (string) data_get($activity, 'recorded_at', '');
            if ($recordedAt !== '' && $recordedAt > $maxRecordedAt) {
                $maxRecordedAt = $recordedAt;
            }
        }

        return substr(md5(sprintf('%d|%d|%s', $count, $maxId, $maxRecordedAt)), 0, 16);
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
        $workedEntries = $this->workedEntries($entries);
        $breakSeconds = $this->totalBreakSeconds($entries, now());
        $idleDuration = 0;
        if ($entries->isNotEmpty()) {
            $activities = $this->activityFeedService->forTimeEntriesForIdle($workedEntries->pluck('id'), $startDate, $endDate);
            $idleDuration = $this->safeCalculateIdleTime($activities, [
                'report' => 'project',
                'project_id' => $project->id,
                'scope' => 'summary',
            ]);
        }
        $timeBreakdown = $this->timeBreakdownService->build(
            $this->timeEntryDurationService->sumEffectiveDuration($workedEntries, now()),
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
            'break_seconds' => $breakSeconds,
            'break_hours' => round($breakSeconds / 3600, 2),
        ] + $timeBreakdown);
    }

    public function export(Request $request)
    {
        $this->normalizeDepartmentIdsFilter($request);

        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'user_ids' => 'nullable|array',
            'user_ids.*' => 'integer',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
            'export_scope' => 'nullable|string|in:employee,department',
            'fields' => 'nullable|array',
            'fields.*' => 'string',
            'report_type' => 'nullable|string|in:attendance,hours-tracked,timeline,projects-tasks,web-app-usage,productivity,productive-time,unproductive-time,app-usage,website-usage,screenshots',
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

        $scopedUsers = $this->resolveScopedExportUsers($request, $user);
        $scopedUserIds = $scopedUsers
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        $requestedScope = strtolower(trim((string) $request->input('export_scope', '')));
        $requestedFields = collect((array) $request->input('fields', []))
            ->map(fn ($field) => strtolower(trim((string) $field)))
            ->filter(fn ($field) => in_array($field, self::CUSTOM_EXPORT_ALLOWED_FIELDS, true))
            ->values();
        $isCustomExport = $request->filled('export_scope') || $request->has('fields');

        if ($isCustomExport) {
            $selectedFields = $requestedFields;
            if ($selectedFields->isEmpty()) {
                $selectedFields = collect(self::CUSTOM_EXPORT_DEFAULT_FIELDS);
            }

            $selectedFieldSet = $selectedFields
                ->map(fn ($field) => (string) $field)
                ->flip();
            $selectedFields = collect(self::CUSTOM_EXPORT_DEFAULT_FIELDS)
                ->filter(fn ($field) => $selectedFieldSet->has((string) $field))
                ->values();

            $exportScope = in_array($requestedScope, ['employee', 'department'], true)
                ? $requestedScope
                : 'employee';

            $csv = $this->buildCustomExportCsv(
                $user,
                $scopedUsers,
                $selectedFields,
                $exportScope,
                $startDate,
                $endDate
            );
            $fileName = sprintf(
                'custom-export-%s-%s-to-%s.csv',
                $exportScope,
                $startDate->toDateString(),
                $endDate->toDateString()
            );

            return response($csv, 200, [
                'Content-Type' => 'text/csv',
                'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
            ]);
        }

        $reportType = strtolower(trim((string) $request->input('report_type', '')));
        $entryTz = $this->resolveExportTimezone($user);

        // ── Attendance Report ──────────────────────────────────────────────
        if ($reportType === 'attendance') {
            return $this->buildAttendanceExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Hours Tracked Report ───────────────────────────────────────────
        if ($reportType === 'hours-tracked') {
            return $this->buildHoursTrackedExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Timeline Report ────────────────────────────────────────────────
        if ($reportType === 'timeline') {
            return $this->buildTimelineExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Projects & Tasks Report ────────────────────────────────────────
        if ($reportType === 'projects-tasks') {
            return $this->buildProjectsTasksExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Web & App Usage Report ─────────────────────────────────────────
        if ($reportType === 'web-app-usage') {
            return $this->buildWebAppUsageExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Productivity Report ────────────────────────────────────────────
        if ($reportType === 'productivity') {
            return $this->buildProductivityExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Productive Time Report ────────────────────────────────────────
        if ($reportType === 'productive-time') {
            return $this->buildProductiveTimeExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Unproductive Time Report ──────────────────────────────────────
        if ($reportType === 'unproductive-time') {
            return $this->buildUnproductiveTimeExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── App Usage Report ──────────────────────────────────────────────
        if ($reportType === 'app-usage') {
            return $this->buildAppUsageExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Website Usage Report ──────────────────────────────────────────
        if ($reportType === 'website-usage') {
            return $this->buildWebsiteUsageExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Screenshots Report ────────────────────────────────────────────
        if ($reportType === 'screenshots') {
            return $this->buildScreenshotsExportCsv($user, $scopedUserIds, $startDate, $endDate, $entryTz);
        }

        // ── Default: Generic time-entry export (reports-hub / analytics-hub) ──
        $entriesQuery = TimeEntry::with(['project', 'task', 'user'])
            ->whereBetween('start_time', [$startDate, $endDate])
            ->where('is_break', false);

        if ($this->canViewAll($user) && $user->organization_id) {
            $entriesQuery->whereIn('user_id', $scopedUserIds->all());
        } else {
            $entriesQuery->where('user_id', $user->id);
        }

        $entries = $entriesQuery->orderBy('start_time')->get();

        $bom = "\xEF\xBB\xBF";
        $lines = ['Date,Employee,Email,Department,Project,Task,Description,Duration,Duration (Hours),Start Time,End Time'];

        foreach ($entries as $entry) {
            $durationSeconds = (int) ($entry->duration ?? 0);
            $durationFormatted = $this->formatDurationForExport($durationSeconds);
            $durationHours = round($durationSeconds / 3600, 2);

            $startDateVal = $entry->start_time
                ? Carbon::parse($entry->start_time)->setTimezone($entryTz)->format('d-M-Y')
                : '';
            $startTime = $entry->start_time
                ? Carbon::parse($entry->start_time)->setTimezone($entryTz)->format('h:i A')
                : '';
            $endTime = $entry->end_time
                ? Carbon::parse($entry->end_time)->setTimezone($entryTz)->format('h:i A')
                : '';

            $lines[] = implode(',', [
                $startDateVal,
                $this->csvValue($entry->user?->name ?? 'Unknown User'),
                $this->csvValue($entry->user?->email ?? ''),
                $this->csvValue($this->resolveExportDepartment($entry->user)),
                $this->csvValue($entry->project?->name ?? 'No Project'),
                $this->csvValue($entry->task?->title ?? ''),
                $this->csvValue($entry->description ?? ''),
                $this->csvValue($durationFormatted),
                $durationHours,
                $startTime,
                $endTime,
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'report-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Attendance Report CSV Builder ──────────────────────────────────────
    private function buildAttendanceExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $records = AttendanceRecord::with(['user'])
            ->whereBetween('attendance_date', [$startDate->toDateString(), $endDate->toDateString()]);

        if ($this->canViewAll($user) && $user->organization_id) {
            $records->whereIn('user_id', $scopedUserIds->all());
        } else {
            $records->where('user_id', $user->id);
        }

        $records = $records->orderBy('attendance_date')->get();

        $bom = "\xEF\xBB\xBF";
        $lines = ['Employee Name,Email,Department,Date,Status,Check-In,Check-Out,Worked Hours,Late Minutes'];

        foreach ($records as $record) {
            $date = Carbon::parse($record->attendance_date)->format('d-M-Y');
            $checkIn = $record->check_in_at
                ? Carbon::parse($record->check_in_at)->setTimezone($entryTz)->format('h:i A')
                : '';
            $checkOut = $record->check_out_at
                ? Carbon::parse($record->check_out_at)->setTimezone($entryTz)->format('h:i A')
                : '';
            $workedHours = $this->formatDurationForExport((int) ($record->worked_seconds ?? 0));
            $status = ucfirst($record->status ?? 'absent');
            $lateMinutes = (int) ($record->late_minutes ?? 0);

            $lines[] = implode(',', [
                $this->csvValue($record->user?->name ?? 'Unknown User'),
                $this->csvValue($record->user?->email ?? ''),
                $this->csvValue($this->resolveExportDepartment($record->user)),
                $date,
                $status,
                $checkIn,
                $checkOut,
                $this->csvValue($workedHours),
                $lateMinutes,
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'attendance-report-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Hours Tracked Report CSV Builder ───────────────────────────────────
    private function buildHoursTrackedExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $entries = TimeEntry::with(['project', 'task', 'user'])
            ->whereBetween('start_time', [$startDate, $endDate])
            ->where('is_break', false);

        if ($this->canViewAll($user) && $user->organization_id) {
            $entries->whereIn('user_id', $scopedUserIds->all());
        } else {
            $entries->where('user_id', $user->id);
        }

        $entries = $entries->orderBy('start_time')->get();

        $bom = "\xEF\xBB\xBF";
        $lines = ['Employee Name,Email,Department,Date,Project,Task,Duration,Duration (Hours),Start Time,End Time'];

        foreach ($entries as $entry) {
            $durationSeconds = (int) ($entry->duration ?? 0);
            $durationFormatted = $this->formatDurationForExport($durationSeconds);
            $durationHours = round($durationSeconds / 3600, 2);

            $date = $entry->start_time
                ? Carbon::parse($entry->start_time)->setTimezone($entryTz)->format('d-M-Y')
                : '';
            $startTime = $entry->start_time
                ? Carbon::parse($entry->start_time)->setTimezone($entryTz)->format('h:i A')
                : '';
            $endTime = $entry->end_time
                ? Carbon::parse($entry->end_time)->setTimezone($entryTz)->format('h:i A')
                : '';

            $lines[] = implode(',', [
                $this->csvValue($entry->user?->name ?? 'Unknown User'),
                $this->csvValue($entry->user?->email ?? ''),
                $this->csvValue($this->resolveExportDepartment($entry->user)),
                $date,
                $this->csvValue($entry->project?->name ?? 'No Project'),
                $this->csvValue($entry->task?->title ?? ''),
                $this->csvValue($durationFormatted),
                $durationHours,
                $startTime,
                $endTime,
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'hours-tracked-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Timeline Report CSV Builder ────────────────────────────────────────
    private function buildTimelineExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $sessions = ActivitySession::with(['user'])
            ->where('started_at', '>=', $startDate)
            ->where('started_at', '<=', $endDate);

        if ($this->canViewAll($user) && $user->organization_id) {
            $sessions->whereIn('user_id', $scopedUserIds->all());
        } else {
            $sessions->where('user_id', $user->id);
        }

        $sessions = $sessions->orderBy('started_at')->get();

        $bom = "\xEF\xBB\xBF";
        $lines = ['Employee Name,Email,Department,Date,Activity,Application,URL,Duration,Duration (Hours),Start Time,End Time'];

        foreach ($sessions as $session) {
            $durationSeconds = (int) ($session->duration_seconds ?? 0);
            $durationFormatted = $this->formatDurationForExport($durationSeconds);
            $durationHours = round($durationSeconds / 3600, 2);

            $date = $session->started_at
                ? Carbon::parse($session->started_at)->setTimezone($entryTz)->format('d-M-Y')
                : '';
            $startTime = $session->started_at
                ? Carbon::parse($session->started_at)->setTimezone($entryTz)->format('h:i A')
                : '';
            $endTime = $session->ended_at
                ? Carbon::parse($session->ended_at)->setTimezone($entryTz)->format('h:i A')
                : '';

            $lines[] = implode(',', [
                $this->csvValue($session->user?->name ?? 'Unknown User'),
                $this->csvValue($session->user?->email ?? ''),
                $this->csvValue($this->resolveExportDepartment($session->user)),
                $date,
                $this->csvValue($session->display_name ?? $session->activity_kind ?? ''),
                $this->csvValue($session->app_name ?? $session->software_name ?? ''),
                $this->csvValue($session->url ?? ''),
                $this->csvValue($durationFormatted),
                $durationHours,
                $startTime,
                $endTime,
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'timeline-report-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Projects & Tasks Report CSV Builder ────────────────────────────────
    private function buildProjectsTasksExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $tasks = Task::with(['project', 'assignee', 'timeEntries'])
            ->where(function ($q) use ($startDate, $endDate) {
                $q->whereBetween('created_at', [$startDate, $endDate])
                  ->orWhere(function ($q2) use ($startDate, $endDate) {
                      $q2->whereNull('due_date')
                         ->orWhereBetween('due_date', [$startDate->toDateString(), $endDate->toDateString()]);
                  });
            });

        if ($this->canViewAll($user) && $user->organization_id) {
            $orgId = $user->organization_id;
            $tasks->whereHas('project', function ($q) use ($orgId) {
                $q->where('organization_id', $orgId);
            });
        } else {
            $tasks->where('assignee_id', $user->id);
        }

        $tasks = $tasks->orderBy('created_at')->get();

        $bom = "\xEF\xBB\xBF";
        $lines = ['Project,Task,Assignee,Status,Priority,Created Date,Due Date,Estimated Time,Tracked Time,Tracked (Hours)'];

        foreach ($tasks as $task) {
            $trackedSeconds = $task->timeEntries->sum('duration');
            $trackedFormatted = $this->formatDurationForExport((int) $trackedSeconds);
            $trackedHours = round($trackedSeconds / 3600, 2);
            $estimatedTime = $task->estimated_time ? $this->formatDurationForExport((int) $task->estimated_time) : '';

            $createdDate = Carbon::parse($task->created_at)->format('d-M-Y');
            $dueDate = $task->due_date ? Carbon::parse($task->due_date)->format('d-M-Y') : '';
            $status = ucfirst(str_replace('_', ' ', $task->status ?? 'todo'));
            $priority = ucfirst($task->priority ?? 'medium');

            $lines[] = implode(',', [
                $this->csvValue($task->project?->name ?? 'No Project'),
                $this->csvValue($task->title ?? ''),
                $this->csvValue($task->assignee?->name ?? 'Unassigned'),
                $status,
                $priority,
                $createdDate,
                $dueDate,
                $this->csvValue($estimatedTime),
                $this->csvValue($trackedFormatted),
                $trackedHours,
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'projects-tasks-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Web & App Usage Report CSV Builder ─────────────────────────────────
    private function buildWebAppUsageExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $sessions = ActivitySession::with(['user'])
            ->where('started_at', '>=', $startDate)
            ->where('started_at', '<=', $endDate)
            ->whereNotNull('display_name');

        if ($this->canViewAll($user) && $user->organization_id) {
            $sessions->whereIn('user_id', $scopedUserIds->all());
        } else {
            $sessions->where('user_id', $user->id);
        }

        $sessions = $sessions->orderBy('started_at')->get();

        $bom = "\xEF\xBB\xBF";
        $lines = ['Employee Name,Email,Department,Date,Application,URL,Category,Duration,Duration (Hours),Start Time,End Time'];

        foreach ($sessions as $session) {
            $durationSeconds = (int) ($session->duration_seconds ?? 0);
            $durationFormatted = $this->formatDurationForExport($durationSeconds);
            $durationHours = round($durationSeconds / 3600, 2);

            $date = $session->started_at
                ? Carbon::parse($session->started_at)->setTimezone($entryTz)->format('d-M-Y')
                : '';
            $startTime = $session->started_at
                ? Carbon::parse($session->started_at)->setTimezone($entryTz)->format('h:i A')
                : '';
            $endTime = $session->ended_at
                ? Carbon::parse($session->ended_at)->setTimezone($entryTz)->format('h:i A')
                : '';
            $classification = ucfirst($session->classification ?? 'neutral');

            $lines[] = implode(',', [
                $this->csvValue($session->user?->name ?? 'Unknown User'),
                $this->csvValue($session->user?->email ?? ''),
                $this->csvValue($this->resolveExportDepartment($session->user)),
                $date,
                $this->csvValue($session->display_name ?? $session->app_name ?? ''),
                $this->csvValue($session->url ?? $session->normalized_domain ?? ''),
                $classification,
                $this->csvValue($durationFormatted),
                $durationHours,
                $startTime,
                $endTime,
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'web-app-usage-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Productivity Report CSV Builder ────────────────────────────────────
    private function buildProductivityExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $entries = TimeEntry::with(['user'])
            ->whereBetween('start_time', [$startDate, $endDate]);

        if ($this->canViewAll($user) && $user->organization_id) {
            $entries->whereIn('user_id', $scopedUserIds->all());
        } else {
            $entries->where('user_id', $user->id);
        }

        $entries = $entries->get();
        $entriesByUser = $entries->groupBy('user_id');

        $attendanceRecords = AttendanceRecord::query()
            ->whereBetween('attendance_date', [$startDate->toDateString(), $endDate->toDateString()]);

        if ($this->canViewAll($user) && $user->organization_id) {
            $attendanceRecords->whereIn('user_id', $scopedUserIds->all());
        } else {
            $attendanceRecords->where('user_id', $user->id);
        }

        $attendanceRecords = $attendanceRecords->get()->groupBy('user_id');

        $idleSessions = ActivitySession::where('started_at', '>=', $startDate)
            ->where('started_at', '<=', $endDate)
            ->where('classification', 'idle');

        if ($this->canViewAll($user) && $user->organization_id) {
            $idleSessions->whereIn('user_id', $scopedUserIds->all());
        } else {
            $idleSessions->where('user_id', $user->id);
        }

        $idleByUser = $idleSessions->get()->groupBy('user_id')
            ->map(fn ($s) => $s->sum('duration_seconds'));

        $allUserIds = $entries->pluck('user_id')->unique()->values();
        $users = User::whereIn('id', $allUserIds)->get()->keyBy('id');

        $bom = "\xEF\xBB\xBF";
        $lines = ['Employee Name,Email,Department,Check In,Last Check Out,Attendance,Tracked,Working,Idle,Idle %,Overtime'];

        $calendarDaysCount = max(1, CarbonPeriod::create($startDate->toDateString(), $endDate->toDateString())->count());

        foreach ($allUserIds as $userId) {
            $userObj = $users->get($userId);
            $userEntries = $entriesByUser->get($userId, collect());
            $userAttendance = $attendanceRecords->get($userId, collect());

            $totalSeconds = (int) $userEntries->sum('duration');
            $idleSeconds = (int) ($idleByUser->get($userId, 0));
            $workingSeconds = max(0, $totalSeconds - $idleSeconds);
            $idlePct = $totalSeconds > 0 ? round(($idleSeconds / $totalSeconds) * 100, 1) : 0;
            $overtimeSeconds = max(0, $workingSeconds - ($calendarDaysCount * 8 * 3600));

            $firstCheckIn = $userAttendance->whereNotNull('check_in_at')->min('check_in_at');
            $lastCheckOut = $userAttendance->whereNotNull('check_out_at')->max('check_out_at');
            $presentDays = $userAttendance->whereIn('status', ['present', 'late'])->count();
            $totalDays = $calendarDaysCount;
            $attendanceRate = $totalDays > 0 ? round(($presentDays / $totalDays) * 100, 0) : 0;

            $checkInStr = $firstCheckIn ? Carbon::parse($firstCheckIn)->setTimezone($entryTz)->format('h:i A') : '';
            $checkOutStr = $lastCheckOut ? Carbon::parse($lastCheckOut)->setTimezone($entryTz)->format('h:i A') : '';
            $attendanceStr = $attendanceRate . '% (' . $presentDays . '/' . $totalDays . ')';

            $lines[] = implode(',', [
                $this->csvValue($userObj?->name ?? 'Unknown User'),
                $this->csvValue($userObj?->email ?? ''),
                $this->csvValue($this->resolveExportDepartment($userObj)),
                $checkInStr,
                $checkOutStr,
                $attendanceStr,
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                $this->csvValue($this->formatDurationForExport($workingSeconds)),
                $this->csvValue($this->formatDurationForExport($idleSeconds)),
                $idlePct . '%',
                $this->csvValue($this->formatDurationForExport($overtimeSeconds)),
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'productivity-report-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Productive Time Report CSV Builder ─────────────────────────────────
    private function buildProductiveTimeExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $sessions = ActivitySession::with(['user'])
            ->where('started_at', '>=', $startDate)
            ->where('started_at', '<=', $endDate);

        if ($this->canViewAll($user) && $user->organization_id) {
            $sessions->whereIn('user_id', $scopedUserIds->all());
        } else {
            $sessions->where('user_id', $user->id);
        }

        $sessions = $sessions->get();

        $bom = "\xEF\xBB\xBF";
        $lines = [];

        // Table 1: Top Productive Tools
        $lines[] = '--- Top Productive Tools ---';
        $lines[] = 'Tool,Type,Duration,Duration (Hours),Events,Avg Duration Per Employee';

        $productiveSessions = $sessions->where('classification', 'productive');
        $toolGroups = $productiveSessions->groupBy(fn ($s) => ($s->display_name ?? $s->app_name ?? 'Unknown') . '|' . ($s->tool_type ?? $s->activity_kind ?? ''));

        $employeeCount = max(1, $productiveSessions->pluck('user_id')->unique()->count());

        foreach ($toolGroups as $key => $toolSessions) {
            [$toolName, $toolType] = explode('|', $key, 2);
            $totalSeconds = (int) $toolSessions->sum('duration_seconds');
            $avgPerEmployee = $employeeCount > 0 ? round($totalSeconds / $employeeCount) : 0;

            $lines[] = implode(',', [
                $this->csvValue($toolName),
                $this->csvValue($toolType),
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                round($totalSeconds / 3600, 2),
                $toolSessions->count(),
                $this->csvValue($this->formatDurationForExport($avgPerEmployee)),
            ]);
        }

        // Table 2: Employee Ranking
        $lines[] = '';
        $lines[] = '--- Employee Ranking ---';
        $lines[] = 'Employee Name,Email,Department,Productive Time,Productive (Hours),Worked,Worked (Hours)';

        $userGroups = $sessions->groupBy('user_id');
        foreach ($userGroups as $userId => $userSessions) {
            $firstSession = $userSessions->first();
            $productiveSeconds = (int) $userSessions->where('classification', 'productive')->sum('duration_seconds');
            $totalSeconds = (int) $userSessions->sum('duration_seconds');

            $lines[] = implode(',', [
                $this->csvValue($firstSession->user?->name ?? 'Unknown User'),
                $this->csvValue($firstSession->user?->email ?? ''),
                $this->csvValue($this->resolveExportDepartment($firstSession->user)),
                $this->csvValue($this->formatDurationForExport($productiveSeconds)),
                round($productiveSeconds / 3600, 2),
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                round($totalSeconds / 3600, 2),
            ]);
        }

        // Table 3: Top Unproductive Tools
        $lines[] = '';
        $lines[] = '--- Top Unproductive Tools ---';
        $lines[] = 'Tool,Type,Duration,Duration (Hours),Events';

        $unproductiveSessions = $sessions->where('classification', 'unproductive');
        $unprodToolGroups = $unproductiveSessions->groupBy(fn ($s) => ($s->display_name ?? $s->app_name ?? 'Unknown') . '|' . ($s->tool_type ?? $s->activity_kind ?? ''));

        foreach ($unprodToolGroups as $key => $toolSessions) {
            [$toolName, $toolType] = explode('|', $key, 2);
            $totalSeconds = (int) $toolSessions->sum('duration_seconds');

            $lines[] = implode(',', [
                $this->csvValue($toolName),
                $this->csvValue($toolType),
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                round($totalSeconds / 3600, 2),
                $toolSessions->count(),
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'productive-time-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Unproductive Time Report CSV Builder ───────────────────────────────
    private function buildUnproductiveTimeExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $sessions = ActivitySession::with(['user'])
            ->where('started_at', '>=', $startDate)
            ->where('started_at', '<=', $endDate);

        if ($this->canViewAll($user) && $user->organization_id) {
            $sessions->whereIn('user_id', $scopedUserIds->all());
        } else {
            $sessions->where('user_id', $user->id);
        }

        $sessions = $sessions->get();

        $bom = "\xEF\xBB\xBF";
        $lines = [];

        // Table 1: Top Unproductive Tools
        $lines[] = '--- Top Unproductive Tools ---';
        $lines[] = 'Tool,Type,Duration,Duration (Hours),Events,Avg Duration Per Employee';

        $unproductiveSessions = $sessions->where('classification', 'unproductive');
        $toolGroups = $unproductiveSessions->groupBy(fn ($s) => ($s->display_name ?? $s->app_name ?? 'Unknown') . '|' . ($s->tool_type ?? $s->activity_kind ?? ''));

        $employeeCount = max(1, $unproductiveSessions->pluck('user_id')->unique()->count());

        foreach ($toolGroups as $key => $toolSessions) {
            [$toolName, $toolType] = explode('|', $key, 2);
            $totalSeconds = (int) $toolSessions->sum('duration_seconds');
            $avgPerEmployee = $employeeCount > 0 ? round($totalSeconds / $employeeCount) : 0;

            $lines[] = implode(',', [
                $this->csvValue($toolName),
                $this->csvValue($toolType),
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                round($totalSeconds / 3600, 2),
                $toolSessions->count(),
                $this->csvValue($this->formatDurationForExport($avgPerEmployee)),
            ]);
        }

        // Table 2: Risk Tools (all unproductive tools per employee)
        $lines[] = '';
        $lines[] = '--- Risk Tools By Employee ---';
        $lines[] = 'Employee Name,Email,Department,Tool,Type,Duration,Duration (Hours)';

        $userGroups = $unproductiveSessions->groupBy('user_id');
        foreach ($userGroups as $userId => $userSessions) {
            $firstSession = $userSessions->first();
            $userToolGroups = $userSessions->groupBy(fn ($s) => ($s->display_name ?? $s->app_name ?? 'Unknown') . '|' . ($s->tool_type ?? $s->activity_kind ?? ''));

            foreach ($userToolGroups as $key => $toolSessions) {
                [$toolName, $toolType] = explode('|', $key, 2);
                $totalSeconds = (int) $toolSessions->sum('duration_seconds');

                $lines[] = implode(',', [
                    $this->csvValue($firstSession->user?->name ?? 'Unknown User'),
                    $this->csvValue($firstSession->user?->email ?? ''),
                    $this->csvValue($this->resolveExportDepartment($firstSession->user)),
                    $this->csvValue($toolName),
                    $this->csvValue($toolType),
                    $this->csvValue($this->formatDurationForExport($totalSeconds)),
                    round($totalSeconds / 3600, 2),
                ]);
            }
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'unproductive-time-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── App Usage Report CSV Builder ───────────────────────────────────────
    private function buildAppUsageExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $sessions = ActivitySession::with(['user'])
            ->where('started_at', '>=', $startDate)
            ->where('started_at', '<=', $endDate)
            ->where('activity_kind', 'app');

        if ($this->canViewAll($user) && $user->organization_id) {
            $sessions->whereIn('user_id', $scopedUserIds->all());
        } else {
            $sessions->where('user_id', $user->id);
        }

        $sessions = $sessions->get();

        $bom = "\xEF\xBB\xBF";
        $lines = [];

        // Table 1: Application Usage Aggregated
        $lines[] = '--- Application Usage ---';
        $lines[] = 'Name,Productivity,Duration,Duration (Hours),Events,Employees';

        $appGroups = $sessions->groupBy(fn ($s) => $s->display_name ?? $s->app_name ?? 'Unknown');
        foreach ($appGroups as $appName => $appSessions) {
            $classification = $appSessions->first()->classification ?? 'neutral';
            $totalSeconds = (int) $appSessions->sum('duration_seconds');
            $employeeCount = $appSessions->pluck('user_id')->unique()->count();

            $lines[] = implode(',', [
                $this->csvValue($appName),
                ucfirst($classification),
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                round($totalSeconds / 3600, 2),
                $appSessions->count(),
                $employeeCount,
            ]);
        }

        // Table 2: Raw Activity
        $lines[] = '';
        $lines[] = '--- Raw Activity ---';
        $lines[] = 'When,Employee,Name,Productivity,Duration,Duration (Hours)';

        foreach ($sessions->sortBy('started_at') as $session) {
            $when = $session->started_at
                ? Carbon::parse($session->started_at)->setTimezone($entryTz)->format('d-M-Y h:i A')
                : '';
            $totalSeconds = (int) $session->duration_seconds;

            $lines[] = implode(',', [
                $when,
                $this->csvValue($session->user?->name ?? 'Unknown User'),
                $this->csvValue($session->display_name ?? $session->app_name ?? ''),
                ucfirst($session->classification ?? 'neutral'),
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                round($totalSeconds / 3600, 2),
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'app-usage-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Website Usage Report CSV Builder ───────────────────────────────────
    private function buildWebsiteUsageExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $sessions = ActivitySession::with(['user'])
            ->where('started_at', '>=', $startDate)
            ->where('started_at', '<=', $endDate)
            ->where('activity_kind', 'url');

        if ($this->canViewAll($user) && $user->organization_id) {
            $sessions->whereIn('user_id', $scopedUserIds->all());
        } else {
            $sessions->where('user_id', $user->id);
        }

        $sessions = $sessions->get();

        $bom = "\xEF\xBB\xBF";
        $lines = [];

        // Table 1: Website Usage Aggregated
        $lines[] = '--- Website Usage ---';
        $lines[] = 'Name,Productivity,Duration,Duration (Hours),Events,Employees';

        $siteGroups = $sessions->groupBy(fn ($s) => $s->normalized_domain ?? $s->display_name ?? 'Unknown');
        foreach ($siteGroups as $siteName => $siteSessions) {
            $classification = $siteSessions->first()->classification ?? 'neutral';
            $totalSeconds = (int) $siteSessions->sum('duration_seconds');
            $employeeCount = $siteSessions->pluck('user_id')->unique()->count();

            $lines[] = implode(',', [
                $this->csvValue($siteName),
                ucfirst($classification),
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                round($totalSeconds / 3600, 2),
                $siteSessions->count(),
                $employeeCount,
            ]);
        }

        // Table 2: Employee Website Breakdown
        $lines[] = '';
        $lines[] = '--- Website Usage By Employee ---';
        $lines[] = 'Employee Name,Email,Department,Website,Productivity,Duration,Duration (Hours),Events,Last Used';

        $userSiteGroups = $sessions->groupBy(fn ($s) => $s->user_id . '|' . ($s->normalized_domain ?? $s->display_name ?? 'Unknown'));
        foreach ($userSiteGroups as $key => $groupSessions) {
            [$userId, $siteName] = explode('|', $key, 2);
            $firstSession = $groupSessions->first();
            $classification = $firstSession->classification ?? 'neutral';
            $totalSeconds = (int) $groupSessions->sum('duration_seconds');
            $lastUsed = $groupSessions->max('started_at');
            $lastUsedStr = $lastUsed ? Carbon::parse($lastUsed)->setTimezone($entryTz)->format('d-M-Y h:i A') : '';

            $lines[] = implode(',', [
                $this->csvValue($firstSession->user?->name ?? 'Unknown User'),
                $this->csvValue($firstSession->user?->email ?? ''),
                $this->csvValue($this->resolveExportDepartment($firstSession->user)),
                $this->csvValue($siteName),
                ucfirst($classification),
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                round($totalSeconds / 3600, 2),
                $groupSessions->count(),
                $lastUsedStr,
            ]);
        }

        // Table 3: Raw Activity
        $lines[] = '';
        $lines[] = '--- Raw Activity ---';
        $lines[] = 'When,Employee,Name,Productivity,Duration,Duration (Hours)';

        foreach ($sessions->sortBy('started_at') as $session) {
            $when = $session->started_at
                ? Carbon::parse($session->started_at)->setTimezone($entryTz)->format('d-M-Y h:i A')
                : '';
            $totalSeconds = (int) $session->duration_seconds;

            $lines[] = implode(',', [
                $when,
                $this->csvValue($session->user?->name ?? 'Unknown User'),
                $this->csvValue($session->display_name ?? $session->normalized_domain ?? ''),
                ucfirst($session->classification ?? 'neutral'),
                $this->csvValue($this->formatDurationForExport($totalSeconds)),
                round($totalSeconds / 3600, 2),
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'website-usage-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    // ── Screenshots Report CSV Builder ─────────────────────────────────────
    private function buildScreenshotsExportCsv(User $user, Collection $scopedUserIds, Carbon $startDate, Carbon $endDate, string $entryTz)
    {
        $screenshots = Screenshot::with(['timeEntry.user'])
            ->whereHas('timeEntry', function ($q) use ($startDate, $endDate) {
                $q->whereBetween('start_time', [$startDate, $endDate]);
            });

        if ($this->canViewAll($user) && $user->organization_id) {
            $screenshots->whereHas('timeEntry', function ($q) use ($scopedUserIds) {
                $q->whereIn('user_id', $scopedUserIds->all());
            });
        } else {
            $screenshots->whereHas('timeEntry', function ($q) use ($user) {
                $q->where('user_id', $user->id);
            });
        }

        $screenshots = $screenshots->orderBy('created_at')->get();

        $bom = "\xEF\xBB\xBF";
        $lines = ['Employee Name,Email,Department,Timestamp,Filename,Image URL'];

        foreach ($screenshots as $shot) {
            $employee = $shot->timeEntry?->user;
            $timestamp = $shot->captured_at
                ? Carbon::parse($shot->captured_at)->setTimezone($entryTz)->format('d-M-Y h:i A')
                : ($shot->created_at
                    ? Carbon::parse($shot->created_at)->setTimezone($entryTz)->format('d-M-Y h:i A')
                    : '');

            $lines[] = implode(',', [
                $this->csvValue($employee?->name ?? 'Unknown User'),
                $this->csvValue($employee?->email ?? ''),
                $this->csvValue($this->resolveExportDepartment($employee)),
                $timestamp,
                $this->csvValue($shot->filename ?? 'Captured screenshot'),
                $this->csvValue($shot->path ?? ''),
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'screenshots-'.$startDate->toDateString().'-to-'.$endDate->toDateString().'.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }

    /**
     * Simple attendance export with just: Employee Name, Date Range, Present Days, Absent Days, Total Days
     */
    public function exportAttendanceSimple(Request $request)
    {
        $this->normalizeDepartmentIdsFilter($request);

        $request->validate([
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'user_ids' => 'nullable|array',
            'user_ids.*' => 'integer',
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

        // Get scoped users
        $scopedUsers = $this->resolveScopedExportUsers($request, $user);
        $userIds = $scopedUsers
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        // Calculate working days in range
        $allDatesInRange = collect(CarbonPeriod::create($startDate->copy()->startOfDay(), $endDate->copy()->startOfDay()))
            ->map(fn (Carbon $date) => $date->toDateString())
            ->values();
        $workingDates = $allDatesInRange
            ->reject(fn (string $date) => Carbon::parse($date)->isWeekend())
            ->values();
        $workingDaysCount = $workingDates->count();

        // Get attendance records for all users
        $attendanceRecords = $userIds->isEmpty() || !$user->organization_id
            ? collect()
            : AttendanceRecord::query()
                ->where('organization_id', $user->organization_id)
                ->whereIn('user_id', $userIds->all())
                ->whereBetween('attendance_date', [$startDate->toDateString(), $endDate->toDateString()])
                ->whereNotNull('check_in_at')
                ->get(['user_id', 'attendance_date']);

        $attendanceByUser = $attendanceRecords->groupBy(fn ($record) => (int) $record->user_id);

        // Get approved leaves
        $approvedLeaves = $userIds->isEmpty() || !$user->organization_id
            ? collect()
            : LeaveRequest::query()
                ->where('organization_id', $user->organization_id)
                ->whereIn('user_id', $userIds->all())
                ->where('status', 'approved')
                ->whereDate('start_date', '<=', $endDate->toDateString())
                ->whereDate('end_date', '>=', $startDate->toDateString())
                ->get(['user_id', 'start_date', 'end_date'])
                ->groupBy(fn ($leave) => (int) $leave->user_id);

        // UTF-8 BOM so Excel opens Indian names correctly
        $bom = "\xEF\xBB\xBF";

        $lines = ['Employee Name,Date Range,Present Days,Absent Days,Total Days'];

        foreach ($scopedUsers as $scopedUser) {
            $userId = (int) $scopedUser->id;
            
            // Count present days (has check_in_at)
            $presentDays = $attendanceByUser->get($userId, collect())->count();
            
            // Count leave days
            $leaveDays = 0;
            $userLeaves = $approvedLeaves->get($userId, collect());
            foreach ($userLeaves as $leave) {
                $leaveStart = Carbon::parse($leave->start_date);
                $leaveEnd = Carbon::parse($leave->end_date);
                
                // Clamp to date range
                if ($leaveStart->lessThan($startDate)) {
                    $leaveStart = $startDate->copy();
                }
                if ($leaveEnd->greaterThan($endDate)) {
                    $leaveEnd = $endDate->copy();
                }
                
                // Count working days in leave period
                $period = CarbonPeriod::create($leaveStart->toDateString(), $leaveEnd->toDateString());
                foreach ($period as $date) {
                    if (!$date->isWeekend()) {
                        $leaveDays++;
                    }
                }
            }
            
            // Calculate absent days (working days - present days - leave days)
            $absentDays = max(0, $workingDaysCount - $presentDays - $leaveDays);
            $totalDays = $presentDays + $absentDays;
            
            $dateRange = $startDate->toDateString() . ' to ' . $endDate->toDateString();
            
            $lines[] = implode(',', [
                $this->csvValue($scopedUser->name),
                $this->csvValue($dateRange),
                $presentDays,
                $absentDays,
                $totalDays,
            ]);
        }

        $csv = $bom . implode("\n", $lines);
        $fileName = 'attendance-simple-' . $startDate->toDateString() . '-to-' . $endDate->toDateString() . '.csv';

        return response($csv, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => 'attachment; filename="' . $fileName . '"',
        ]);
    }

    private function resolveScopedExportUsers(Request $request, User $currentUser): Collection
    {
        if (! $this->canViewAll($currentUser) || ! $currentUser->organization_id) {
            return User::query()
                ->whereKey($currentUser->id)
                ->with('reportGroups:id,name')
                ->get(['id', 'name', 'email', 'settings']);
        }

        $organizationUserIds = $this->visibleUserIds($currentUser)
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

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
                ->where('organization_id', $currentUser->organization_id)
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

        $scopedUserIds = $selectedUserIds->isNotEmpty()
            ? $selectedUserIds
            : $organizationUserIds;

        return User::query()
            ->whereIn('id', $scopedUserIds->all())
            ->with('reportGroups:id,name')
            ->get(['id', 'name', 'email', 'settings']);
    }

    private function buildCustomExportCsv(
        User $currentUser,
        Collection $scopedUsers,
        Collection $selectedFields,
        string $exportScope,
        Carbon $startDate,
        Carbon $endDate,
    ): string {
        $exportTimezone = $this->resolveExportTimezone($currentUser);
        $allDatesInRange = collect(CarbonPeriod::create($startDate->copy()->startOfDay(), $endDate->copy()->startOfDay()))
            ->map(fn (Carbon $date) => $date->toDateString())
            ->values();
        $workingDates = $allDatesInRange
            ->reject(fn (string $date) => Carbon::parse($date)->isWeekend())
            ->values();
        $workingDateSet = $workingDates->flip();
        $workingDaysCount = max(1, $workingDates->count());

        $userIds = $scopedUsers
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        $resolvedNow = now();
        $entries = $userIds->isEmpty()
            ? collect()
            : TimeEntry::query()
                ->whereIn('user_id', $userIds->all())
                ->whereBetween('start_time', [$startDate, $endDate])
                ->get(['id', 'user_id', 'start_time', 'end_time', 'duration', 'is_break']);
        $entriesByUser = $this->workedEntries($entries)->groupBy(fn (TimeEntry $entry) => (int) $entry->user_id);

        $idleSummary = $userIds->isEmpty()
            ? ['by_user' => []
            ]
            : $this->summarizeIdleDurationsForUsers($userIds->all(), $startDate, $endDate);
        $idleDurationByUser = collect($idleSummary['by_user'] ?? [])
            ->mapWithKeys(fn ($duration, $userId) => [(int) $userId => (int) $duration])
            ->all();

        $attendanceRecords = $userIds->isEmpty() || ! $currentUser->organization_id
            ? collect()
            : AttendanceRecord::query()
                ->where('organization_id', $currentUser->organization_id)
                ->whereIn('user_id', $userIds->all())
                ->whereBetween('attendance_date', [$startDate->toDateString(), $endDate->toDateString()])
                ->with('punches')
                ->get(['id', 'user_id', 'attendance_date', 'check_in_at', 'check_out_at', 'worked_seconds', 'manual_adjustment_seconds', 'late_minutes']);
        $attendanceByUser = $attendanceRecords->groupBy(fn (AttendanceRecord $record) => (int) $record->user_id);

        $approvedLeavesByUser = $userIds->isEmpty() || ! $currentUser->organization_id
            ? collect()
            : LeaveRequest::query()
                ->where('organization_id', $currentUser->organization_id)
                ->whereIn('user_id', $userIds->all())
                ->where('status', 'approved')
                ->whereDate('start_date', '<=', $endDate->toDateString())
                ->whereDate('end_date', '>=', $startDate->toDateString())
                ->get(['user_id', 'start_date', 'end_date'])
                ->groupBy(fn (LeaveRequest $leave) => (int) $leave->user_id);

        $employeeRows = $scopedUsers->map(function (User $scopedUser) use (
            $entriesByUser,
            $resolvedNow,
            $idleDurationByUser,
            $attendanceByUser,
            $approvedLeavesByUser,
            $startDate,
            $endDate,
            $workingDateSet,
            $workingDaysCount,
        ) {
            $userId = (int) $scopedUser->id;
            $department = $this->resolveExportDepartment($scopedUser);
            $records = $attendanceByUser->get($userId, collect());
            $recordByDate = $records
                ->keyBy(fn (AttendanceRecord $record) => Carbon::parse((string) $record->attendance_date)->toDateString());

            $presentDates = $workingDateSet
                ->keys()
                ->filter(fn (string $date) => (bool) $recordByDate->get($date)?->check_in_at)
                ->values();

            $leaveDates = collect($approvedLeavesByUser->get($userId, collect()))
                ->flatMap(function (LeaveRequest $leave) use ($startDate, $endDate) {
                    $effectiveStart = Carbon::parse((string) $leave->start_date)->startOfDay();
                    $effectiveEnd = Carbon::parse((string) $leave->end_date)->endOfDay();

                    if ($effectiveStart->lessThan($startDate)) {
                        $effectiveStart = $startDate->copy();
                    }
                    if ($effectiveEnd->greaterThan($endDate)) {
                        $effectiveEnd = $endDate->copy();
                    }

                    if ($effectiveStart->greaterThan($effectiveEnd)) {
                        return collect();
                    }

                    return collect(CarbonPeriod::create($effectiveStart->toDateString(), $effectiveEnd->toDateString()))
                        ->filter(fn (Carbon $date) => ! $date->isWeekend())
                        ->map(fn (Carbon $date) => $date->toDateString())
                        ->values();
                })
                ->unique()
                ->values();

            $daysPresent = $presentDates->count();
            $leaveDays = $leaveDates->count();
            $absentDays = max(0, $workingDaysCount - $daysPresent - $leaveDays);
            $lateDays = $records
                ->filter(fn (AttendanceRecord $record) => (int) ($record->late_minutes ?? 0) > 0 && (bool) $record->check_in_at)
                ->count();

            $workedSeconds = (int) $records->sum(
                fn (AttendanceRecord $record) => $this->calculateAttendanceWorkedSeconds($record)
            );
            $trackedSeconds = $this->timeEntryDurationService->sumEffectiveDuration(
                $entriesByUser->get($userId, collect()),
                $resolvedNow
            );
            $idleSeconds = (int) ($idleDurationByUser[$userId] ?? 0);
            $workingSeconds = max(0, $trackedSeconds - $idleSeconds);
            $overtimeSeconds = max(0, $workedSeconds - ($daysPresent * 8 * 3600));

            $firstCheckInTimestamp = $records
                ->filter(fn (AttendanceRecord $record) => (bool) $record->check_in_at)
                ->map(fn (AttendanceRecord $record) => Carbon::parse((string) $record->check_in_at)->getTimestamp())
                ->filter(fn ($timestamp) => is_int($timestamp) && $timestamp > 0)
                ->min();
            $lastCheckOutTimestamp = $records
                ->filter(fn (AttendanceRecord $record) => (bool) $record->check_out_at)
                ->map(fn (AttendanceRecord $record) => Carbon::parse((string) $record->check_out_at)->getTimestamp())
                ->filter(fn ($timestamp) => is_int($timestamp) && $timestamp > 0)
                ->max();

            return [
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
                'employee_name' => (string) $scopedUser->name,
                'employee_email' => (string) $scopedUser->email,
                'employee_region' => AttendanceHoliday::countryForSettings((array) $scopedUser->settings),
                'department' => $department,
                'working_days' => $workingDaysCount,
                'present_days' => $daysPresent,
                'leave_days' => $leaveDays,
                'late_days' => $lateDays,
                'absent_days' => $absentDays,
                'attendance_rate' => round(($daysPresent / max(1, $workingDaysCount)) * 100, 2),
                'tracked_time' => $trackedSeconds,
                'worked_time' => $workedSeconds,
                'idle_time' => $idleSeconds,
                'working_time' => $workingSeconds,
                'overtime_time' => $overtimeSeconds,
                'first_check_in_at' => $firstCheckInTimestamp
                    ? (int) $firstCheckInTimestamp
                    : null,
                'last_check_out_at' => $lastCheckOutTimestamp
                    ? (int) $lastCheckOutTimestamp
                    : null,
            ];
        })->values();

        $rows = $exportScope === 'department'
            ? $employeeRows
                ->groupBy(fn (array $row) => (string) ($row['department'] ?? 'Unassigned'))
                ->map(function (Collection $departmentRows, string $department) use ($workingDaysCount, $startDate, $endDate) {
                    $employeeCount = max(1, $departmentRows->count());
                    $expectedDays = max(1, $workingDaysCount * $employeeCount);

                    return [
                        'start_date' => $startDate->toDateString(),
                        'end_date' => $endDate->toDateString(),
                        'employee_name' => $department,
                        'employee_email' => '',
                        'employee_region' => '',
                        'department' => $department,
                        'working_days' => $workingDaysCount,
                        'present_days' => (int) $departmentRows->sum(fn (array $row) => (int) ($row['present_days'] ?? 0)),
                        'leave_days' => (int) $departmentRows->sum(fn (array $row) => (int) ($row['leave_days'] ?? 0)),
                        'late_days' => (int) $departmentRows->sum(fn (array $row) => (int) ($row['late_days'] ?? 0)),
                        'absent_days' => (int) $departmentRows->sum(fn (array $row) => (int) ($row['absent_days'] ?? 0)),
                        'attendance_rate' => round(((int) $departmentRows->sum(fn (array $row) => (int) ($row['present_days'] ?? 0)) / $expectedDays) * 100, 2),
                        'tracked_time' => (int) $departmentRows->sum(fn (array $row) => (int) ($row['tracked_time'] ?? 0)),
                        'worked_time' => (int) $departmentRows->sum(fn (array $row) => (int) ($row['worked_time'] ?? 0)),
                        'idle_time' => (int) $departmentRows->sum(fn (array $row) => (int) ($row['idle_time'] ?? 0)),
                        'working_time' => (int) $departmentRows->sum(fn (array $row) => (int) ($row['working_time'] ?? 0)),
                        'overtime_time' => (int) $departmentRows->sum(fn (array $row) => (int) ($row['overtime_time'] ?? 0)),
                        'first_check_in_at' => $departmentRows
                            ->pluck('first_check_in_at')
                            ->filter()
                            ->map(fn ($value) => (int) $value)
                            ->filter(fn ($value) => $value > 0)
                            ->min(),
                        'last_check_out_at' => $departmentRows
                            ->pluck('last_check_out_at')
                            ->filter()
                            ->map(fn ($value) => (int) $value)
                            ->filter(fn ($value) => $value > 0)
                            ->max(),
                    ];
                })
                ->values()
            : $employeeRows;

        $headers = [];
        foreach ($selectedFields as $field) {
            $label = self::CUSTOM_EXPORT_FIELD_LABELS[(string) $field] ?? (string) $field;
            if (in_array((string) $field, self::CUSTOM_EXPORT_DURATION_FIELDS, true)) {
                $headers[] = $label.' (Minutes)';
                $headers[] = $label.' (Hours)';
                continue;
            }

            $headers[] = $label;
        }

        // UTF-8 BOM so Excel opens Indian names correctly
        $bom = "\xEF\xBB\xBF";

        $lines = [$bom . implode(',', array_map(fn ($header) => $this->csvValue((string) $header), $headers))];

        foreach ($rows as $row) {
            $cells = [];
            foreach ($selectedFields as $field) {
                $fieldKey = (string) $field;
                $value = $row[$fieldKey] ?? null;

                if (in_array($fieldKey, self::CUSTOM_EXPORT_DURATION_FIELDS, true)) {
                    $seconds = max(0, (int) $value);
                    $cells[] = (string) round($seconds / 60, 2);
                    $cells[] = (string) round($seconds / 3600, 2);
                    continue;
                }

                if (in_array($fieldKey, ['first_check_in_at', 'last_check_out_at'], true)) {
                    $cells[] = $this->csvValue($this->formatClockForExport($value, $exportTimezone));
                    continue;
                }

                if (is_numeric($value) && ! is_string($value)) {
                    $cells[] = (string) $value;
                    continue;
                }

                $cells[] = $this->csvValue((string) ($value ?? ''));
            }

            $lines[] = implode(',', $cells);
        }

        return implode("\n", $lines);
    }

    private function formatClockForExport(mixed $value, string $timezone): string
    {
        if ($value === null || $value === '') {
            return '';
        }

        if (is_numeric($value)) {
            $timestamp = (int) $value;
            if ($timestamp > 0) {
                return Carbon::createFromTimestamp($timestamp, 'UTC')
                    ->setTimezone($timezone)
                    ->format('g:i A');
            }
        }

        try {
            return Carbon::parse((string) $value)
                ->setTimezone($timezone)
                ->format('g:i A');
        } catch (\Throwable) {
            return '';
        }
    }

    private function resolveExportTimezone(User $currentUser): string
    {
        $userTimezone = is_array($currentUser->settings)
            ? (string) ($currentUser->settings['timezone'] ?? '')
            : '';
        if ($userTimezone !== '' && in_array($userTimezone, timezone_identifiers_list(), true)) {
            return $userTimezone;
        }

        $organizationTimezone = is_array($currentUser->organization?->settings)
            ? (string) ($currentUser->organization->settings['timezone'] ?? '')
            : '';
        if ($organizationTimezone !== '' && in_array($organizationTimezone, timezone_identifiers_list(), true)) {
            return $organizationTimezone;
        }

        return config('app.timezone');
    }

    private function resolveExportDepartment(User $user): string
    {
        $departments = collect($user->reportGroups)
            ->pluck('name')
            ->map(fn ($name) => trim((string) $name))
            ->filter()
            ->values();

        return (string) ($departments->first() ?? 'Unassigned');
    }

    public function attendance(Request $request)
    {
        $this->normalizeDepartmentIdsFilter($request);

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

        $usersQuery = $this->visibleUsersQuery($currentUser, $this->restrictMonitoringToEmployees($currentUser))
            ->with(['employeeWorkInfo.department:id,name', 'employeeWorkInfo.reportingManager:id,name']);
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
        // is_break excluded — an open break entry is not "working".
        $activeTimeEntryUserIds = $userIds->isEmpty()
            ? collect()
            : TimeEntry::query()
                ->whereIn('user_id', $userIds)
                ->whereNull('end_time')
                ->where('is_break', false)
                ->distinct()
                ->pluck('user_id')
                ->map(fn ($id) => (int) $id)
                ->unique();

        $onBreakUserIdsForStatus = $userIds->isEmpty()
            ? collect()
            : BreakTime::query()
                ->whereIn('user_id', $userIds)
                ->whereNull('end_at')
                ->whereDate('break_date', now()->toDateString())
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

        // Batch-load attendance records and leave requests once for the whole
        // user set, then partition in memory. Replaces an N+1 pattern (1 query
        // per user for records + 1 query per user for leaves + 1 eager-load
        // for punches) that grew linearly with the user count. For 100 users
        // this collapses from ~300 queries to 3.
        $recordsByUser = collect();
        $leavesByUser = collect();
        if ($userIds->isNotEmpty()) {
            $allRecords = AttendanceRecord::query()
                ->where('organization_id', $currentUser->organization_id)
                ->whereIn('user_id', $userIds)
                ->whereBetween('attendance_date', [$startDate->toDateString(), $endDate->toDateString()])
                ->with(['punches:id,attendance_record_id,punch_in_at,punch_out_at,worked_seconds'])
                ->get(['id', 'user_id', 'attendance_date', 'check_in_at', 'check_out_at', 'worked_seconds', 'manual_adjustment_seconds']);
            $recordsByUser = $allRecords->groupBy(fn (AttendanceRecord $record) => (int) $record->user_id);

            $allLeaves = LeaveRequest::query()
                ->where('organization_id', $currentUser->organization_id)
                ->whereIn('user_id', $userIds)
                ->where('status', 'approved')
                ->whereDate('start_date', '<=', $endDate->toDateString())
                ->whereDate('end_date', '>=', $startDate->toDateString())
                ->get(['user_id', 'start_date', 'end_date']);
            $leavesByUser = $allLeaves->groupBy(fn ($leave) => (int) $leave->user_id);
        }

        $rows = $users->map(function (User $user) use (
            $startDate,
            $endDate,
            $calendarDaysCount,
            $workingDaysCount,
            $workingDates,
            $weekendDates,
            $activeTimeEntryUserIds,
            $onBreakUserIdsForStatus,
            $openAttendanceUserIds,
            $recordsByUser,
            $leavesByUser,
        ) {
            $records = $recordsByUser->get((int) $user->id, collect());

            $recordByDate = $records->keyBy(fn ($record) => Carbon::parse($record->attendance_date)->toDateString());
            $presentDates = $workingDates
                ->filter(fn (string $date) => (bool) $recordByDate->get($date)?->check_in_at)
                ->values();

            $userLeaves = $leavesByUser->get((int) $user->id, collect());
            $approvedLeaveDates = $userLeaves
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

            // Get department and reporting manager from employee work info
            $workInfo = $user->employeeWorkInfo;
            $department = $workInfo?->department?->name ?? null;
            $reportingManager = $workInfo?->reportingManager;

            return [
                'user' => [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'department' => $department,
                    'reporting_manager' => $reportingManager ? [
                        'id' => $reportingManager->id,
                        'name' => $reportingManager->name,
                    ] : null,
                ],
                'days_present' => $daysPresent,
                'calendar_days_in_range' => $calendarDaysCount,
                'working_days_in_range' => $workingDaysCount,
                'leave_days' => $leaveDays,
                'attendance_rate' => $attendanceRate,
                'worked_seconds' => $workedSeconds,
                'worked_hours' => round($workedSeconds / 3600, 2),
                'is_working' => $isWorking,
                // This payload had no on-break key at all, so someone on a break
                // was reported purely as Working.
                'is_on_break' => $onBreakUserIdsForStatus->contains((int) $user->id),
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
        $this->normalizeDepartmentIdsFilter($request);

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

        // Resolved once and reused as $analyticsUsers below, because it also
        // decides who the per-employee panels open on.
        $activeUsersInRange = $request->filled('user_id')
            ? collect()
            : $this->analyticsUsersForRange($usersQuery, $startDate, $endDate);

        /*
         * With no employee chosen, open on somebody who actually has a day to
         * show. Several panels — the activity-kind breakdown among them — are
         * built for the selected employee alone, and defaulting to whoever
         * sorted first alphabetically meant they read "No recorded activity in
         * this range yet" beside organisation totals full of data. Falling back
         * to the alphabetical pick keeps the empty-range case behaving as before.
         */
        $selectedUserId = $request->filled('user_id')
            ? (int) $request->user_id
            : (int) ($activeUsersInRange->first()->id ?? $matchedUsers->first()->id ?? 0);

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

        /*
         * Everyone who actually recorded something in the range — not the first
         * fifty employees by name.
         *
         * The alphabetical cap made every "all employees" figure an average over
         * a slice of the workforce. Measured 14 Aug 2026 on a 92-person
         * organisation: the only person tracking that day sorted 90th, so the
         * dashboard read 0.0% productive and 0h 0m tracked while the timeline for
         * the same day and the same filters listed 19 events. Selecting that
         * person by name skipped the cap and returned 99.7% and 26 minutes, which
         * is precisely why the truncation went unnoticed for so long.
         *
         * Narrowing by activity keeps the per-user loop below bounded without
         * lying about the total: an employee with nothing recorded contributes
         * zero to every figure, so leaving them out moves no number, while the
         * people who DO have data can no longer be the ones dropped.
         */
        $analyticsUsers = $request->filled('user_id')
            ? collect([$selectedUser])
            : $activeUsersInRange;

        try {
            $entries = TimeEntry::where('user_id', $selectedUser->id)
                ->whereBetween('start_time', [$startDate, $endDate])
                ->get(['id', 'start_time', 'end_time', 'duration', 'is_break']);
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

            $activities = $this->activityFeedService->forUsersInRangeForIdle([$selectedUser->id], $startDate, $endDate);
            $selectedUsageSummary = $this->usageProcessingService->buildWebAppUsageUserRangeSummary(
                (int) $selectedUser->id,
                $activities,
                $startDate,
                $endDate,
                includeProcessedLogs: false,
            );
        $selectedMetrics = (array) ($selectedUsageSummary['metrics'] ?? []);
        $rawTotalIdle = (int) ($selectedMetrics['idle_time'] ?? 0);
        $selectedWorkedEntries = $this->workedEntries($entries);
        $selectedBreakSeconds = $this->totalBreakSeconds($entries, $resolvedNow);
        $selectedTrackedDuration = $this->timeEntryDurationService->sumEffectiveDuration($selectedWorkedEntries, $resolvedNow);
        $activityTotalDuration = (int) ($selectedMetrics['total_time'] ?? 0);
        
        // Enhanced idle validation with automatic correction
        $validatedIdle = $this->idleValidationService->validateIdleTime(
            $selectedUser->id,
            $selectedTrackedDuration,
            $rawTotalIdle,
            $activityTotalDuration,
            [
                'source' => 'employeeInsights',
                'start_date' => $startDate->toDateTimeString(),
                'end_date' => $endDate->toDateTimeString(),
                'original_idle' => $rawTotalIdle,
            ]
        );
        $totalIdle = $validatedIdle['idle_duration'];
        
        $selectedTimeBreakdown = $this->timeBreakdownService->build(
            $selectedTrackedDuration,
            $totalIdle,
            $activityTotalDuration,
        );
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
                    ->get(['id', 'user_id', 'start_time', 'end_time', 'duration', 'is_break']);
            $organizationEntriesByUser = $this->workedEntries($organizationEntries)->groupBy(fn ($entry) => (int) $entry->user_id);
            $organizationActivities = $analyticsUserIds->isEmpty()
                ? collect()
                : $this->activityFeedService->forUsersInRangeForIdle($analyticsUserIds, $startDate, $endDate);
            $organizationActivitiesByUser = collect($organizationActivities)->groupBy(fn ($activity) => (int) $activity->user_id);

            $toolTotalsByKey = [];
            $perUserScore = [];
            foreach ($analyticsUsers as $analyticsUser) {
                $userId = (int) $analyticsUser->id;
                $userActivities = $organizationActivitiesByUser->get($userId, collect());
                $userUsageSummary = $this->buildCachedUserRangeSummary(
                    $userId,
                    $userActivities,
                    $startDate,
                    $endDate,
                    includeProcessedLogs: false,
                );
            $userMetrics = (array) ($userUsageSummary['metrics'] ?? []);
            $userTrackedEntries = $organizationEntriesByUser->get($userId, collect());
            $userBreakSeconds = $this->totalBreakSeconds($userTrackedEntries, $resolvedNow);
            $userTrackedDuration = $this->timeEntryDurationService->sumEffectiveDuration(
                $userTrackedEntries,
                $resolvedNow,
            );
            $activityTotalDuration = (int) ($userMetrics['total_time'] ?? 0);
            $userTimeBreakdown = $this->timeBreakdownService->build(
                $userTrackedDuration,
                (int) ($userMetrics['idle_time'] ?? 0),
                $activityTotalDuration,
            );

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
                'break_seconds' => $userBreakSeconds,
                'break_hours' => round($userBreakSeconds / 3600, 2),
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
            ->filter(fn (array $row) => ($row['user']['hierarchy_level'] ?? ($row['user']['role'] === 'admin' ? 10 : ($row['user']['role'] === 'manager' ? 50 : 100))) >= 100)
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

        // is_break excluded — an open break entry is not "working".
        $activeTimeEntryUserIds = $analyticsUserIds->isEmpty()
            ? collect()
            : TimeEntry::whereIn('user_id', $analyticsUserIds)
                ->whereNull('end_time')
                ->where('is_break', false)
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

        // Date-scoped: an orphaned open break_times row from a previous day
        // otherwise reported the user as on-break forever.
        $onBreakUserIds = $analyticsUserIds->isEmpty()
            ? collect()
            : BreakTime::whereIn('user_id', $analyticsUserIds)
                ->whereNull('end_at')
                ->whereDate('break_date', now()->toDateString())
                ->pluck('user_id')
                ->map(fn ($id) => (int) $id)
                ->unique();

        $userScoreById = collect($perUserScore);
        $orgGroups = ReportGroup::with(['users:id,name,email,role,role_id', 'users.customRole:id,hierarchy_level'])
            ->where('organization_id', $currentUser->organization_id)
            ->orderBy('name')
            ->get();

        $teamEfficiency = $orgGroups->map(function (ReportGroup $group) use ($userScoreById, $activeTimeEntryUserIds, $onLeaveUserIds) {
            $memberIds = collect($group->users ?? [])
                ->filter(fn ($u) => ($u->customRole?->hierarchy_level ?? ($u->role === 'admin' ? 10 : ($u->role === 'manager' ? 50 : 100))) >= 100)
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

        $liveMonitoringRows = $analyticsUsers->map(function ($user) use ($recentActivitiesByUser, $activeTimeEntryUserIds) {
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
            ];
        })->values();

        $liveMonitoringRows = $liveMonitoringRows->map(function (array $row) use ($onLeaveUserIds, $onBreakUserIds, $recentActivitiesByUser) {
            $isOnLeave = $onLeaveUserIds->contains((int) ($row['user']['id'] ?? 0));
            $isOnBreak = $onBreakUserIds->contains((int) ($row['user']['id'] ?? 0));
            $row['is_on_leave'] = $isOnLeave;
            $row['is_on_break'] = $isOnBreak;

            if ($isOnLeave) {
                $row['work_status'] = 'on_leave';
            } elseif ($isOnBreak) {
                $row['work_status'] = 'on_break';
            } elseif (! (bool) ($row['is_working'] ?? false)) {
                $row['work_status'] = 'inactive';
            } else {
                $userId = (int) ($row['user']['id'] ?? 0);
                $recentActivities = collect($recentActivitiesByUser->get($userId, collect()));
                $hasRecentNonIdleActivity = $recentActivities->contains(fn ($activity) => ($activity->type ?? '') !== 'idle');

                $row['work_status'] = $hasRecentNonIdleActivity ? 'active' : 'idle';
                $row['is_idle'] = ! $hasRecentNonIdleActivity;
            }

            return $row;
        })->values();

        $employeeLiveRows = $liveMonitoringRows
            ->filter(fn (array $row) => ($row['user']['hierarchy_level'] ?? ($row['user']['role'] === 'admin' ? 10 : ($row['user']['role'] === 'manager' ? 50 : 100))) >= 100)
            ->values();

        $selectedUserLive = $liveMonitoringRows->first(fn ($row) => (int) ($row['user']['id'] ?? 0) === (int) $selectedUser->id);

        return response()->json([
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'matched_users' => $matchedUsers,
            'analytics_users_count' => $analyticsUsers->count(),
            // Surfaced so a capped aggregate can never again read as a complete
            // one. False on any ordinary day; true means figures below cover
            // ANALYTICS_USER_LIMIT of the people who recorded activity, not all.
            'analytics_users_truncated' => $analyticsUsers->count() >= self::ANALYTICS_USER_LIMIT,
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
                'break_seconds' => $selectedBreakSeconds,
                'break_hours' => round($selectedBreakSeconds / 3600, 2),
                'activity_events' => $activities->count(),
            ],
            'activity_breakdown' => $activityBreakdown,
            'selected_user_tools' => $selectedToolBreakdown,
            'organization_tools' => [
                'productive' => $productiveTools->take(25)->values(),
                'unproductive' => $unproductiveTools->take(25)->values(),
                'neutral' => $neutralTools->take(25)->values(),
                'context_dependent' => $contextDependentTools->take(25)->values(),
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
                'break_seconds' => $this->totalBreakSeconds($organizationEntries, $resolvedNow),
                'break_hours' => round($this->totalBreakSeconds($organizationEntries, $resolvedNow) / 3600, 2),
                'productive_share' => (float) round(($orgProductiveDuration / max(1, $orgActivityDuration)) * 100, 2),
                'unproductive_share' => (float) round(($orgUnproductiveDuration / max(1, $orgActivityDuration)) * 100, 2),
                'neutral_share' => (float) round(($orgNeutralDuration / max(1, $orgActivityDuration)) * 100, 2),
                'context_dependent_share' => (float) round(($orgContextDependentDuration / max(1, $orgActivityDuration)) * 100, 2),
            ],
            'employee_rankings' => [
                'most_productive' => $mostProductiveEmployee,
                'most_unproductive' => $mostUnproductiveEmployee,
                'by_productive_duration' => $employeeScores->sortByDesc('productive_duration')->take(100)->values(),
                'by_unproductive_duration' => $employeeScores->sortByDesc('unproductive_duration')->take(100)->values(),
            ],
            'team_rankings' => [
                'by_efficiency' => $teamEfficiencyRanked->take(10)->values(),
                'top_productive' => $teamEfficiencyRanked->first(),
                'least_productive' => $teamEfficiencyRanked->sortBy('efficiency_score')->first(),
            ],
            'live_monitoring' => [
                'selected_user' => $selectedUserLive,
                // True totals — the arrays below are capped at 10 rows for
                // payload weight, so tiles must count from here, not ->length.
                'counts' => [
                    'all' => $employeeLiveRows->count(),
                    'active' => $employeeLiveRows->where('work_status', 'active')->count(),
                    'idle' => $employeeLiveRows->where('work_status', 'idle')->count(),
                    'on_break' => $employeeLiveRows->where('work_status', 'on_break')->count(),
                    'on_leave' => $employeeLiveRows->where('work_status', 'on_leave')->count(),
                    'inactive' => $employeeLiveRows->where('work_status', 'inactive')->count(),
                    'working_now' => $liveMonitoringRows->where('is_working', true)->count(),
                ],
                // Full presence map (user_id => work_status) so the UI can
                // filter any roster by live status without heavy rows.
                'status_by_user' => $employeeLiveRows
                    ->mapWithKeys(fn ($row) => [(string) $row['user']['id'] => $row['work_status']]),
                'working_now' => $liveMonitoringRows->where('is_working', true)->take(10)->values(),
                'all_users' => $liveMonitoringRows->take(10)->values(),
                'employees_active' => $employeeLiveRows->where('work_status', 'active')->take(10)->values(),
                'employees_inactive' => $employeeLiveRows->where('work_status', 'inactive')->take(10)->values(),
                'employees_on_leave' => $employeeLiveRows->where('work_status', 'on_leave')->take(10)->values(),
                'employees_on_break' => $employeeLiveRows->where('work_status', 'on_break')->take(10)->values(),
            ],
                'recent_screenshots' => $recentScreenshots,
            ]);
        } catch (Throwable $exception) {
            Log::error('Employee insights generation failed; returning safe fallback payload.', [
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
                'user_id' => $currentUser->id,
                'selected_user_id' => $selectedUserId,
                'organization_id' => $currentUser->organization_id,
            ]);

            return response()->json([
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
                'matched_users' => $matchedUsers,
                'analytics_users_count' => 0,
                'selected_user' => $selectedUser,
                'stats' => [
                    'entries_count' => 0,
                    'tracked_duration' => 0,
                    'tracked_hours' => 0,
                    'total_duration' => 0,
                    'total_hours' => 0,
                    'working_duration' => 0,
                    'working_hours' => 0,
                    'billable_duration' => 0,
                    'productive_duration' => 0,
                    'unproductive_duration' => 0,
                    'neutral_duration' => 0,
                    'context_dependent_duration' => 0,
                    'activity_total_duration' => 0,
                    'idle_total_duration' => 0,
                    'idle_avg_duration' => 0,
                    'activity_events' => 0,
                ],
                'activity_breakdown' => [],
                'selected_user_tools' => ['productive' => [], 'unproductive' => [], 'neutral' => [], 'context_dependent' => []],
                'organization_tools' => ['productive' => [], 'unproductive' => [], 'neutral' => [], 'context_dependent' => []],
                'organization_summary' => [
                    'tracked_duration' => 0,
                    'total_duration' => 0,
                    'working_duration' => 0,
                    'idle_duration' => 0,
                    'activity_total_duration' => 0,
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
                    'employees_on_break' => [],
                ],
                'recent_screenshots' => [],
            ]);
        }
    }

    private function buildLiteEmployeeInsights(
        User $selectedUser,
        Collection $matchedUsers,
        Collection $entries,
        int $entriesCount,
        Carbon $startDate,
        Carbon $endDate,
        Carbon $resolvedNow,
    ): array {
        $activities = $this->activityFeedService->forUsersInRangeForIdle([$selectedUser->id], $startDate, $endDate);
        // Only non-idle activity duration for pro-rata (idle records inflate the total)
        $nonIdleActivityDuration = (int) collect($activities)->reject(fn ($a) => ($a->type ?? null) === 'idle')->sum('duration');
        $rawIdleDuration = $this->safeCalculateIdleTime($activities, [
            'report' => 'dashboard_selected_employee',
            'user_id' => $selectedUser->id,
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
        ]);
        
        // Enhanced idle validation with automatic correction
        $workedEntries = $this->workedEntries($entries);
        $breakSeconds = $this->totalBreakSeconds($entries, $resolvedNow);
        $trackedDuration = $this->timeEntryDurationService->sumEffectiveDuration($workedEntries, $resolvedNow);
        $validatedIdle = $this->idleValidationService->validateIdleTime(
            $selectedUser->id,
            $trackedDuration,
            $rawIdleDuration,
            $nonIdleActivityDuration,
            [
                'source' => 'buildLiteEmployeeInsights',
                'start_date' => $startDate->toDateTimeString(),
                'end_date' => $endDate->toDateTimeString(),
                'original_idle' => $rawIdleDuration,
            ]
        );
        $idleDuration = $validatedIdle['idle_duration'];
        
        $timeBreakdown = $this->timeBreakdownService->build(
            $trackedDuration,
            $idleDuration,
            $nonIdleActivityDuration
        );
        // is_break excluded — an open break entry is not "working".
        $isWorking = TimeEntry::query()
            ->where('user_id', $selectedUser->id)
            ->whereNull('end_time')
            ->where('is_break', false)
            ->exists();

        // Date-scoped: an orphaned open break_times row from a previous day
        // otherwise reported the user as on-break forever.
        $isOnBreak = BreakTime::query()
            ->where('user_id', $selectedUser->id)
            ->whereNull('end_at')
            ->whereDate('break_date', now()->toDateString())
            ->exists();

        $hasRecentNonIdleActivity = false;
        if ($isWorking) {
            $recentActivity = Activity::query()
                ->where('user_id', $selectedUser->id)
                ->where('recorded_at', '>=', now()->subMinutes(5))
                ->where('type', '!=', 'idle')
                ->exists();
            $hasRecentNonIdleActivity = $recentActivity;
        }

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
            'is_on_leave' => false,
            'is_on_break' => $isOnBreak,
            'is_idle' => $isWorking && ! $hasRecentNonIdleActivity,
            'work_status' => $isOnBreak ? 'on_break' : ($isWorking ? ($hasRecentNonIdleActivity ? 'active' : 'idle') : 'inactive'),
        ];
        $isEmployee = $selectedUser->getHierarchyLevel() >= 100;

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
                'break_seconds' => $breakSeconds,
                'break_hours' => round($breakSeconds / 3600, 2),
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
                'employees_on_break' => $isOnBreak && $isEmployee ? [$selectedUserLive] : [],
            ],
            'recent_screenshots' => [],
        ];
    }

    private function formatDurationForExport(int $seconds): string
    {
        if ($seconds <= 0) {
            return '0m';
        }

        $hours = intdiv($seconds, 3600);
        $minutes = intdiv(($seconds % 3600), 60);
        $remainingSeconds = $seconds % 60;

        if ($remainingSeconds >= 30) {
            $minutes++;
        }

        if ($hours > 0 && $minutes > 0) {
            return "{$hours}h {$minutes}m";
        }
        if ($hours > 0) {
            return "{$hours}h";
        }
        return "{$minutes}m";
    }

    private function csvValue(string $value): string
    {
        $escaped = str_replace('"', '""', $value);
        return '"'.$escaped.'"';
    }

    /**
     * Sum the effective duration of break (is_break = true) TimeEntries in a
     * collection, so callers can surface break time separately from worked time.
     */
    private function totalBreakSeconds(Collection $entries, ?Carbon $now = null): int
    {
        return $this->timeEntryDurationService->sumEffectiveDuration(
            $entries->where('is_break', true)->values(),
            $now ?? now()
        );
    }

    /**
     * Return only the worked (is_break = false) TimeEntries from a collection.
     */
    private function workedEntries(Collection $entries): Collection
    {
        return $entries->where('is_break', false)->values();
    }

    /**
     * Headline figure, movement and a short sparkline for each module on the
     * reports hub.
     *
     * The hub used to be five link tiles with no data on them, so the only way
     * to find out whether a report was worth opening was to open it. Rendering
     * a menu must not cost five full report queries, so this is a handful of
     * aggregates rather than a call into the report builders — and every module
     * is independently wrapped, so one failure degrades that tile to a plain
     * link instead of taking the page down.
     */
    public function hubSummary(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['data' => []]);
        }

        $orgId = (int) $user->organization_id;
        $end = Carbon::now()->endOfDay();
        $start = Carbon::now()->subDays(6)->startOfDay();
        $previousStart = (clone $start)->subDays(7);
        $previousEnd = (clone $start)->subSecond();

        $days = collect(CarbonPeriod::create($start->copy()->startOfDay(), $end->copy()->startOfDay()))
            ->map(fn (Carbon $date) => $date->toDateString())
            ->values();

        $userIds = User::where('organization_id', $orgId)->pluck('id');
        $groupIds = Group::where('organization_id', $orgId)->pluck('id');

        $modules = [];

        $modules['attendance'] = $this->safeSummary(function () use ($orgId, $start, $end, $previousStart, $previousEnd, $days, $userIds) {
            $headcount = max(1, $userIds->count());

            $presentByDay = AttendanceRecord::query()
                ->where('organization_id', $orgId)
                ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
                ->whereNotNull('check_in_at')
                ->selectRaw('attendance_date, COUNT(DISTINCT user_id) as present')
                ->groupBy('attendance_date')
                ->pluck('present', 'attendance_date');

            $workingDays = $days->reject(fn (string $date) => Carbon::parse($date)->isWeekend());
            $presentTotal = $workingDays->sum(fn (string $date) => (int) ($presentByDay[$date] ?? 0));
            $rate = $workingDays->isEmpty() ? 0 : ($presentTotal / ($workingDays->count() * $headcount)) * 100;

            $previousDays = collect(CarbonPeriod::create($previousStart->copy()->startOfDay(), $previousEnd->copy()->startOfDay()))
                ->map(fn (Carbon $date) => $date->toDateString())
                ->reject(fn (string $date) => Carbon::parse($date)->isWeekend());

            $previousByDay = AttendanceRecord::query()
                ->where('organization_id', $orgId)
                ->whereBetween('attendance_date', [$previousStart->toDateString(), $previousEnd->toDateString()])
                ->whereNotNull('check_in_at')
                ->selectRaw('attendance_date, COUNT(DISTINCT user_id) as present')
                ->groupBy('attendance_date')
                ->pluck('present', 'attendance_date');

            $previousPresent = $previousDays->sum(fn (string $date) => (int) ($previousByDay[$date] ?? 0));
            $previousRate = $previousDays->isEmpty() ? 0 : ($previousPresent / ($previousDays->count() * $headcount)) * 100;

            return [
                'value' => round($rate, 1),
                'unit' => '%',
                'delta' => round($rate - $previousRate, 1),
                'delta_direction' => $rate >= $previousRate ? 'up' : 'down',
                'sparkline' => $days->map(fn (string $date) => (int) ($presentByDay[$date] ?? 0))->all(),
                'hint' => $headcount.' people in scope',
            ];
        });

        $modules['hours-tracked'] = $this->safeSummary(function () use ($start, $end, $previousStart, $previousEnd, $days, $userIds) {
            if ($userIds->isEmpty()) {
                return null;
            }

            $byDay = TimeEntry::query()
                ->whereIn('user_id', $userIds)
                ->where('is_break', false)
                ->whereBetween('start_time', [$start, $end])
                ->selectRaw('DATE(start_time) as day, SUM(duration) as total')
                ->groupBy('day')
                ->pluck('total', 'day');

            $total = (int) $byDay->sum();
            $previous = (int) TimeEntry::query()
                ->whereIn('user_id', $userIds)
                ->where('is_break', false)
                ->whereBetween('start_time', [$previousStart, $previousEnd])
                ->sum('duration');

            return [
                'value' => round($total / 3600, 1),
                'unit' => 'h',
                'delta' => round(($total - $previous) / 3600, 1),
                'delta_direction' => $total >= $previous ? 'up' : 'down',
                'sparkline' => $days->map(fn (string $date) => (int) round(((int) ($byDay[$date] ?? 0)) / 3600))->all(),
                'hint' => 'tracked in the last 7 days',
            ];
        });

        $modules['projects-tasks'] = $this->safeSummary(function () use ($user, $groupIds) {
            // Scope through the same service the task pages use. Counting by
            // `group_id` alone missed every task that hangs off a project
            // instead of a department — which, on real data, is all of them.
            $scoped = fn () => $this->groupAccessService->applyTaskVisibilityScope(Task::query(), $user);

            $open = (int) $scoped()->where('status', '!=', 'done')->count();
            $overdue = (int) $scoped()
                ->where('status', '!=', 'done')
                ->whereNotNull('due_date')
                ->whereDate('due_date', '<', Carbon::now()->toDateString())
                ->count();

            return [
                'value' => $open,
                'unit' => '',
                'delta' => $overdue,
                'delta_direction' => $overdue > 0 ? 'down' : 'up',
                'delta_label' => $overdue > 0 ? $overdue.' overdue' : 'none overdue',
                'sparkline' => [],
                'hint' => 'open across '.$groupIds->count().' departments',
            ];
        });

        $modules['timeline'] = $this->safeSummary(function () use ($start, $end, $previousStart, $previousEnd, $userIds) {
            if ($userIds->isEmpty()) {
                return null;
            }

            $count = (int) Activity::whereIn('user_id', $userIds)->whereBetween('recorded_at', [$start, $end])->count();
            $previous = (int) Activity::whereIn('user_id', $userIds)
                ->whereBetween('recorded_at', [$previousStart, $previousEnd])
                ->count();

            return [
                'value' => $count,
                'unit' => '',
                'delta' => $count - $previous,
                'delta_direction' => $count >= $previous ? 'up' : 'down',
                'delta_label' => 'events',
                'sparkline' => [],
                'hint' => 'app, site and idle activity',
            ];
        });

        return response()->json([
            'start_date' => $start->toDateString(),
            'end_date' => $end->toDateString(),
            'data' => array_filter($modules, fn ($module) => $module !== null),
        ]);
    }

    /**
     * Runs one module's aggregate, returning null rather than throwing — a
     * broken tile should fall back to the plain link, not break the hub.
     */
    private function safeSummary(callable $builder): ?array
    {
        try {
            return $builder();
        } catch (Throwable $exception) {
            Log::warning('Reports hub summary module failed.', ['error' => $exception->getMessage()]);

            return null;
        }
    }
}
