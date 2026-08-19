<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\Activity;
use App\Models\GeofenceLog;
use App\Models\GeofenceZone;
use App\Models\LeaveRequest;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Support\ExternalTimestamp;
use App\Services\Authorization\GroupAccessService;
use App\Services\Billing\PlanService;
use App\Services\TimeEntries\IdleAutoStopMailService;
use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class TimeEntryController extends Controller
{
    private const DEFAULT_LATE_AFTER = '10:30:00';

    public function __construct(
        private readonly GroupAccessService $groupAccessService,
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly IdleAutoStopMailService $idleAutoStopMailService,
        private readonly \App\Services\Reports\WorkTimeSummaryService $workTimeSummaryService,
        private readonly \App\Services\Reports\WorkedTimeService $workedTimeService,
        private readonly \App\Services\Monitoring\TrackerPolicyResolver $trackerPolicy,
        private readonly \App\Services\Reports\DashboardSummaryService $dashboardSummaryService,
    ) {
    }

    /**
     * Drop this user's cached dashboard payload.
     *
     * GET /dashboard is cached for 30s, and that cache carries the shift
     * countdown (`worked_time`) and the running timer's duration. Nothing ever
     * invalidated it, so for up to half a minute after starting or stopping a
     * timer the dashboard answered with the state from before the change — a
     * client that refreshed on stop was told the timer was still running and
     * that no time had been worked. Starting and stopping are the only two
     * moments that make the snapshot wrong immediately.
     */
    private function forgetDashboardCache(User $user): void
    {
        $this->dashboardSummaryService->clearCache((int) $user->id);
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

        $this->syncTaskStatusForTimer($taskId, $user);
        $this->forgetDashboardCache($user);
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
        $this->syncTaskStatusForTimer($taskId, $user);

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

    /**
     * Resolve the timer start time.
     *
     * Defaults to the server clock. A client-supplied `started_at` is honoured
     * whenever it is not in the future — a skewed device clock must not create
     * a timer that has not begun yet.
     *
     * Deliberately no staleness cap: silently re-stamping a long-buffered
     * offline entry as "now" would file the work into the wrong pay period,
     * which is a worse failure than recording an old timestamp honestly.
     */
    private function resolveStartedAt(Request $request): \Illuminate\Support\Carbon
    {
        $now = now();
        $raw = $request->input('started_at');

        if (!$raw) {
            return $now;
        }

        try {
            // Clients send an absolute instant (typically ISO-8601 with a Z
            // suffix). Convert it into the app timezone before storage so it
            // lands on the correct calendar day for attendance and payroll.
            $startedAt = \Illuminate\Support\Carbon::parse($raw)
                ->setTimezone(config('app.timezone', 'UTC'));
        } catch (\Throwable) {
            return $now;
        }

        return $startedAt->greaterThan($now) ? $now : $startedAt;
    }

    public function start(Request $request)
    {
        $request->validate([
            'description' => 'nullable|string',
            'project_id' => 'nullable|exists:projects,id',
            'task_id' => 'nullable|exists:tasks,id',
            'timer_slot' => 'nullable|in:primary,secondary',
            'latitude' => 'nullable|numeric|between:-90,90',
            'longitude' => 'nullable|numeric|between:-180,180',
            'accuracy' => 'nullable|numeric|min:0',
            // Offline sync: the client posts the original click-time so a
            // session buffered offline is recorded when it actually started
            // rather than when it happened to reach the server. Mirrors the
            // 'ended_at' handling in stop().
            'started_at' => 'nullable|date',
            // Offline-sync idempotency keys (see IdempotentSync middleware).
            'local_id' => 'nullable|string|max:191',
            'device_id' => 'nullable|string|max:191',
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $geofenceGuard = $this->checkGeofenceZone($user, $request);
        if ($geofenceGuard) {
            return $geofenceGuard;
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

        $this->logGeofenceAction($user, 'timer_start', $request);

        $startedAt = $this->resolveStartedAt($request);
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
            // Persist the idempotency keys so a replayed sync is recognised
            // by the (local_id, device_id) unique index instead of inserting
            // a duplicate timer.
            'local_id' => $request->input('local_id'),
            'device_id' => $request->input('device_id'),
        ]);

        $this->syncTaskStatusForTimer($taskId, $user);
        $this->forgetDashboardCache($user);
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
            'latitude' => 'nullable|numeric|between:-90,90',
            'longitude' => 'nullable|numeric|between:-180,180',
            'accuracy' => 'nullable|numeric|min:0',
            // Optional client-supplied stop timestamp. The offline sync engine
            // posts this so a session that was buffered offline can be closed
            // with the original click-time instead of "right now" (which can
            // be much later for long offline windows).
            'ended_at' => 'nullable|date',
        ]);

        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }
        $slot = $request->get('timer_slot', 'primary');

        $this->logGeofenceAction($user, 'timer_stop', $request);

        /*
         * The server's idle safety net stands down when the client is already
         * reporting the idle stop itself.
         *
         * Both use the same threshold, and the net runs at the top of every
         * stop() call — so a tracker that reported an idle auto-stop for a
         * timer with no non-idle activity rows had its entry closed by the net
         * first, then got "No running timer found" 404 for a stop that was
         * entirely legitimate. Worse, the idle email is only sent from this
         * action: the net closes the timer silently, so the employee was never
         * told their timer had stopped.
         *
         * The net exists for when NOBODY reports — a crashed or offline
         * tracker. When the client is reporting, it is redundant and it
         * swallows the notification.
         */
        $this->closeStalePrimaryRunningEntries(
            (int) $user->id,
            now()->startOfDay(),
            $slot,
            skipIdleSweep: $request->boolean('auto_stopped_for_idle'),
        );

        // The sweep above can close entries on its own, and every early return
        // below it skips the success path. Clear here so no exit from stop()
        // can leave the cached dashboard reporting a timer that is already
        // stopped — a 404 is precisely when the client most needs the truth.
        $this->forgetDashboardCache($user);

        $runningEntries = $this->runningEntriesQuery((int) $user->id, $slot)
            ->orderByDesc('start_time')
            ->get();

        if ($runningEntries->isEmpty()) {
            return response()->json(['message' => 'No running timer found'], 404);
        }

        // For idle auto-stop we always trust the server's clock (the request is
        // server-driven). For a manual stop the client may supply an ended_at
        // (the offline sync engine does this to keep the recorded duration
        // honest). The resolver rejects client timestamps that would lead to
        // a negative duration or are obviously bogus.
        $stoppedAt = $request->boolean('auto_stopped_for_idle')
            ? now()
            : $this->resolveStopTimestamp($request, $runningEntries);
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

        $attendanceCheckoutAt = $stoppedAt;

        if ($request->boolean('auto_stopped_for_idle') && $idleContext) {
            // End the entry AT the last keypress so the idle tail is not billed,
            // matching the in-request server fallback and the cron. This path
            // used to close at now(), so the same idle period was billed or
            // excluded depending purely on which of the three paths fired.
            $attendanceCheckoutAt = $this->closeIdleStoppedEntries(
                $runningEntries,
                $stoppedAt,
                $idleContext['last_active_at'] instanceof Carbon
                    ? $idleContext['last_active_at']->copy()
                    : $stoppedAt->copy(),
                (int) $idleContext['resolved_idle_seconds'],
            );
        } else {
            $this->closeRunningEntries($runningEntries, $stoppedAt);

            foreach ($runningEntries as $running) {
                $running->timestamps = false;
                $running->stop_reason = $request->filled('ended_at')
                    ? TimeEntry::STOP_MANUAL_OFFLINE_SYNC
                    : TimeEntry::STOP_MANUAL;
                $running->save();
            }
        }

        $timeEntry = $runningEntries->first();

        if ($slot === 'primary') {
            $this->ensureAttendanceCheckedOutForBreak($user->id, $attendanceCheckoutAt);
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

        $this->forgetDashboardCache($user);

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

        $workedEntries = $timeEntries->where('is_break', false)->values();
        $breakSeconds = $this->timeEntryDurationService->sumEffectiveDuration(
            $timeEntries->where('is_break', true)->values(),
            $resolvedNow
        );

        $workTimeSummary = $this->workTimeSummaryService->forUserRange(
            $user->id,
            now()->startOfDay(),
            now()->endOfDay(),
            $resolvedNow
        );

        return response()->json([
            'time_entries' => $timeEntries,
            'total_duration' => $this->timeEntryDurationService->sumEffectiveDuration($workedEntries, $resolvedNow),
            'total_break_seconds' => $breakSeconds,
            'break_hours' => round($breakSeconds / 3600, 2),
            'track_time' => $workTimeSummary['track_time'],
            'work_time' => $workTimeSummary['work_time'],
            'idle_time' => $workTimeSummary['idle_time'],
            'break_time' => $workTimeSummary['break_time'],
            // The canonical block. Clients render these verbatim and must not
            // recombine them with anything else — the shift countdown ran
            // backwards precisely because the client was reconciling five
            // different worked-time sources with max().
            'worked_time' => $this->workedTimeService->forUserToday($user, $resolvedNow),
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
        return (bool) $user->organization_id && $user->getHierarchyLevel() < 100;
    }

    private function ensureAttendanceCheckedIn($user)
    {
        $today = now()->toDateString();
        if ($this->hasApprovedFullDayLeaveOnDate((int) $user->organization_id, (int) $user->id, $today)) {
            return response()->json([
                'message' => 'You are on approved leave today. Timer cannot start.',
                'error_code' => 'ON_APPROVED_LEAVE',
            ], 422);
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
            return Carbon::parse(config('attendance.late_after', self::DEFAULT_LATE_AFTER))->format('H:i:s');
        }

        try {
            return Carbon::parse($configured)->format('H:i:s');
        } catch (\Throwable) {
            return Carbon::parse(config('attendance.late_after', self::DEFAULT_LATE_AFTER))->format('H:i:s');
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

    /**
     * Pick the effective stop timestamp for a manual stop request. The client
     * may include an `ended_at` (the offline sync engine does this) so that a
     * session that ran while the device was offline is closed with the
     * original click-time instead of "now". We always fall back to the server
     * clock if the client value would lead to a negative duration or sits in
     * the future.
     */
    private function resolveStopTimestamp(Request $request, Collection $runningEntries): Carbon
    {
        $now = now();
        $rawEndedAt = $request->input('ended_at');
        if (! $rawEndedAt) {
            return $now;
        }

        try {
            $candidate = ExternalTimestamp::parseToAppTimezone($rawEndedAt);
        } catch (\Throwable $e) {
            Log::warning('Stop: rejected ended_at — could not parse.', [
                'ended_at' => $rawEndedAt,
                'error' => $e->getMessage(),
            ]);
            return $now;
        }

        // 5-minute future skew tolerance covers clock drift between client
        // and server. Anything further out is rejected.
        if ($candidate->greaterThan($now->copy()->addMinutes(5))) {
            Log::warning('Stop: rejected ended_at — in the future.', [
                'ended_at' => $rawEndedAt,
                'server_now' => $now->toIso8601String(),
            ]);
            return $now;
        }

        // The client value must not be earlier than any running entry's
        // start_time, otherwise the entry would end up with a negative
        // duration. Fall back to now() and log.
        foreach ($runningEntries as $entry) {
            $entryStart = $entry->start_time instanceof Carbon
                ? $entry->start_time
                : Carbon::parse($entry->start_time);
            if ($candidate->lessThan($entryStart)) {
                Log::warning('Stop: rejected ended_at — earlier than entry start_time.', [
                    'ended_at' => $rawEndedAt,
                    'entry_id' => $entry->id,
                    'entry_start_time' => $entryStart->toIso8601String(),
                ]);
                return $now;
            }
        }

        return $candidate;
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

    /**
     * Close entries that the client auto-stopped for idle.
     *
     * The one duration rule, shared with closeIdleRunningEntry() and
     * timers:close-idle: end_time is rewound to the last real activity so the
     * idle tail falls outside the billed span, and the tail itself is recorded
     * separately in trailing_idle_seconds.
     *
     * @return Carbon the instant attendance should be punched out at
     */
    private function closeIdleStoppedEntries(
        Collection $runningEntries,
        Carbon $stoppedAt,
        Carbon $lastActiveAt,
        int $resolvedIdleSeconds,
    ): Carbon {
        $earliestEnd = $stoppedAt->copy();

        foreach ($runningEntries as $running) {
            $startTime = Carbon::parse($running->start_time);
            $anchor = $lastActiveAt->copy();

            // When no activity was ever recorded for the session the anchor
            // collapses to start_time, which would close the entry at zero
            // seconds and destroy the whole session. The client told us how long
            // it had been idle, so back-compute the anchor from that instead.
            if ($anchor->lte($startTime) && $resolvedIdleSeconds > 0) {
                $anchor = $stoppedAt->copy()->subSeconds($resolvedIdleSeconds);
            }

            if ($anchor->lt($startTime)) {
                $anchor = $startTime->copy();
            }
            if ($anchor->gt($stoppedAt)) {
                $anchor = $stoppedAt->copy();
            }

            $running->timestamps = false;
            $running->update([
                'end_time' => $anchor,
                'duration' => (int) max(0, $startTime->diffInSeconds($anchor)),
                'auto_stopped_for_idle' => true,
                'stop_reason' => TimeEntry::STOP_IDLE_CLIENT,
                'last_activity_at' => $anchor,
                'trailing_idle_seconds' => (int) max(0, $anchor->diffInSeconds($stoppedAt)),
                'duration_reconciled_at' => $stoppedAt,
            ]);

            if ($anchor->lt($earliestEnd)) {
                $earliestEnd = $anchor->copy();
            }
        }

        return $earliestEnd;
    }

    /**
     * @param  bool  $skipIdleSweep  Set when the caller is itself reporting an
     *                               idle auto-stop. The day-boundary close
     *                               below still runs; only the idle safety net
     *                               stands down, because the client has
     *                               already detected what it would detect.
     */
    private function closeStalePrimaryRunningEntries(
        int $userId,
        Carbon $boundaryAt,
        string $slot,
        bool $skipIdleSweep = false
    ): void {
        if ($slot !== 'primary') {
            return;
        }

        $staleEntries = $this->runningEntriesQuery($userId, 'primary')
            ->where('start_time', '<', $boundaryAt)
            ->orderByDesc('start_time')
            ->get();

        if ($staleEntries->isNotEmpty()) {
            $this->closeRunningEntries($staleEntries, $boundaryAt);
        }

        if (! $skipIdleSweep) {
            $this->closeIdleRunningEntry($userId);
        }
    }

    /**
     * Real-time idle check: if the running timer has had no non-idle activity
     * for longer than the idle threshold, auto-stop it as a server-side
     * fallback for desktop-driven idle detection.
     *
     * Idle is measured from the user's LAST real activity, not from the timer's
     * start_time. A user who works for 2 minutes and then goes idle must not be
     * stopped 5 minutes after starting the timer; they must be stopped 5 minutes
     * after they last worked. The worked portion (start_time -> last activity)
     * is preserved as the recorded duration, and the idle tail is not counted.
     */
    private function closeIdleRunningEntry(int $userId): void
    {
        // Same resolved policy the client is given, so the in-request
        // fallback holds a user to exactly the threshold their tracker uses.
        $idleThreshold = $this->idleAutoStopThresholdSeconds(User::find($userId));
        $now = now();
        $cutoff = $now->copy()->subSeconds($idleThreshold);

        // Only consider timers that have existed at least as long as the idle
        // threshold; a freshly started timer can never be idle-eligible yet.
        $entry = $this->runningEntriesQuery($userId, 'primary')
            ->where('start_time', '<', $cutoff)
            ->orderByDesc('start_time')
            ->first();

        if (! $entry) {
            return;
        }

        $startTime = Carbon::parse($entry->start_time);

        // Anchor on the most recent NON-IDLE activity for this timer. This is
        // "when the user last actually worked". If the tracker has not recorded
        // any work activity (e.g. it never produced an activity row), we fall
        // back to the timer start_time so the safety net still eventually fires.
        $lastActivity = \App\Models\Activity::query()
            ->where('user_id', $userId)
            ->where('time_entry_id', $entry->id)
            ->where('type', '!=', 'idle')
            ->orderByDesc('recorded_at')
            ->first(['recorded_at']);

        // The tracker has TWO activity ledgers. When the Electron
        // foreground-window bridge is available the renderer writes an
        // activity_sessions row and returns before ever creating an `activities`
        // row, so anchoring on `activities` alone found nothing, fell back to
        // start_time, and closed the entry with duration = 0 — losing real work.
        // It is build-dependent, which is why it came and went.
        $lastSessionAt = DB::table('activity_sessions')
            ->where('user_id', $userId)
            ->where('time_entry_id', $entry->id)
            ->max(DB::raw('COALESCE(ended_at, started_at)'));

        $activityAt = $lastActivity ? Carbon::parse($lastActivity->recorded_at) : null;
        $sessionAt = $lastSessionAt ? Carbon::parse($lastSessionAt) : null;

        // Whichever ledger saw the user most recently wins.
        $lastActivityAt = $startTime;
        $anchoredOn = 'start_time';

        if ($activityAt && $activityAt->gt($lastActivityAt)) {
            $lastActivityAt = $activityAt;
            $anchoredOn = 'last_activity';
        }

        if ($sessionAt && $sessionAt->gt($lastActivityAt)) {
            $lastActivityAt = $sessionAt;
            $anchoredOn = 'activity_session';
        }

        // Idle is time since the last real activity. Not idle long enough yet.
        if ($lastActivityAt->gt($cutoff)) {
            return;
        }

        // Auto-stop. End the entry AT the last activity time so the idle tail is
        // excluded from worked time, while the worked portion is preserved.
        $endTime = $lastActivityAt->copy();
        if ($endTime->lt($startTime)) {
            $endTime = $startTime->copy();
        }
        $duration = (int) max(0, $startTime->diffInSeconds($endTime));
        $trailingIdleSeconds = (int) max(0, $endTime->diffInSeconds($now));

        $entry->timestamps = false;
        $entry->update([
            'end_time' => $endTime,
            'duration' => $duration,
            'auto_stopped_for_idle' => true,
            'stop_reason' => TimeEntry::STOP_IDLE_SERVER,
            'last_activity_at' => $lastActivityAt,
            'trailing_idle_seconds' => $trailingIdleSeconds,
            // Marks `duration` as deliberately computed so effectiveDuration()
            // does not raise it back to the raw start->end span.
            'duration_reconciled_at' => $now,
        ]);

        $this->closeOpenAttendancePunches($userId, $endTime);

        Log::info('Running timer auto-stopped by real-time idle check', [
            'time_entry_id' => $entry->id,
            'user_id' => $userId,
            'start_time' => $startTime->toIso8601String(),
            'last_activity_at' => $lastActivityAt->toIso8601String(),
            'end_time' => $endTime->toIso8601String(),
            'worked_seconds' => $duration,
            'trailing_idle_seconds' => $trailingIdleSeconds,
            'idle_threshold_seconds' => $idleThreshold,
            'anchored_on' => $anchoredOn,
            'auto_stopped_for_idle' => true,
            'stop_reason' => TimeEntry::STOP_IDLE_SERVER,
        ]);
    }

    private function resolveProjectAndTask(Request $request, User $user, ?TimeEntry $existingEntry = null): array|JsonResponse
    {
        $projectId = $request->exists('project_id')
            ? ($request->project_id ? (int) $request->project_id : null)
            : ($existingEntry?->project_id ? (int) $existingEntry->project_id : null);

        $taskId = $request->exists('task_id')
            ? ($request->task_id ? (int) $request->task_id : null)
            : ($existingEntry?->task_id ? (int) $existingEntry->task_id : null);
        $assignedProjectIds = $user->getHierarchyLevel() >= 100
            ? $user->assignedProjects()
                ->pluck('projects.id')
                ->map(fn ($id) => (int) $id)
                ->all()
            : [];

        if ($projectId) {
            $project = Project::query()
                ->where('organization_id', $user->organization_id)
                ->find($projectId);

            if (!$project) {
                return response()->json(['message' => 'Invalid project for your organization.'], 422);
            }

            if (!empty($assignedProjectIds) && !in_array($projectId, $assignedProjectIds, true)) {
                return response()->json(['message' => 'Selected project is not available for your account.'], 422);
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

            if (!empty($assignedProjectIds)) {
                if (!$task->project_id || !in_array((int) $task->project_id, $assignedProjectIds, true)) {
                    return response()->json([
                        'message' => 'Selected task is not available for your assigned projects.',
                    ], 422);
                }
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
        $idleAutoStopThresholdSeconds = $this->idleAutoStopThresholdSeconds(User::find($userId));
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

        // When the client's system idle API confirms >= threshold seconds of
        // idle, trust the client-reported lastActivityAt over database activity
        // record timestamps. The activity records may have inflated recorded_at
        // values because rewindTrackedIdleWindow uses idle-detection time
        // (~180s after actual idle) instead of the actual last user interaction.
        if ($reportedLastActivityAt && $reportedIdleSeconds >= $idleAutoStopThresholdSeconds) {
            $lastActiveAt = $reportedLastActivityAt;
        } elseif ($reportedLastActivityAt && $reportedLastActivityAt->betweenIncluded($sessionStartAt, $stoppedAt)) {
            $lastActiveAt = $reportedLastActivityAt;
        } else {
            $lastActiveAt = $lastNonIdleActivity?->recorded_at
                ? Carbon::parse($lastNonIdleActivity->recorded_at)
                : $sessionStartAt;
        }

        $idleStartAt = $lastActiveAt;

        $continuousIdleSeconds = max(0, $idleStartAt->diffInSeconds($stoppedAt));
        $trackedIdleSeconds = max($reportedIdleSeconds, (int) ($lastIdleActivity?->duration ?? 0));
        $resolvedIdleSeconds = min($continuousIdleSeconds, $trackedIdleSeconds);
        $retryAfterSeconds = max(1, $idleAutoStopThresholdSeconds - $resolvedIdleSeconds);
        $totalIdleSeconds = (clone $activityQuery)
            ->where('type', 'idle')
            ->sum('duration');

        $reportedIdleFromSystem = $reportedIdleSeconds >= $idleAutoStopThresholdSeconds;
        $continuousIdleFromActivity = $continuousIdleSeconds >= $idleAutoStopThresholdSeconds;
        $resolvedIdleFromBoth = $resolvedIdleSeconds >= $idleAutoStopThresholdSeconds;

        $activityNoiseGraceSeconds = 15;
        $hasRecentActivityNoise = $reportedIdleFromSystem
            && !$continuousIdleFromActivity
            && ($continuousIdleSeconds + $activityNoiseGraceSeconds) >= $idleAutoStopThresholdSeconds;

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
            'has_recent_activity_noise' => $hasRecentActivityNoise,
        ];

        $eligible = $resolvedIdleFromBoth || $hasRecentActivityNoise;

        // Trust the client's OS-level idle signal as authoritative for an idle
        // auto-stop. The database activity timeline can be polluted by non-idle
        // heartbeats emitted while the user is away (e.g. tab/extension pings,
        // a stray app event), which previously defeated a legitimate stop and
        // left the timer running forever. We still reject when the client
        // itself reports a recent last-activity timestamp -- a direct
        // contradiction of its own idle claim.
        if ($reportedIdleFromSystem) {
            $contradictedByClient = $reportedLastActivityAt !== null
                && $reportedLastActivityAt->greaterThan($stoppedAt->copy()->subSeconds($idleAutoStopThresholdSeconds));
            if (! $contradictedByClient) {
                $eligible = true;
            }
        }

        return [
            'eligible' => $eligible,
            'resolved_idle_seconds' => $resolvedIdleSeconds,
            // The last-keypress anchor, resolved with the client-vs-database
            // precedence above. Exposed so the stop path can rewind end_time to
            // it instead of re-deriving it with weaker logic.
            'last_active_at' => $lastActiveAt,
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

    /**
     * The idle threshold this user is actually held to.
     *
     * Resolved through TrackerPolicyResolver — the same call the client's own
     * threshold comes from — so the two sides cannot disagree. They used to be
     * configured independently, and a client set below the server proposed
     * stops that were rejected until it exhausted its retry cap.
     */
    private function idleAutoStopThresholdSeconds(?User $user = null): int
    {
        if ($user) {
            return (int) $this->trackerPolicy->resolveForUser($user)['idle_auto_stop_threshold_seconds'];
        }

        return max(60, (int) config('time_tracking.idle_auto_stop_threshold_seconds', 300));
    }

    private function syncTaskStatusForTimer(?int $taskId, User $user): void
    {
        if (! $taskId) {
            return;
        }

        $task = Task::query()->find($taskId);
        if (! $task) {
            return;
        }

        // Regular employees (level >= 100) start tracking time on a task →
        // move it to in_progress. Admins/managers (level < 100) may be
        // setting up tasks for others, so leave the status unchanged.
        if ($user->getHierarchyLevel() >= 100 && $task->status !== 'in_progress') {
            $task->update(['status' => 'in_progress']);
        }
    }

    private function checkGeofenceZone(User $user, Request $request): ?JsonResponse
    {
        if (! $request->filled('latitude') || ! $request->filled('longitude')) {
            return null;
        }

        if (! PlanService::hasFeature($user->organization, 'geo_fencing')) {
            return null;
        }

        $zone = GeofenceZone::activeForOrg((int) $user->organization_id)->first();
        if (! $zone) {
            return null;
        }

        if (! $zone->isWithinZone((float) $request->latitude, (float) $request->longitude)) {
            return response()->json([
                'message' => 'You are outside the allowed geofence zone. Timer cannot start.',
                'error_code' => 'OUTSIDE_GEOFENCE',
            ], 403);
        }

        return null;
    }

    private function logGeofenceAction(User $user, string $action, Request $request): void
    {
        if (! $request->filled('latitude') || ! $request->filled('longitude')) {
            return;
        }

        if (! PlanService::hasFeature($user->organization, 'geo_fencing')) {
            return;
        }

        /*
         * No consent to location capture: record the punch, drop the location.
         *
         * Deliberately a skip rather than a refusal. This runs as a side effect
         * of clocking in, and refusing the whole punch would stop someone
         * attending work over a data-collection preference — disproportionate,
         * and it would push people to withdraw consent and then be unable to
         * mark attendance at all. Dropping the coordinate is the
         * data-minimisation answer: the attendance record survives, the
         * location does not.
         */
        if (! app(\App\Services\Monitoring\MonitoringConsentService::class)
            ->isCaptureAllowed($user, 'location')) {
            return;
        }

        $zone = GeofenceZone::activeForOrg((int) $user->organization_id)->first();

        GeofenceLog::create([
            'user_id' => $user->id,
            'geofence_zone_id' => $zone?->id,
            'action' => $action,
            'latitude' => $request->latitude,
            'longitude' => $request->longitude,
            'accuracy_meters' => $request->filled('accuracy') ? (int) $request->accuracy : null,
        ]);
    }

    private function closeOpenAttendancePunches(int $userId, Carbon $cutoff): void
    {
        $today = now()->toDateString();
        $record = DB::table('attendance_records')
            ->where('user_id', $userId)
            ->whereDate('attendance_date', $today)
            ->first();

        if (!$record) {
            return;
        }

        $openPunches = DB::table('attendance_punches')
            ->where('attendance_record_id', $record->id)
            ->whereNull('punch_out_at')
            ->get();

        foreach ($openPunches as $punch) {
            DB::table('attendance_punches')
                ->where('id', $punch->id)
                ->update(['punch_out_at' => $cutoff]);
        }

        if ($openPunches->isNotEmpty()) {
            DB::table('attendance_records')
                ->where('id', $record->id)
                ->update(['check_out_at' => $cutoff]);
        }
    }
}
