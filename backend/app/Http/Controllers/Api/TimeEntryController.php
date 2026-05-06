<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\Activity;
use App\Models\LeaveRequest;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\ExternalTimestamp;
use App\Services\Authorization\GroupAccessService;
use App\Services\TimeEntries\IdleAutoStopMailService;
use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

class TimeEntryController extends Controller
{
    private const DEFAULT_LATE_AFTER = '10:30:00';

    public function __construct(
        private readonly GroupAccessService $groupAccessService,
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly IdleAutoStopMailService $idleAutoStopMailService,
    ) {
    }

    public function index(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['data' => []]);
        }

        $targetUser = $user;
        $requestedUserId = (int) $request->get('user_id', 0);

        if ($requestedUserId > 0 && $requestedUserId !== (int) $user->id) {
            if (! $this->canViewOrganizationEntries($user)) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            $targetUser = User::query()
                ->where('organization_id', $user->organization_id)
                ->find($requestedUserId);

            if (! $targetUser) {
                return response()->json(['message' => 'User not found'], 404);
            }
        }

        $timeEntries = TimeEntry::with(['task.group', 'project'])
            ->where('user_id', $targetUser->id)
            ->when($request->timer_slot, fn (Builder $q, string $slot) => $q->where('timer_slot', $slot))
            ->when($request->project_id, fn (Builder $q, string $projectId) => $q->where('project_id', $projectId))
            ->when($request->task_id, fn (Builder $q, string $taskId) => $q->where('task_id', $taskId))
            ->when($request->start_date, fn (Builder $q, string $start) => $q->whereDate('start_time', '>=', $start))
            ->when($request->end_date, fn (Builder $q, string $end) => $q->whereDate('start_time', '<=', $end))
            ->orderBy('start_time', 'desc')
            ->paginate((int) $request->get('per_page', 15));

        $resolvedNow = now();
        $timeEntries->setCollection(
            $timeEntries->getCollection()->map(function (TimeEntry $entry) use ($resolvedNow) {
                $entry->duration = $this->timeEntryDurationService->effectiveDuration($entry, $resolvedNow);

                return $entry;
            })
        );

        return response()->json($timeEntries);
    }

    public function store(Request $request)
    {
        $request->validate([
            'description' => 'nullable|string',
            'project_id' => 'nullable|exists:projects,id',
            'task_id' => 'nullable|exists:tasks,id',
            'start_time' => 'required|date',
            'end_time' => 'nullable|date|after:start_time',
            'duration' => 'nullable|integer|min:0',
            'billable' => 'nullable|boolean',
            'timer_slot' => 'nullable|in:primary,secondary',
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $assignment = $this->resolveProjectAndTask($request, $user);
        if ($assignment instanceof JsonResponse) {
            return $assignment;
        }

        [$projectId, $taskId] = $assignment;

        $timeEntry = TimeEntry::create([
            'description' => $request->description,
            'project_id' => $projectId,
            'task_id' => $taskId,
            'start_time' => ExternalTimestamp::parseToAppTimezone($request->start_time),
            'end_time' => $request->end_time ? ExternalTimestamp::parseToAppTimezone($request->end_time) : null,
            'duration' => $request->duration ?? 0,
            'billable' => $request->billable ?? true,
            'user_id' => $user->id,
            'timer_slot' => $request->get('timer_slot', 'primary'),
        ]);

        $this->markTaskInProgress($taskId);
        $timeEntry->load(['project', 'task.group']);
        return response()->json($timeEntry, 201);
    }

    public function show(TimeEntry $timeEntry)
    {
        if (!$this->canViewTimeEntry($timeEntry)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $timeEntry->load(['task.group', 'project']);
        $timeEntry->duration = $this->timeEntryDurationService->effectiveDuration($timeEntry);

        return response()->json($timeEntry);
    }

    public function update(Request $request, TimeEntry $timeEntry)
    {
        if (!$this->canModifyTimeEntry($timeEntry)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $request->validate([
            'description' => 'nullable|string',
            'project_id' => 'nullable|exists:projects,id',
            'task_id' => 'nullable|exists:tasks,id',
            'start_time' => 'nullable|date',
            'end_time' => 'nullable|date|after:start_time',
            'duration' => 'nullable|integer|min:0',
            'billable' => 'nullable|boolean',
            'timer_slot' => 'nullable|in:primary,secondary',
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $assignment = $this->resolveProjectAndTask($request, $user, $timeEntry);
        if ($assignment instanceof JsonResponse) {
            return $assignment;
        }

        [$projectId, $taskId] = $assignment;

        $payload = $request->only([
            'description',
            'start_time',
            'end_time',
            'duration',
            'billable',
            'timer_slot',
        ]);

        if ($request->exists('project_id') || $request->exists('task_id')) {
            $payload['project_id'] = $projectId;
            $payload['task_id'] = $taskId;
        }

        if (array_key_exists('start_time', $payload) && $payload['start_time']) {
            $payload['start_time'] = ExternalTimestamp::parseToAppTimezone($payload['start_time']);
        }

        if (array_key_exists('end_time', $payload)) {
            $payload['end_time'] = $payload['end_time']
                ? ExternalTimestamp::parseToAppTimezone($payload['end_time'])
                : null;
        }

        $timeEntry->update($payload);
        $this->markTaskInProgress($taskId);

        return response()->json($timeEntry->fresh()->load(['project', 'task.group']));
    }

    public function destroy(TimeEntry $timeEntry)
    {
        if (!$this->canModifyTimeEntry($timeEntry)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $timeEntry->delete();

        return response()->json(['message' => 'Time entry deleted']);
    }

    public function start(Request $request)
    {
        $request->validate([
            'description' => 'nullable|string',
            'project_id' => 'nullable|exists:projects,id',
            'task_id' => 'nullable|exists:tasks,id',
            'timer_slot' => 'nullable|in:primary,secondary',
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $assignment = $this->resolveProjectAndTask($request, $user);
        if ($assignment instanceof JsonResponse) {
            return $assignment;
        }

        [$projectId, $taskId] = $assignment;
        $slot = $request->get('timer_slot', 'primary');
        $todayStart = now()->startOfDay();

        $this->closeStalePrimaryRunningEntries((int) $user->id, $todayStart, $slot);

        if ($slot === 'primary') {
            $attendanceGuard = $this->ensureAttendanceCheckedIn($user);
            if ($attendanceGuard) {
                return $attendanceGuard;
            }
        }

        $startedAt = now();
        $runningEntries = $this->runningEntriesQuery((int) $user->id, $slot)
            ->orderByDesc('start_time')
            ->get();
        $this->closeRunningEntries($runningEntries, $startedAt);

        $timeEntry = TimeEntry::create([
            'description' => $request->description,
            'project_id' => $projectId,
            'task_id' => $taskId,
            'start_time' => $startedAt,
            'user_id' => $user->id,
            'timer_slot' => $slot,
        ]);

        $this->markTaskInProgress($taskId);
        $timeEntry->load(['project', 'task.group']);
        return response()->json($timeEntry, 201);
    }

    public function stop(Request $request)
    {
        $request->validate([
            'timer_slot' => 'nullable|in:primary,secondary',
            'auto_stopped_for_idle' => 'nullable|boolean',
            'idle_seconds' => 'nullable|integer|min:1|max:86400',
            'last_activity_at' => 'nullable|date',
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        $slot = $request->get('timer_slot', 'primary');
        $this->closeStalePrimaryRunningEntries((int) $user->id, now()->startOfDay(), $slot);

        $runningEntries = $this->runningEntriesQuery((int) $user->id, $slot)
            ->orderByDesc('start_time')
            ->get();

        if ($runningEntries->isEmpty()) {
            return response()->json(['message' => 'No running timer found'], 404);
        }

        $stoppedAt = now();
        $idleContext = null;
        $shouldSendIdleEmail = false;

        if ($request->boolean('auto_stopped_for_idle')) {
            $idleContext = $this->buildIdleAutoStopContext(
                userId: (int) $user->id,
                runningEntries: $runningEntries,
                stoppedAt: $stoppedAt,
                reportedIdleSeconds: (int) $request->input('idle_seconds', 0),
                reportedLastActivityAt: $request->input('last_activity_at')
                    ? ExternalTimestamp::parseToAppTimezone($request->input('last_activity_at'))
                    : null,
            );

            if (! $idleContext['eligible']) {
                Log::warning('Idle auto-stop rejected by backend validation.', $idleContext['log']);

                return response()->json([
                    'message' => 'Idle auto-stop validation failed because recent activity was detected.',
                    'error_code' => 'IDLE_VALIDATION_FAILED',
                    'retry_after_seconds' => (int) ($idleContext['retry_after_seconds'] ?? 1),
                ], 409);
            }

            $shouldSendIdleEmail = true;
            Log::info('Idle auto-stop validated.', $idleContext['log']);
        }

        $this->closeRunningEntries($runningEntries, $stoppedAt);
        $timeEntry = $runningEntries->first();

        if ($slot === 'primary') {
            $this->ensureAttendanceCheckedOutForBreak($user->id, $stoppedAt);
        }

        if ($shouldSendIdleEmail && $idleContext) {
            $emailSent = $this->idleAutoStopMailService->send(
                user: $user,
                idleSeconds: (int) $idleContext['resolved_idle_seconds'],
                stoppedAt: $stoppedAt,
                dedupeKey: (string) $idleContext['dedupe_key'],
            );

            Log::info('Idle auto-stop completed.', [
                ...$idleContext['log'],
                'email_sent' => $emailSent,
            ]);
        }

        return response()->json($timeEntry->load(['project', 'task.group']));
    }

    public function active(Request $request)
    {
        $request->validate([
            'timer_slot' => 'nullable|in:primary,secondary',
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(null);
        }
        $slot = $request->get('timer_slot', 'primary');
        $this->closeStalePrimaryRunningEntries((int) $user->id, now()->startOfDay(), $slot);

        $timeEntry = $this->runningEntriesQuery((int) $user->id, $slot)
            ->with(['task.group', 'project'])
            ->orderByDesc('start_time')
            ->first();

        if ($timeEntry) {
            $timeEntry->duration = $this->timeEntryDurationService->effectiveDuration($timeEntry);
        }

        return response()->json($timeEntry);
    }

    public function today(Request $request)
    {
        $user = $request->user();
        if (!$user) {
            return response()->json([
                'time_entries' => [],
                'total_duration' => 0,
            ]);
        }

        $today = now()->startOfDay();
        $this->closeStalePrimaryRunningEntries((int) $user->id, $today, 'primary');

        $timeEntries = TimeEntry::with(['task.group', 'project'])
            ->where('user_id', $user->id)
            ->where('start_time', '>=', $today)
            ->orderBy('start_time', 'desc')
            ->get();

        $resolvedNow = now();
        $timeEntries->transform(function (TimeEntry $entry) use ($resolvedNow) {
            $entry->duration = $this->timeEntryDurationService->effectiveDuration($entry, $resolvedNow);

            return $entry;
        });

        return response()->json([
            'time_entries' => $timeEntries,
            'total_duration' => $this->timeEntryDurationService->sumEffectiveDuration($timeEntries, $resolvedNow),
        ]);
    }

    private function canViewTimeEntry(TimeEntry $timeEntry): bool
    {
        $user = request()->user();
        if (! $user) {
            return false;
        }

        if ((int) $timeEntry->user_id === (int) $user->id) {
            return true;
        }

        if (! $this->canViewOrganizationEntries($user)) {
            return false;
        }

        return User::query()
            ->where('organization_id', $user->organization_id)
            ->whereKey($timeEntry->user_id)
            ->exists();
    }

    private function canModifyTimeEntry(TimeEntry $timeEntry): bool
    {
        $user = request()->user();

        return $user && (int) $timeEntry->user_id === (int) $user->id;
    }

    private function canViewOrganizationEntries(User $user): bool
    {
        return (bool) $user->organization_id && in_array($user->role, ['admin', 'manager'], true);
    }

    private function ensureAttendanceCheckedIn($user)
    {
        $today = now()->toDateString();
        if ($this->hasApprovedFullDayLeaveOnDate((int) $user->organization_id, (int) $user->id, $today)) {
            return response()->json(['message' => 'You are on approved leave today. Timer cannot start.'], 422);
        }

        $record = AttendanceRecord::firstOrNew([
            'user_id' => $user->id,
            'attendance_date' => $today,
        ]);
        $record->organization_id = $user->organization_id;
        $record->status = 'present';

        $now = now();
        if (!$record->check_in_at) {
            $lateThreshold = Carbon::parse($today.' '.$this->lateAfterTimeForUser($user));
            $record->check_in_at = $now;
            $record->late_minutes = $this->toLateMinutes($lateThreshold->diffInMinutes($now, false));
        }
        $record->save();

        $openPunch = AttendancePunch::where('attendance_record_id', $record->id)
            ->whereNull('punch_out_at')
            ->first();

        if (!$openPunch) {
            AttendancePunch::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'attendance_record_id' => $record->id,
                'punch_in_at' => $now,
            ]);
        }

        return null;
    }

    private function ensureAttendanceCheckedOutForBreak(int $userId, ?Carbon $checkOutAt = null): void
    {
        $today = now()->toDateString();
        $record = AttendanceRecord::where('user_id', $userId)
            ->whereDate('attendance_date', $today)
            ->first();
        if (!$record) {
            return;
        }

        $openPunch = AttendancePunch::where('attendance_record_id', $record->id)
            ->whereNull('punch_out_at')
            ->orderByDesc('punch_in_at')
            ->first();
        if (!$openPunch) {
            return;
        }

        $checkOutAt = $checkOutAt ?: now();
        $sessionWorkedSeconds = max(0, Carbon::parse($openPunch->punch_in_at)->diffInSeconds($checkOutAt));
        $openPunch->update([
            'punch_out_at' => $checkOutAt,
            'worked_seconds' => (int) $sessionWorkedSeconds,
        ]);

        $closedWorked = (int) AttendancePunch::where('attendance_record_id', $record->id)
            ->whereNotNull('punch_out_at')
            ->sum('worked_seconds');

        $record->update([
            'check_out_at' => $checkOutAt,
            'worked_seconds' => $closedWorked,
            'status' => 'present',
        ]);
    }

    private function hasApprovedFullDayLeaveOnDate(int $organizationId, int $userId, string $date): bool
    {
        return LeaveRequest::where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('status', 'approved')
            ->where('leave_type', '!=', 'half_day')
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->exists();
    }

    private function toLateMinutes(int|float $rawMinutes): int
    {
        return (int) max(0, floor($rawMinutes));
    }

    private function lateAfterTimeForUser(User $user): string
    {
        $settings = is_array($user->organization?->settings) ? $user->organization->settings : [];
        $attendanceSettings = is_array($settings['attendance'] ?? null) ? $settings['attendance'] : [];
        $configured = $attendanceSettings['late_after_time'] ?? null;

        if (!is_string($configured) || trim($configured) === '') {
            return Carbon::parse(env('ATTENDANCE_LATE_AFTER', self::DEFAULT_LATE_AFTER))->format('H:i:s');
        }

        try {
            return Carbon::parse($configured)->format('H:i:s');
        } catch (\Throwable) {
            return Carbon::parse(env('ATTENDANCE_LATE_AFTER', self::DEFAULT_LATE_AFTER))->format('H:i:s');
        }
    }

    private function runningEntriesQuery(int $userId, string $slot): Builder
    {
        return TimeEntry::query()
            ->where('user_id', $userId)
            ->whereNull('end_time')
            ->where(function (Builder $query) use ($slot) {
                if ($slot === 'primary') {
                    $query->where('timer_slot', 'primary')
                        ->orWhereNull('timer_slot');

                    return;
                }

                $query->where('timer_slot', $slot);
            });
    }

    private function closeRunningEntries(Collection $runningEntries, Carbon $endedAt): void
    {
        foreach ($runningEntries as $running) {
            $running->update([
                'end_time' => $endedAt,
                'duration' => $this->timeEntryDurationService->effectiveDuration($running, $endedAt),
            ]);
        }
    }

    private function closeStalePrimaryRunningEntries(int $userId, Carbon $boundaryAt, string $slot): void
    {
        if ($slot !== 'primary') {
            return;
        }

        $staleEntries = $this->runningEntriesQuery($userId, 'primary')
            ->where('start_time', '<', $boundaryAt)
            ->orderByDesc('start_time')
            ->get();

        if ($staleEntries->isEmpty()) {
            return;
        }

        $this->closeRunningEntries($staleEntries, $boundaryAt);
    }

    private function resolveProjectAndTask(Request $request, User $user, ?TimeEntry $existingEntry = null): array|JsonResponse
    {
        $projectId = $request->exists('project_id')
            ? ($request->project_id ? (int) $request->project_id : null)
            : ($existingEntry?->project_id ? (int) $existingEntry->project_id : null);

        $taskId = $request->exists('task_id')
            ? ($request->task_id ? (int) $request->task_id : null)
            : ($existingEntry?->task_id ? (int) $existingEntry->task_id : null);

        if ($projectId) {
            $project = Project::query()
                ->where('organization_id', $user->organization_id)
                ->find($projectId);

            if (!$project) {
                return response()->json(['message' => 'Invalid project for your organization.'], 422);
            }
        }

        if ($taskId) {
            $taskQuery = Task::query()
                ->with(['group', 'project']);
            $this->groupAccessService->applyTaskVisibilityScope($taskQuery, $user);
            $taskQuery->whereKey($taskId);

            $task = $taskQuery->first();

            if (!$task) {
                return response()->json([
                    'message' => $projectId
                        ? 'Selected task is not available in the chosen project.'
                        : 'Selected task is not available for your assigned group.',
                ], 422);
            }

            if ($projectId && $task->project_id && (int) $task->project_id !== $projectId) {
                return response()->json([
                    'message' => 'Selected task is not available in the chosen project.',
                ], 422);
            }

            if ($request->exists('task_id') && !$request->exists('project_id')) {
                $projectId = $task->project_id ? (int) $task->project_id : null;
            } elseif (!$projectId) {
                $projectId = $task->project_id ? (int) $task->project_id : null;
            }
        }

        return [$projectId, $taskId];
    }

    private function buildIdleAutoStopContext(
        int $userId,
        Collection $runningEntries,
        Carbon $stoppedAt,
        int $reportedIdleSeconds,
        ?Carbon $reportedLastActivityAt = null,
    ): array {
        $idleAutoStopThresholdSeconds = $this->idleAutoStopThresholdSeconds();
        $entry = $runningEntries->sortByDesc('start_time')->first();
        $sessionStartAt = $entry?->start_time ? Carbon::parse($entry->start_time) : $stoppedAt;

        $activityQuery = Activity::query()
            ->where('user_id', $userId)
            ->whereBetween('recorded_at', [$sessionStartAt, $stoppedAt])
            ->where(function (Builder $query) use ($entry) {
                if (! $entry?->id) {
                    $query->whereNull('time_entry_id');

                    return;
                }

                $query->where('time_entry_id', $entry->id)
                    ->orWhereNull('time_entry_id');
            });

        $lastNonIdleActivity = (clone $activityQuery)
            ->where('type', '!=', 'idle')
            ->orderByDesc('recorded_at')
            ->first();

        $lastIdleActivity = (clone $activityQuery)
            ->where('type', 'idle')
            ->orderByDesc('recorded_at')
            ->first();

        $lastActiveAt = $reportedLastActivityAt && $reportedLastActivityAt->betweenIncluded($sessionStartAt, $stoppedAt)
            ? $reportedLastActivityAt
            : ($lastNonIdleActivity?->recorded_at
                ? Carbon::parse($lastNonIdleActivity->recorded_at)
                : $sessionStartAt);

        $idleStartAt = $lastActiveAt;

        $continuousIdleSeconds = max(0, $idleStartAt->diffInSeconds($stoppedAt));
        $trackedIdleSeconds = max($reportedIdleSeconds, (int) ($lastIdleActivity?->duration ?? 0));
        $resolvedIdleSeconds = min($continuousIdleSeconds, $trackedIdleSeconds);
        $retryAfterSeconds = max(1, $idleAutoStopThresholdSeconds - $resolvedIdleSeconds);
        $totalIdleSeconds = (clone $activityQuery)
            ->where('type', 'idle')
            ->sum('duration');

        $log = [
            'session_id' => $entry?->id,
            'employee_id' => $userId,
            'timer_start_time' => $sessionStartAt->toIso8601String(),
            'last_activity_time' => $lastNonIdleActivity?->recorded_at
                ? Carbon::parse($lastNonIdleActivity->recorded_at)->toIso8601String()
                : null,
            'reported_last_activity_time' => $reportedLastActivityAt?->toIso8601String(),
            'idle_start_time' => $idleStartAt->toIso8601String(),
            'idle_end_time' => $stoppedAt->toIso8601String(),
            'continuous_idle_duration' => $continuousIdleSeconds,
            'reported_idle_duration' => $reportedIdleSeconds,
            'tracked_idle_duration' => (int) ($lastIdleActivity?->duration ?? 0),
            'total_idle_duration' => (int) $totalIdleSeconds,
            'resolved_idle_duration' => $resolvedIdleSeconds,
            'idle_auto_stop_threshold_seconds' => $idleAutoStopThresholdSeconds,
            'retry_after_seconds' => $retryAfterSeconds,
            'timer_stop_reason' => 'continuous_idle_threshold',
            'email_sent' => false,
        ];

        return [
            'eligible' => $trackedIdleSeconds >= $idleAutoStopThresholdSeconds
                && $continuousIdleSeconds >= $idleAutoStopThresholdSeconds
                && $resolvedIdleSeconds >= $idleAutoStopThresholdSeconds,
            'resolved_idle_seconds' => $resolvedIdleSeconds,
            'retry_after_seconds' => $retryAfterSeconds,
            'dedupe_key' => sprintf(
                'idle-auto-stop:%d:%d:%s',
                $userId,
                (int) ($entry?->id ?? 0),
                $stoppedAt->copy()->startOfMinute()->toIso8601String()
            ),
            'log' => $log,
        ];
    }

    private function idleAutoStopThresholdSeconds(): int
    {
        return max(60, (int) config('time_tracking.idle_auto_stop_threshold_seconds', 300));
    }

    private function markTaskInProgress(?int $taskId): void
    {
        if (! $taskId) {
            return;
        }

        $task = Task::query()->find($taskId);
        if (! $task) {
            return;
        }

        if ($task->status !== 'in_progress') {
            $task->update(['status' => 'in_progress']);
        }
    }
}
