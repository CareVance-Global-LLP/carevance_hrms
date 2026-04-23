<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Activity;
use App\Models\AppNotification;
use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Payslip;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Authorization\OrganizationRoleService;
use App\Services\Audit\AuditLogService;
use App\Services\Reports\TimeBreakdownService;
use App\Services\Reports\UsageProcessingService;
use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class UserController extends Controller
{
    private const ALLOWED_MONITORING_INTERVALS = [1, 3, 5, 10, 15, 30];

    public function __construct(
        private readonly AuditLogService $auditLogService,
        private readonly TimeBreakdownService $timeBreakdownService,
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly OrganizationRoleService $organizationRoleService,
        private readonly UsageProcessingService $usageProcessingService,
    )
    {
    }

    public function index(Request $request)
    {
        $request->validate([
            'period' => 'nullable|in:today,week,all',
            'timezone' => 'nullable|string|max:64',
            'start_date' => 'nullable|date',
            'end_date' => 'nullable|date',
            'country' => 'nullable|string|max:64',
        ]);

        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json([]);
        }

        $period = $request->get('period', 'all');
        $timezone = (string) $request->get('timezone', 'UTC');
        if (!in_array($timezone, timezone_identifiers_list(), true)) {
            $timezone = 'UTC';
        }
        $range = $this->resolvePeriodRange(
            $period,
            $timezone,
            $request->get('start_date'),
            $request->get('end_date')
        );

        $users = User::where('organization_id', $currentUser->organization_id)
            ->with('groups:id,name,slug')
            ->when($currentUser->role === 'manager', function ($query) use ($currentUser) {
                $visibleGroupIds = $this->groupIdsForUser($currentUser);

                return $query->where(function ($scopedQuery) use ($currentUser, $visibleGroupIds) {
                    $scopedQuery->where('id', $currentUser->id)
                        ->orWhere(function ($employeeQuery) use ($visibleGroupIds) {
                            $employeeQuery->where('role', 'employee')
                                ->whereHas('groups', fn ($groupQuery) => $groupQuery->whereIn('groups.id', $visibleGroupIds));
                        });
                });
            })
            ->when(!in_array($currentUser->role, ['admin', 'manager'], true), fn ($query) => $query->where('id', $currentUser->id))
            ->orderBy('created_at', 'desc')
            ->get();

        $activeEntries = TimeEntry::with(['project:id,name', 'task:id,title,project_id', 'task.project:id,name'])
            ->whereIn('user_id', $users->pluck('id'))
            ->whereNull('end_time')
            ->get()
            ->keyBy('user_id');

        $totalsQuery = TimeEntry::whereIn('user_id', $users->pluck('id'));
        if ($range) {
            $totalsQuery->whereBetween('start_time', [$range['start'], $range['end']]);
        }

        $totalsByUser = $totalsQuery
            ->selectRaw('user_id, COALESCE(SUM(duration), 0) as total_duration')
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        $payload = $users->map(function (User $user) use ($activeEntries, $totalsByUser, $timezone) {
            $activeEntry = $activeEntries->get($user->id);
            $isWorking = (bool) $activeEntry;
            $currentDuration = 0;
            $storedTotalDuration = (int) ($totalsByUser->get($user->id)->total_duration ?? 0);

            if ($activeEntry) {
                $currentDuration = max(
                    0,
                    now()->getTimestamp() - Carbon::parse($activeEntry->start_time)->getTimestamp()
                );
            }

            return array_merge($user->toArray(), [
                'is_working' => $isWorking,
                'current_duration' => (int) $currentDuration,
                'current_project' => $this->resolveCurrentProjectLabel($activeEntry),
                'total_duration' => $storedTotalDuration,
                'total_elapsed_duration' => $storedTotalDuration + (int) $currentDuration,
                'timezone' => $timezone,
            ]);
        });

        return response()->json($payload);
    }

    public function store(Request $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'email' => 'required|string|email|max:255|unique:users,email',
            'role' => 'nullable|in:admin,manager,employee,client',
            'password' => 'nullable|string|min:8',
            'settings' => 'nullable|array',
            'settings.monitoring_interval_minutes' => 'nullable|integer|in:1,3,5,10,15,30',
            'settings.can_edit_time' => 'nullable|boolean',
            'settings.attendance_monitoring' => 'nullable|boolean',
            'settings.payroll_visibility' => 'nullable|boolean',
            'settings.task_assignment_access' => 'nullable|boolean',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
        ]);

        $selectedRole = $validated['role'] ?? 'employee';
        $this->organizationRoleService->assertCanAssignRole($currentUser, $selectedRole);

        $normalizedSettings = array_key_exists('settings', $validated)
            ? $this->normalizeUserSettings($validated['settings'] ?? [], $selectedRole)
            : null;

        $user = User::create([
            'name' => $validated['name'],
            'email' => $validated['email'],
            'password' => Hash::make($validated['password'] ?? Str::random(12)),
            'role' => $selectedRole,
            'organization_id' => $currentUser->organization_id,
            'settings' => $normalizedSettings,
        ]);

        if (array_key_exists('group_ids', $validated)) {
            $groupIds = Group::where('organization_id', $currentUser->organization_id)
                ->whereIn('id', $validated['group_ids'] ?? [])
                ->pluck('id')
                ->all();

            $this->assertSingleGroupMembershipLimit($selectedRole, $groupIds);
            $user->groups()->sync($groupIds);
            $this->syncPrimaryGroup($user, $groupIds, []);
        }

        $this->auditLogService->log(
            action: 'user.created',
            actor: $currentUser,
            target: $user,
            metadata: [
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
            ],
            request: $request
        );

        return response()->json($user->load('groups:id,name,slug'), 201);
    }

    public function show(Request $request, User $user)
    {
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json($user->load('groups:id,name,slug'));
    }

    public function update(Request $request, User $user)
    {
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'email' => 'sometimes|string|email|max:255|unique:users,email,' . $user->id,
            'role' => 'sometimes|in:admin,manager,employee,client',
            'settings' => 'nullable|array',
            'settings.monitoring_interval_minutes' => 'nullable|integer|in:1,3,5,10,15,30',
            'settings.can_edit_time' => 'nullable|boolean',
            'settings.attendance_monitoring' => 'nullable|boolean',
            'settings.payroll_visibility' => 'nullable|boolean',
            'settings.task_assignment_access' => 'nullable|boolean',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
        ]);

        if (array_key_exists('role', $validated)) {
            $this->organizationRoleService->assertCanAssignRole($request->user(), $validated['role']);
        }

        $originalRole = $user->role;
        $originalAttributes = $user->only(['name', 'email', 'role', 'settings']);

        $nextRole = $validated['role'] ?? $user->role;
        if (array_key_exists('settings', $validated)) {
            $validated['settings'] = $this->normalizeUserSettings(
                array_merge($user->settings ?? [], $validated['settings'] ?? []),
                $nextRole
            );
        } elseif (array_key_exists('role', $validated)) {
            $validated['settings'] = $this->normalizeUserSettings($user->settings ?? [], $nextRole);
        }

        $updatable = collect($validated)
            ->except(['group_ids'])
            ->all();
        $user->update($updatable);

        if (array_key_exists('group_ids', $validated)) {
            $this->organizationRoleService->assertCanAssignRole($request->user(), $user->role, 'group_ids');

            $groupIds = Group::where('organization_id', $user->organization_id)
                ->whereIn('id', $validated['group_ids'] ?? [])
                ->pluck('id')
                ->all();

            $this->assertSingleGroupMembershipLimit($user->role, $groupIds);
            $previousGroupIds = $user->groups()->pluck('groups.id')->map(fn ($id) => (int) $id)->all();
            $user->groups()->sync($groupIds);
            $this->syncPrimaryGroup($user, $groupIds, $previousGroupIds);
        }

        $this->auditLogService->log(
            action: 'user.updated',
            actor: $request->user(),
            target: $user,
            metadata: [
                'changed_fields' => array_keys($validated),
                'before' => $originalAttributes,
                'after' => $user->only(['name', 'email', 'role', 'settings']),
            ],
            request: $request
        );

        if (array_key_exists('role', $validated) && $validated['role'] !== $originalRole) {
            $this->auditLogService->log(
                action: 'user.role_changed',
                actor: $request->user(),
                target: $user,
                metadata: [
                    'from' => $originalRole,
                    'to' => $validated['role'],
                ],
                request: $request
            );
        }

        return response()->json($user->load('groups:id,name,slug'));
    }

    public function destroy(Request $request, User $user)
    {
        if (!$this->canDeleteUsers($request->user()) || !$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }
        if ($request->user()?->id === $user->id) {
            return response()->json(['message' => 'You cannot delete your own account from user management.'], 422);
        }

        $deletedUserSnapshot = $user->only(['name', 'email', 'role']);
        $this->auditLogService->log(
            action: 'user.deleted',
            actor: $request->user(),
            target: $user,
            metadata: $deletedUserSnapshot,
            request: $request
        );

        $user->delete();
        return response()->json(['message' => 'User deleted']);
    }

    public function stats(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = User::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$user) {
            return response()->json(['message' => 'User not found'], 404);
        }
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $query = TimeEntry::where('user_id', $user->id);
        if ($request->start_date) {
            $query->whereDate('start_time', '>=', $request->start_date);
        }
        if ($request->end_date) {
            $query->whereDate('start_time', '<=', $request->end_date);
        }

        $entries = $query->get();
        $resolvedNow = now();
        $activityQuery = Activity::where('user_id', $user->id);
        if ($request->start_date) {
            $activityQuery->whereDate('recorded_at', '>=', $request->start_date);
        }
        if ($request->end_date) {
            $activityQuery->whereDate('recorded_at', '<=', $request->end_date);
        }

        $activities = $activityQuery->get(['id', 'user_id', 'time_entry_id', 'type', 'name', 'duration', 'recorded_at']);
        $manualAdjustmentDuration = (int) AttendanceRecord::query()
            ->where('user_id', $user->id)
            ->when($request->start_date, fn ($query, $startDate) => $query->whereDate('attendance_date', '>=', $startDate))
            ->when($request->end_date, fn ($query, $endDate) => $query->whereDate('attendance_date', '<=', $endDate))
            ->sum('manual_adjustment_seconds');
        $timeBreakdown = $this->timeBreakdownService->build(
            $this->timeEntryDurationService->sumEffectiveDuration($entries, $resolvedNow) + $manualAdjustmentDuration,
            $this->usageProcessingService->calculateIdleTime($activities)
        );

        return response()->json([
            'user_id' => $user->id,
            'entries_count' => $entries->count(),
            'total_hours' => round($timeBreakdown['total_duration'] / 3600, 2),
        ] + $timeBreakdown);
    }

    public function profile360(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $user = User::query()
            ->where('organization_id', $currentUser->organization_id)
            ->with([
                'groups:id,name,slug',
                'employeeWorkInfo.department:id,name',
                'employeeWorkInfo.reportingManager:id,name,email',
            ])
            ->find($id);
        if (!$user) {
            return response()->json(['message' => 'User not found'], 404);
        }
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $startDate = $request->filled('start_date')
            ? Carbon::parse((string) $request->start_date)->startOfDay()
            : now()->startOfMonth();
        $endDate = $request->filled('end_date')
            ? Carbon::parse((string) $request->end_date)->endOfDay()
            : now()->endOfDay();
        if ($startDate->greaterThan($endDate)) {
            [$startDate, $endDate] = [$endDate->copy()->startOfDay(), $startDate->copy()->endOfDay()];
        }

        $entries = TimeEntry::with(['project:id,name,status,deadline', 'task:id,title,project_id'])
            ->where('user_id', $user->id)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->orderByDesc('start_time')
            ->get();
        $resolvedNow = now();
        $entries->transform(function (TimeEntry $entry) use ($resolvedNow) {
            $entry->duration = $this->timeEntryDurationService->effectiveDuration($entry, $resolvedNow);

            return $entry;
        });

        $groupMembershipModels = $user->groups;
        $groupMemberships = $groupMembershipModels
            ->map(fn ($group) => [
                'id' => (int) $group->id,
                'name' => $group->name,
                'slug' => $group->slug,
            ])
            ->values();

        $workInfo = $user->employeeWorkInfo;
        $fallbackReportingManager = User::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where('role', 'manager')
            ->whereHas('groups', fn ($query) => $query->whereIn('groups.id', $groupMembershipModels->pluck('id')))
            ->orderBy('name')
            ->first(['id', 'name', 'email']);
        $resolvedReportingManager = $workInfo?->reportingManager ?: $fallbackReportingManager;
        $assignedProjectIds = Task::query()
            ->where('assignee_id', $user->id)
            ->whereNotNull('project_id')
            ->distinct()
            ->pluck('project_id')
            ->map(fn ($projectId) => (int) $projectId)
            ->all();
        $trackedProjectIds = $entries
            ->map(function (TimeEntry $entry) {
                return (int) ($entry->project_id ?: $entry->task?->project_id ?: 0);
            })
            ->filter(fn (int $projectId) => $projectId > 0)
            ->unique()
            ->values()
            ->all();
        $allRelevantProjectIds = collect(array_merge($assignedProjectIds, $trackedProjectIds))
            ->filter(fn (int $projectId) => $projectId > 0)
            ->unique()
            ->values();
        $projectsById = Project::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('id', $allRelevantProjectIds)
            ->get(['id', 'name', 'status', 'deadline'])
            ->keyBy('id');

        $projectBreakdown = $entries
            ->groupBy(function (TimeEntry $entry) {
                return (int) ($entry->project_id ?: $entry->task?->project_id ?: 0);
            })
            ->filter(fn ($groupedEntries, $projectId) => (int) $projectId > 0)
            ->map(function ($groupedEntries, $projectId) use ($projectsById) {
                $project = $projectsById->get((int) $projectId);
                if (!$project) {
                    return null;
                }

                $trackedDuration = (int) $groupedEntries->sum(fn (TimeEntry $entry) => (int) ($entry->duration ?? 0));
                $billableDuration = (int) $groupedEntries
                    ->filter(fn (TimeEntry $entry) => (bool) $entry->billable)
                    ->sum(fn (TimeEntry $entry) => (int) ($entry->duration ?? 0));

                return [
                    'project' => [
                        'id' => (int) $project->id,
                        'name' => $project->name,
                        'status' => $project->status,
                        'deadline' => optional($project->deadline)?->toDateString(),
                    ],
                    'entries_count' => $groupedEntries->count(),
                    'tracked_duration' => $trackedDuration,
                    'billable_duration' => $billableDuration,
                    'non_billable_duration' => max(0, $trackedDuration - $billableDuration),
                    'last_tracked_at' => optional($groupedEntries->sortByDesc('start_time')->first()?->start_time)?->toISOString(),
                ];
            })
            ->filter()
            ->sortByDesc('tracked_duration')
            ->values();

        $assignedProjects = $allRelevantProjectIds
            ->map(fn (int $projectId) => $projectsById->get($projectId))
            ->filter()
            ->map(fn (Project $project) => [
                'id' => (int) $project->id,
                'name' => $project->name,
                'status' => $project->status,
                'deadline' => optional($project->deadline)?->toDateString(),
            ])
            ->values();

        $attendanceSummaryRecords = AttendanceRecord::query()
            ->where('user_id', $user->id)
            ->whereDate('attendance_date', '>=', $startDate->toDateString())
            ->whereDate('attendance_date', '<=', $endDate->toDateString())
            ->orderByDesc('attendance_date')
            ->get();
        $attendanceRecords = $attendanceSummaryRecords->take(14)->values();

        $leaveRequests = LeaveRequest::query()
            ->with(['reviewer:id,name,email', 'revokeReviewer:id,name,email'])
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(8)
            ->get();
        $approvedLeaveRequestsInRange = LeaveRequest::query()
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->whereDate('end_date', '>=', $startDate->toDateString())
            ->whereDate('start_date', '<=', $endDate->toDateString())
            ->get(['start_date', 'end_date', 'leave_type']);

        $timeEditRequests = AttendanceTimeEditRequest::query()
            ->with('reviewer:id,name,email')
            ->where('user_id', $user->id)
            ->orderByDesc('created_at')
            ->limit(8)
            ->get();
        $approvedTimeEditsSeconds = (int) AttendanceTimeEditRequest::query()
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->whereDate('attendance_date', '>=', $startDate->toDateString())
            ->whereDate('attendance_date', '<=', $endDate->toDateString())
            ->sum('extra_seconds');

        $payslips = Payslip::query()
            ->where('user_id', $user->id)
            ->orderByDesc('period_month')
            ->limit(6)
            ->get();
        $payslipsCount = (int) Payslip::query()
            ->where('user_id', $user->id)
            ->whereBetween('period_month', [$startDate->format('Y-m'), $endDate->format('Y-m')])
            ->count();

        $latestNotification = AppNotification::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where('user_id', $user->id)
            ->latest('created_at')
            ->first(['id', 'type', 'title', 'message', 'created_at', 'is_read']);

        $activities = Activity::query()
            ->where('user_id', $user->id)
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->get(['id', 'user_id', 'time_entry_id', 'type', 'name', 'duration', 'recorded_at']);
        $manualAdjustmentDuration = (int) $attendanceSummaryRecords->sum(fn (AttendanceRecord $record) => (int) ($record->manual_adjustment_seconds ?? 0));
        $timeBreakdown = $this->timeBreakdownService->build(
            $this->timeEntryDurationService->sumEffectiveDuration($entries, $resolvedNow) + $manualAdjustmentDuration,
            $this->usageProcessingService->calculateIdleTime($activities)
        );
        $presentAttendanceDays = (int) $attendanceSummaryRecords
            ->filter(fn (AttendanceRecord $record) => !empty($record->check_in_at) || (int) ($record->worked_seconds ?? 0) > 0 || (int) ($record->manual_adjustment_seconds ?? 0) > 0)
            ->count();
        $absentAttendanceDays = (int) $attendanceSummaryRecords
            ->filter(fn (AttendanceRecord $record) => ($record->status ?? null) === 'absent')
            ->count();
        $lateAttendanceDays = (int) $attendanceSummaryRecords
            ->filter(fn (AttendanceRecord $record) => (int) ($record->late_minutes ?? 0) > 0)
            ->count();
        $approvedLeaveDays = round(
            (float) $approvedLeaveRequestsInRange
                ->sum(fn (LeaveRequest $leaveRequest) => $leaveRequest->effectiveUnitsInRange($startDate, $endDate)),
            2
        );

        $latestAttendance = $attendanceRecords->first();
        $activeEntry = TimeEntry::query()
            ->with(['project:id,name', 'task:id,title,project_id', 'task.project:id,name'])
            ->where('user_id', $user->id)
            ->whereNull('end_time')
            ->latest('start_time')
            ->first();

        return response()->json([
            'user' => $user,
            'range' => [
                'start_date' => $startDate->toDateString(),
                'end_date' => $endDate->toDateString(),
            ],
            'assignments' => [
                'groups' => $groupMemberships,
                'primary_group' => $workInfo?->department
                    ? [
                        'id' => (int) $workInfo->department->id,
                        'name' => $workInfo->department->name,
                    ]
                    : null,
                'reporting_manager' => $resolvedReportingManager
                    ? [
                        'id' => (int) $resolvedReportingManager->id,
                        'name' => $resolvedReportingManager->name,
                        'email' => $resolvedReportingManager->email,
                    ]
                    : null,
                'assigned_projects' => $assignedProjects,
            ],
            'summary' => [
                'entries_count' => $entries->count(),
                'attendance_days' => $attendanceSummaryRecords->count(),
                'present_days' => $presentAttendanceDays,
                'absent_days' => $absentAttendanceDays,
                'late_days' => $lateAttendanceDays,
                'approved_leave_days' => $approvedLeaveDays,
                'approved_time_edit_seconds' => $approvedTimeEditsSeconds,
                'payslips_count' => $payslipsCount,
            ] + $timeBreakdown,
            'status' => [
                'is_working' => (bool) $activeEntry,
                'current_task' => $activeEntry?->task?->title,
                'current_project' => $this->resolveCurrentProjectLabel($activeEntry),
                'current_timer_started_at' => $activeEntry?->start_time,
                'last_seen_at' => $user->last_seen_at,
                'latest_attendance' => $latestAttendance,
                'latest_notification' => $latestNotification,
            ],
            'recent_time_entries' => $entries->take(8)->values(),
            'project_breakdown' => $projectBreakdown,
            'attendance_records' => $attendanceRecords,
            'leave_requests' => $leaveRequests,
            'time_edit_requests' => $timeEditRequests,
            'payslips' => $payslips,
        ]);
    }

    public function groups(Request $request, User $user)
    {
        if (!$this->canAccessUser($request, $user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json([
            'data' => $user->groups()->orderBy('name')->get(['groups.id', 'groups.name', 'groups.slug']),
        ]);
    }

    private function canAccessUser(Request $request, User $user): bool
    {
        $currentUser = $request->user();
        if (!$currentUser || $currentUser->organization_id !== $user->organization_id) {
            return false;
        }

        if ($currentUser->role === 'admin') {
            return true;
        }

        if ($currentUser->id === $user->id) {
            return true;
        }

        if ($currentUser->role === 'manager') {
            return $user->role === 'employee' && $this->usersShareAGroup($currentUser, $user);
        }

        return false;
    }

    private function canManageUsers(User $user): bool
    {
        return in_array($user->role, ['admin', 'manager'], true);
    }

    private function canDeleteUsers(?User $user): bool
    {
        return $user?->role === 'admin';
    }

    /**
     * @param array<string, mixed> $settings
     * @return array<string, mixed>
     */
    private function normalizeUserSettings(array $settings, string $role): array
    {
        $interval = (int) ($settings['monitoring_interval_minutes'] ?? 10);
        if (! in_array($interval, self::ALLOWED_MONITORING_INTERVALS, true)) {
            $interval = 10;
        }

        return array_merge($settings, [
            'monitoring_interval_minutes' => $interval,
            'attendance_monitoring' => array_key_exists('attendance_monitoring', $settings)
                ? filter_var($settings['attendance_monitoring'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false
                : true,
            'can_edit_time' => array_key_exists('can_edit_time', $settings)
                ? filter_var($settings['can_edit_time'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false
                : true,
            'payroll_visibility' => $role === 'employee'
                ? false
                : (
                    array_key_exists('payroll_visibility', $settings)
                        ? filter_var($settings['payroll_visibility'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false
                        : true
                ),
            'task_assignment_access' => array_key_exists('task_assignment_access', $settings)
                ? filter_var($settings['task_assignment_access'], FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE) ?? false
                : true,
        ]);
    }

    private function syncPrimaryGroup(User $user, array $groupIds, array $previousGroupIds = []): void
    {
        $primaryGroupId = $groupIds[0] ?? null;
        $reportingManagerId = $user->role === 'employee'
            ? $this->resolveGroupManagerId($user->organization_id, $primaryGroupId)
            : null;

        EmployeeWorkInfo::query()->updateOrCreate(
            [
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
            ],
            [
                'report_group_id' => $primaryGroupId,
                'reporting_manager_id' => $reportingManagerId,
            ]
        );

        if ($user->role === 'manager') {
            collect(array_merge($previousGroupIds, $groupIds))
                ->filter(fn ($groupId) => (int) $groupId > 0)
                ->unique()
                ->each(fn ($groupId) => $this->syncEmployeesForGroup((int) $user->organization_id, (int) $groupId));
        }
    }

    private function assertSingleGroupMembershipLimit(string $role, array $groupIds): void
    {
        if (in_array($role, ['employee', 'manager'], true) && count($groupIds) > 1) {
            throw ValidationException::withMessages([
                'group_ids' => ['Managers and employees can belong to only one group at a time.'],
            ]);
        }
    }

    private function groupIdsForUser(User $user): array
    {
        return $user->groups()
            ->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function usersShareAGroup(User $leftUser, User $rightUser): bool
    {
        $leftGroupIds = $this->groupIdsForUser($leftUser);

        if (empty($leftGroupIds)) {
            return false;
        }

        return $rightUser->groups()
            ->whereIn('groups.id', $leftGroupIds)
            ->exists();
    }

    private function resolveGroupManagerId(?int $organizationId, ?int $groupId): ?int
    {
        if (!$organizationId || !$groupId) {
            return null;
        }

        return User::query()
            ->where('organization_id', $organizationId)
            ->where('role', 'manager')
            ->whereHas('groups', fn ($query) => $query->where('groups.id', $groupId))
            ->orderBy('name')
            ->value('id');
    }

    private function syncEmployeesForGroup(int $organizationId, int $groupId): void
    {
        $managerId = $this->resolveGroupManagerId($organizationId, $groupId);
        $employeeIds = User::query()
            ->where('organization_id', $organizationId)
            ->where('role', 'employee')
            ->whereHas('groups', fn ($query) => $query->where('groups.id', $groupId))
            ->pluck('id');

        foreach ($employeeIds as $employeeId) {
            EmployeeWorkInfo::query()->updateOrCreate(
                [
                    'organization_id' => $organizationId,
                    'user_id' => (int) $employeeId,
                ],
                [
                    'report_group_id' => $groupId,
                    'reporting_manager_id' => $managerId,
                ]
            );
        }
    }

    private function resolveCurrentProjectLabel(?TimeEntry $activeEntry): ?string
    {
        if (! $activeEntry) {
            return null;
        }

        return $activeEntry->project?->name
            ?: $activeEntry->task?->project?->name
            ?: $activeEntry->task?->title;
    }

    private function resolvePeriodRange(string $period, string $timezone, ?string $startDate = null, ?string $endDate = null): ?array
    {
        if ($startDate || $endDate) {
            $start = $startDate
                ? Carbon::parse($startDate, $timezone)->startOfDay()
                : now($timezone)->startOfDay();
            $end = $endDate
                ? Carbon::parse($endDate, $timezone)->endOfDay()
                : now($timezone)->endOfDay();

            if ($start->greaterThan($end)) {
                [$start, $end] = [$end->copy()->startOfDay(), $start->copy()->endOfDay()];
            }

            return [
                'start' => $start->clone()->utc(),
                'end' => $end->clone()->utc(),
            ];
        }

        $now = now($timezone);

        return match ($period) {
            'today' => [
                'start' => $now->copy()->startOfDay()->utc(),
                'end' => $now->copy()->endOfDay()->utc(),
            ],
            'week' => [
                'start' => $now->copy()->startOfWeek()->utc(),
                'end' => $now->copy()->endOfWeek()->utc(),
            ],
            default => null,
        };
    }
}
