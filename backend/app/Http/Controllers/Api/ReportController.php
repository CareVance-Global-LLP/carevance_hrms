<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\AttendanceHoliday;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\Project;
use App\Models\ReportGroup;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
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

class ReportController extends Controller
{
    public function __construct(
        private readonly ActivityProductivityService $activityProductivityService,
        private readonly DashboardSummaryService $dashboardSummaryService,
        private readonly ReportPayloadBuilder $reportPayloadBuilder,
        private readonly TimeBreakdownService $timeBreakdownService,
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly UsageProcessingService $usageProcessingService,
    ) {
    }

    private function canViewAll(?User $user): bool
    {
        return $user && in_array($user->role, ['admin', 'manager'], true);
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
            if (empty($groupIds)) {
                return User::query()->whereRaw('1 = 0');
            }

            if ($employeesOnlyForManager) {
                $query->where('role', 'employee');
            }

            return $query->whereHas('groups', fn (Builder $groupQuery) => $groupQuery->whereIn('groups.id', $groupIds));
        }

        return $query->whereKey($user->id);
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
            max((int) ($record->worked_seconds ?? 0), $closedWorkedSeconds + $openWorkedSeconds)
            + (int) ($record->manual_adjustment_seconds ?? 0)
        );
    }

    private function activityReportColumns(array $extra = []): array
    {
        return array_values(array_unique(array_merge([
            'id',
            'user_id',
            'time_entry_id',
            'session_key',
            'type',
            'name',
            'duration',
            'recorded_at',
            'started_at',
            'last_seen_at',
            'ended_at',
            'normalized_label',
            'normalized_domain',
            'software_name',
            'tool_type',
            'classification',
            'classification_reason',
        ], $extra)));
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
            $orgUserIds = $this->visibleUsersQuery($user, true)->pluck('id');
            $query->whereIn('user_id', $orgUserIds);
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
            $orgUserIds = $this->visibleUsersQuery($user, true)->pluck('id');
            $query->whereIn('user_id', $orgUserIds);
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
            $orgUserIds = $this->visibleUsersQuery($user, true)->pluck('id');
            $query->whereIn('user_id', $orgUserIds);
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
        $activities = Activity::where('user_id', $user->id)
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->get($this->activityReportColumns());
        $idleDuration = $this->usageProcessingService->calculateIdleTime($activities);
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

        $users = $this->visibleUsersQuery($currentUser, true)->get();
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
        if ($this->canViewAll($currentUser)) {
            if ($selectedGroupIds->isNotEmpty()) {
                $usersQuery->whereHas('groups', fn (Builder $query) => $query->whereIn('groups.id', $selectedGroupIds));
            }

            if ($selectedIds->isNotEmpty()) {
                $usersQuery->whereIn('id', $selectedIds);
            }
        }
        $users = $usersQuery->orderBy('name')->get(['id', 'name', 'email', 'role']);
        if ($users->isEmpty()) {
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

        $userIds = $users->pluck('id');

        $entries = TimeEntry::whereIn('user_id', $userIds)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->get(['id', 'user_id', 'start_time', 'end_time', 'duration']);
        $attendanceAdjustments = AttendanceRecord::query()
            ->whereIn('user_id', $userIds)
            ->whereDate('attendance_date', '>=', $startDate->toDateString())
            ->whereDate('attendance_date', '<=', $endDate->toDateString())
            ->get(['id', 'user_id', 'attendance_date', 'manual_adjustment_seconds']);

        $activities = Activity::whereIn('user_id', $userIds)
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->get($this->activityReportColumns());

        $activeUserIds = TimeEntry::whereIn('user_id', $userIds)
            ->whereNull('end_time')
            ->distinct()
            ->pluck('user_id')
            ->map(fn ($id) => (int) $id);

        $entriesByUser = $entries->groupBy('user_id');
        $adjustmentsByUser = $attendanceAdjustments->groupBy('user_id');
        $activitiesByUser = $activities->groupBy('user_id');
        $activitiesByUserAndDay = collect($activities)
            ->groupBy(fn ($activity) => sprintf(
                '%d|%s',
                (int) data_get($activity, 'user_id', 0),
                Carbon::parse((string) data_get($activity, 'recorded_at'))->toDateString()
            ));

        $resolvedNow = now();

        $byUser = $users->map(function ($user) use ($entriesByUser, $adjustmentsByUser, $activitiesByUser, $activeUserIds, $resolvedNow) {
            $userEntries = $entriesByUser->get($user->id, collect());
            $userActivities = $activitiesByUser->get($user->id, collect());
            $userAdjustmentDuration = (int) $adjustmentsByUser->get($user->id, collect())
                ->sum(fn (AttendanceRecord $record) => (int) ($record->manual_adjustment_seconds ?? 0));
            $idleDuration = $this->usageProcessingService->calculateIdleTime($userActivities);
            $timeBreakdown = $this->timeBreakdownService->build(
                $this->timeEntryDurationService->sumEffectiveDuration($userEntries, $resolvedNow) + $userAdjustmentDuration,
                $idleDuration
            );

            return [
                'user' => $user,
                'entries_count' => $userEntries->count(),
                'last_activity_at' => $userActivities->max('recorded_at'),
                'is_working' => $activeUserIds->contains((int) $user->id),
            ] + $timeBreakdown;
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

            $dayUserBuckets[$key]['idle_duration'] = $this->usageProcessingService->calculateIdleTime($dayActivities);
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

        return response()->json([
            'start_date' => $startDate->toDateString(),
            'end_date' => $endDate->toDateString(),
            'summary' => [
                'users_count' => $users->count(),
                'active_users' => $activeUserIds->unique()->count(),
            ] + $summaryBreakdown,
            'users' => $users,
            'by_user' => $byUser,
            'by_day' => $byDay,
        ]);
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
            $activities = Activity::query()
                ->whereIn('time_entry_id', $entries->pluck('id'))
                ->get($this->activityReportColumns());
            $idleDuration = $this->usageProcessingService->calculateIdleTime($activities);
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
            $organizationUserIds = $this->visibleUsersQuery($user, true)
                ->pluck('id');

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
                $groupUserIds = $this->visibleUsersQuery($user, true)
                    ->whereHas('groups', fn (Builder $query) => $query->whereIn('groups.id', $selectedGroupIds))
                    ->pluck('id');

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
        if ($this->canViewAll($currentUser)) {
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
                ->get(['start_date', 'end_date', 'leave_type'])
                ->flatMap(fn (LeaveRequest $leave) => $leave->effectiveDateEntriesInRange($startDate, $endDate, true))
                ->groupBy('date')
                ->map(function ($entries, string $date) {
                    $maxUnits = (float) collect($entries)->max('units');
                    return $maxUnits >= 1
                        ? $date
                        : sprintf('%s (half day)', $date);
                })
                ->values();

            $absentDates = $workingDates
                ->filter(fn (string $date) => !$presentDates->contains($date))
                ->values();

            $workedSeconds = (int) $records->sum(fn (AttendanceRecord $record) => $this->calculateAttendanceWorkedSeconds($record));
            $daysPresent = $presentDates->count();
            $leaveDays = (float) LeaveRequest::query()
                ->where('organization_id', $currentUser->organization_id)
                ->where('user_id', $user->id)
                ->where('status', 'approved')
                ->whereDate('start_date', '<=', $endDate->toDateString())
                ->whereDate('end_date', '>=', $startDate->toDateString())
                ->get(['start_date', 'end_date', 'leave_type'])
                ->sum(fn (LeaveRequest $leave) => $leave->effectiveDateEntriesInRange($startDate, $endDate, true)->sum('units'));
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
            'q' => 'nullable|string|max:255',
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

        $selectedGroupIds = collect($request->input('group_ids', []))
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        $usersQuery = $this->visibleUsersQuery($currentUser, $this->restrictMonitoringToEmployees($currentUser));
        if ($this->canViewAll($currentUser)) {
            if ($selectedGroupIds->isNotEmpty()) {
                $usersQuery->whereHas('groups', fn (Builder $query) => $query->whereIn('groups.id', $selectedGroupIds));
            }

            if ($request->filled('q')) {
                $term = trim((string) $request->q);
                $usersQuery->where(function ($query) use ($term) {
                    $query->where('name', 'like', "%{$term}%")
                        ->orWhere('email', 'like', "%{$term}%");
                });
            }
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

        $selectedUser = User::where('organization_id', $currentUser->organization_id)
            ->when($this->restrictMonitoringToEmployees($currentUser), fn ($query) => $query->where('role', 'employee'))
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

        $activities = Activity::where('user_id', $selectedUser->id)
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->get($this->activityReportColumns());
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
        $selectedToolBreakdown = (array) ($selectedUsageSummary['tools'] ?? ['productive' => [], 'unproductive' => [], 'neutral' => [], 'context_dependent' => []]);

        $recentScreenshots = Screenshot::query()
            ->whereHas('timeEntry', function ($query) use ($selectedUser) {
                $query->where('user_id', $selectedUser->id);
            })
            ->whereBetween('created_at', [$startDate, $endDate])
            ->orderByDesc('created_at')
            ->limit(60)
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
            : Activity::whereIn('user_id', $analyticsUserIds)
                ->whereBetween('recorded_at', [$startDate, $endDate])
                ->get($this->activityReportColumns());
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

        $latestRecentActivities = $analyticsUserIds->isEmpty()
            ? collect()
            : Activity::whereIn('user_id', $analyticsUserIds)
                ->where('recorded_at', '>=', now()->subMinutes(5))
                ->orderByDesc('recorded_at')
                ->get($this->activityReportColumns())
                ->groupBy('user_id')
                ->map(fn ($group) => $group->first());

        $liveMonitoringRows = $analyticsUsers->map(function ($user) use ($latestRecentActivities, $activeTimeEntryUserIds) {
            $latest = $latestRecentActivities->get((int) $user->id);
            $classification = 'neutral';
            $toolLabel = null;
            $toolType = null;
            $activityType = null;

            if ($latest) {
                $toolDescriptor = $this->usageProcessingService->describeTool((string) ($latest->name ?? ''), (string) ($latest->type ?? 'app'));
                $toolLabel = (string) ($latest->normalized_label ?: ($toolDescriptor['label'] ?? ''));
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
                'by_productive_duration' => $employeeScores->sortByDesc('productive_duration')->values(),
                'by_unproductive_duration' => $employeeScores->sortByDesc('unproductive_duration')->values(),
            ],
            'team_rankings' => [
                'by_efficiency' => $teamEfficiencyRanked,
                'top_productive' => $teamEfficiencyRanked->first(),
                'least_productive' => $teamEfficiencyRanked->sortBy('efficiency_score')->first(),
            ],
            'live_monitoring' => [
                'selected_user' => $selectedUserLive,
                'working_now' => $liveMonitoringRows->where('is_working', true)->values(),
                'all_users' => $liveMonitoringRows,
                'employees_active' => $employeeLiveRows->where('work_status', 'active')->values(),
                'employees_inactive' => $employeeLiveRows->where('work_status', 'inactive')->values(),
                'employees_on_leave' => $employeeLiveRows->where('work_status', 'on_leave')->values(),
            ],
            'recent_screenshots' => $recentScreenshots,
        ]);
    }

    private function csvValue(string $value): string
    {
        $escaped = str_replace('"', '""', $value);
        return '"'.$escaped.'"';
    }
}
