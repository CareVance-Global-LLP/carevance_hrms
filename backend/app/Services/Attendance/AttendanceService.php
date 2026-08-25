<?php

namespace App\Services\Attendance;

use App\Models\AttendanceHoliday;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Reports\WorkTimeSummaryService;
use Carbon\Carbon;
use Carbon\CarbonPeriod;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Request;

class AttendanceService
{
    private const DEFAULT_OFFICE_START = '09:00:00';
    private const DEFAULT_LATE_AFTER = '10:30:00';

    public function __construct(
        private readonly UserTimezoneResolver $userTimezoneResolver,
    ) {
    }

    private function managerGroupIds(User $user): array
    {
        return $user->groups()
            ->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function visibleUsersQuery(User $user, bool $excludeHigherOrEqualRank = false): Builder
    {
        $query = User::query()->where('organization_id', $user->organization_id);
        $userLevel = $user->getHierarchyLevel();

        if ($userLevel <= 10) {
            return $query;
        }

        $groupIds = $this->managerGroupIds($user);
        if (empty($groupIds)) {
            /*
             * You can always see yourself.
             *
             * This returned an empty set, so an employee who belongs to no
             * group could not load their OWN attendance calendar — the target
             * resolved to them, the visibility query excluded them, and the
             * endpoint answered 403 to a person asking about their own
             * attendance. Group membership decides whose ELSE's records you
             * may read; it was never meant to gate your own.
             */
            return $query->where('id', $user->id);
        }

        if ($excludeHigherOrEqualRank) {
            $query->where(function (Builder $q) use ($userLevel, $user) {
                $q->whereHas('customRole', fn (Builder $q2) => $q2->where('hierarchy_level', '>', $userLevel))
                    ->orWhere(function (Builder $q2) use ($userLevel) {
                        $q2->whereNull('role_id')
                            ->whereRaw("CASE role WHEN 'admin' THEN 10 WHEN 'manager' THEN 50 WHEN 'employee' THEN 100 ELSE 999 END > ?", [$userLevel]);
                    })
                    // Always include the current user so they can see themselves in dashboard
                    ->orWhere('id', $user->id);
            });
        }

        // Same reason: the group filter narrows who else is visible, and must
        // not narrow away the person doing the asking.
        return $query->where(function (Builder $scoped) use ($groupIds, $user) {
            $scoped->whereHas('groups', fn (Builder $groupQuery) => $groupQuery->whereIn('groups.id', $groupIds))
                ->orWhere('id', $user->id);
        });
    }

    public function todayPayload(?User $user, ?int $targetUserId = null): array
    {
        if (!$user || !$user->organization_id) {
            return [
                'record' => null,
                'has_approved_leave_today' => false,
                'has_half_day_leave_today' => false,
            ];
        }

        $targetUser = $user;
        if ($targetUserId && $targetUserId !== (int) $user->id) {
            if (! $this->canManage($user)) {
                return [
                    'record' => null,
                    'late_after' => $this->lateAfterTimeForUser($user),
                    'office_start' => $this->officeStartTimeForUser($user),
                    'timezone' => $this->expectedTimezoneForUser($user),
                    'shift_target_seconds' => $this->shiftTargetSecondsFor($user),
                    'has_approved_leave_today' => false,
                    'has_half_day_leave_today' => false,
                    'leave_today' => null,
                ];
            }

            $targetUser = $this->visibleUsersQuery($user, $user->getHierarchyLevel() > 10 && $user->getHierarchyLevel() < 100)
                ->whereKey($targetUserId)
                ->first();

            if (! $targetUser) {
                return [
                    'record' => null,
                    'late_after' => $this->lateAfterTimeForUser($user),
                    'office_start' => $this->officeStartTimeForUser($user),
                    'timezone' => $this->expectedTimezoneForUser($user),
                    'shift_target_seconds' => $this->shiftTargetSecondsFor($user),
                    'has_approved_leave_today' => false,
                    'has_half_day_leave_today' => false,
                    'leave_today' => null,
                ];
            }
        }

        $today = now()->toDateString();
        $record = AttendanceRecord::where('user_id', $targetUser->id)
            ->whereDate('attendance_date', $today)
            ->with('punches')
            ->first();
        $leaveForToday = $this->approvedLeaveForDate($targetUser, $today);
        $shiftTarget = $this->shiftTargetSecondsForLeave($leaveForToday, $targetUser, $today);

        return [
            'record' => $this->decorateRecord($record, $leaveForToday, $targetUser),
            'late_after' => $this->lateAfterTimeForUser($targetUser),
            'office_start' => $this->officeStartTimeForUser($targetUser),
            'timezone' => $this->expectedTimezoneForUser($targetUser),
            'shift_target_seconds' => $shiftTarget,
            // Additive and descriptive: the shift scheduled for the SAME date
            // this payload's record is for, with both ends as real datetimes.
            // It is the only way a client can know that a night shift running
            // now finishes tomorrow morning; shift_target_seconds is a length
            // and says nothing about where the boundary falls.
            //
            // Deliberately NOT the attribution rule. ShiftResolver::
            // attendanceDateFor() is what decides which day a punch at 01:30
            // belongs to, and moving record creation onto it is a change to
            // how attendance is written, not how it is read. That stays a
            // separate, tested migration rather than a side effect of this key.
            'shift_occurrence' => app(ShiftResolver::class)
                ->occurrenceFor($targetUser, $today)?->toArray(),
            'has_approved_leave_today' => $leaveForToday && !$leaveForToday->isHalfDay(),
            'has_half_day_leave_today' => (bool) ($leaveForToday?->isHalfDay()),
            'leave_today' => $leaveForToday ? [
                'leave_type' => $leaveForToday->leave_type,
                'units' => $leaveForToday->unitsForDate($today),
                'label' => $leaveForToday->isHalfDay() ? 'Half day applied' : 'Approved leave',
            ] : null,
        ];
    }

    /**
     * Resolve an offline-supplied punch timestamp.
     *
     * Mirrors the timer's started_at handling: a client timestamp is honoured
     * whenever it is not in the future (skewed device clock), with no staleness
     * cap — re-stamping a buffered punch as "now" would file it into the wrong
     * attendance day.
     */
    private function resolveSyncTimestamp(?string $raw): Carbon
    {
        $now = now();

        if (!$raw) {
            return $now;
        }

        try {
            // Normalise to the app timezone so a buffered punch is filed on
            // the calendar day it actually happened.
            $parsed = Carbon::parse($raw)->setTimezone(config('app.timezone', 'UTC'));
        } catch (\Throwable) {
            return $now;
        }

        return $parsed->greaterThan($now) ? $now : $parsed;
    }

    /**
     * @param  array{local_id?:string|null,device_id?:string|null,punch_at?:string|null}  $syncContext
     *        Offline-sync metadata. `punch_at` is the original click-time from
     *        a buffered offline punch; local_id/device_id are the idempotency
     *        keys persisted on the punch row.
     */
    public function checkIn(
        ?User $user,
        ?float $latitude = null,
        ?float $longitude = null,
        array $syncContext = [],
    ): array {
        if (!$user || !$user->organization_id) {
            return ['status' => 422, 'payload' => ['message' => 'Organization is required.']];
        }

        /*
         * Resolved before anything else, because the day this punch belongs to
         * follows the punch, not the request that carried it.
         *
         * A buffered punch made at 23:50 and synced at 00:10 was filed under the
         * sync date, producing a record whose own `check_in_at` predated it: one
         * day split across two rows, absent from every report ranged over the
         * day it actually happened, and judged against the wrong day's late
         * threshold. Almost always these two dates agree — they differ exactly
         * when it matters, and the mobile offline queue makes that reachable
         * rather than theoretical.
         *
         * resolveSyncTimestamp() has already clamped a future-dated claim to
         * now(), so a skewed device clock cannot file attendance on a day that
         * has not happened.
         *
         * Deliberately NOT the shift-attribution rule. Whether a punch at 01:30
         * belongs to the previous night's shift is
         * ShiftResolver::attendanceDateFor()'s question, and moving record
         * creation onto it remains the separate migration reserved in
         * todayPayload(). This is the narrower half: file the punch on the
         * calendar day it was made.
         */
        $checkInAt = $this->resolveSyncTimestamp($syncContext['punch_at'] ?? null);
        $punchDate = $checkInAt->toDateString();

        if ($this->hasApprovedFullDayLeaveOnDate($user, $punchDate)) {
            return ['status' => 422, 'payload' => ['message' => 'You are on approved leave today. Punch in is blocked.']];
        }

        $record = AttendanceRecord::firstOrNew([
            'user_id' => $user->id,
            'attendance_date' => $punchDate,
        ]);

        $openPunch = AttendancePunch::where('user_id', $user->id)
            ->whereHas('attendanceRecord', function ($query) use ($punchDate) {
                $query->whereDate('attendance_date', $punchDate);
            })
            ->whereNull('punch_out_at')
            ->first();

        if ($openPunch) {
            return ['status' => 422, 'payload' => ['message' => 'You are already checked in for today']];
        }

        // Calculate late threshold in the employee's local timezone
        $employeeTimezone = $this->expectedTimezoneForUser($user);
        $lateAfterTime = $this->lateAfterTimeForUser($user);
        $officeStartTime = $this->officeStartTimeForUser($user);

        // The punch's own date in the employee's timezone. A record filed on the
        // 24th has to be judged against the 24th's threshold; reading the clock
        // instead measured a buffered punch against a day it does not belong to.
        $todayInEmployeeTz = $checkInAt->copy()->setTimezone($employeeTimezone)->toDateString();

        // Create the late threshold datetime in employee's timezone
        $lateThresholdInEmployeeTz = Carbon::parse($todayInEmployeeTz.' '.$lateAfterTime, $employeeTimezone);

        // Convert the check-in time to employee's timezone for comparison
        $checkInAtInEmployeeTz = $checkInAt->copy()->setTimezone($employeeTimezone);

        // Calculate late minutes: if check-in is after late threshold, calculate difference
        $lateMinutes = max(0, $lateThresholdInEmployeeTz->diffInMinutes($checkInAtInEmployeeTz, false));

        // Log timezone info for debugging (can be removed in production)
        \Log::debug('Attendance check-in timezone calculation', [
            'user_id' => $user->id,
            'employee_timezone' => $employeeTimezone,
            'office_start_time' => $officeStartTime,
            'late_after_time' => $lateAfterTime,
            'today_in_employee_tz' => $todayInEmployeeTz,
            'check_in_utc' => $checkInAt->toDateTimeString(),
            'check_in_employee_tz' => $checkInAtInEmployeeTz->toDateTimeString(),
            'late_threshold_employee_tz' => $lateThresholdInEmployeeTz->toDateTimeString(),
            'late_minutes' => $lateMinutes,
        ]);

        $record->organization_id = $user->organization_id;
        $record->status = 'present';
        if (!$record->check_in_at) {
            $record->check_in_at = $checkInAt;
            $record->late_minutes = (int) $lateMinutes;
        }
        $record->save();

        AttendancePunch::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'attendance_record_id' => $record->id,
            'punch_in_at' => $checkInAt,
            'punch_in_latitude' => $latitude,
            'punch_in_longitude' => $longitude,
            'local_id' => $syncContext['local_id'] ?? null,
            'device_id' => $syncContext['device_id'] ?? null,
        ]);

        /*
         * A punch marks presence. It does NOT start a timer.
         *
         * These are different questions. Attendance answers "was this person
         * here, from when to when" — which is what DayOutcomeService, late
         * marking and payroll are computed from, none of which read
         * time_entries. The timer answers "what were they doing at a computer",
         * and only a client watching keyboard and mouse can answer that.
         *
         * Starting one here was a real defect, not merely untidy. A punch from a
         * phone created a timer; `timers:close-idle` then found no keyboard
         * activity — because a phone cannot produce any — and closed it after
         * five minutes with duration 0, closing the attendance punch alongside
         * it. Somebody on site all day who never opened a laptop recorded a full
         * day's absence.
         *
         * The stale-timer close stays: arriving for the day should end a timer
         * left running from before, and the desktop still starts its own on
         * `POST /time-entries/start`, which marks attendance if nothing has yet.
         */
        $this->closeRunningPrimaryTimers((int) $user->id, $checkInAt);

        return [
            'status' => 200,
            'payload' => [
                'message' => 'Punched in successfully',
                'record' => $this->decorateRecord($record->fresh('punches'), null, $user),
            ],
        ];
    }

    /**
     * @param  array{local_id?:string|null,device_id?:string|null,punch_out_at?:string|null}  $syncContext
     *        Offline-sync metadata, mirroring checkIn(). A punch-out buffered
     *        while disconnected carries the time the employee actually clicked;
     *        without it the punch lands at whatever time the queue happened to
     *        drain, which silently inflates the worked hours for that day.
     */
    /**
     * The attendance record a check-out should close.
     *
     * Today first, because that is almost every punch. Failing that, the most
     * recent earlier day whose punch is still open — a night shift clocking in
     * at 22:00 checks out at 06:00 on the *next* calendar date, and a
     * `whereDate('attendance_date', today())` lookup could never find it. That
     * is what told somebody visibly checked in to "Please check in first", with
     * no way to end their own day at all.
     *
     * The bound matters as much as the widening. It is deliberately the same
     * `auto_close_max_hours` that CloseOpenAttendancePunches uses, so the two
     * cannot disagree about who owns a punch: inside the cap it is still the
     * employee's to close, beyond it the sweeper's — which rewinds to shift end
     * rather than crediting every hour since. Without the bound, a tap today
     * would close a punch abandoned last week and pay out the whole gap.
     */
    private function recordToCheckOutOf(?User $user, ?Carbon $at = null): ?AttendanceRecord
    {
        if (!$user) {
            return null;
        }

        /*
         * Anchored on the punch, not on the clock.
         *
         * For a live tap these are the same instant and nothing changes. For a
         * punch buffered by an offline tracker or a biometric terminal they are
         * not: resolveSyncTimestamp already recovers the time the employee
         * actually clocked out, and measuring "today" and the ownership window
         * from now() instead threw that away. A reading uploaded the next
         * morning looked for an open punch on the wrong day, found none, and
         * refused a punch-out for a day that was plainly still open.
         */
        $anchor = $at ? $at->copy() : now();
        $today = $anchor->toDateString();

        $todayRecord = AttendanceRecord::where('user_id', $user->id)
            ->whereDate('attendance_date', $today)
            ->with('punches')
            ->first();

        if ($todayRecord && $todayRecord->punches->contains(fn ($punch) => !$punch->punch_out_at)) {
            return $todayRecord;
        }

        $earliestStillOwned = $anchor->copy()->subHours(
            max(1, (int) config('attendance.auto_close_max_hours', 16))
        );

        $carryOver = AttendanceRecord::where('user_id', $user->id)
            ->whereDate('attendance_date', '<', $today)
            ->whereHas('punches', function ($query) use ($earliestStillOwned) {
                $query->whereNull('punch_out_at')
                    ->where('punch_in_at', '>=', $earliestStillOwned);
            })
            ->with('punches')
            ->orderByDesc('attendance_date')
            ->first();

        // Falling back to today's record keeps the original refusal messages
        // intact: "No active punch-in found." for a day already closed, rather
        // than "Please check in first" for a day that plainly exists.
        return $carryOver ?: $todayRecord;
    }

    public function checkOut(
        ?User $user,
        ?float $latitude = null,
        ?float $longitude = null,
        array $syncContext = [],
    ): array {
        if (!$user || !$user->organization_id) {
            return ['status' => 422, 'payload' => ['message' => 'Organization is required.']];
        }

        // A replayed punch-out must resolve to the punch it already closed,
        // rather than reporting "No active punch-in found" and looking like a
        // hard failure to a queue that is in fact fully synced.
        $localId = $syncContext['local_id'] ?? null;
        $deviceId = $syncContext['device_id'] ?? null;
        if ($localId && $deviceId) {
            $alreadyApplied = AttendancePunch::where('user_id', $user->id)
                ->where('local_id', $localId)
                ->where('device_id', $deviceId)
                ->whereNotNull('punch_out_at')
                ->exists();

            if ($alreadyApplied) {
                // Resolved through the punch itself, not today's date: a night
                // shift's punch-out is replayed on the day after the record it
                // belongs to, and a date lookup would return nothing.
                $existing = AttendanceRecord::whereHas('punches', function ($query) use ($localId, $deviceId) {
                    $query->where('local_id', $localId)->where('device_id', $deviceId);
                })
                    ->where('user_id', $user->id)
                    ->with('punches')
                    ->first();

                return [
                    'status' => 200,
                    'payload' => [
                        'message' => 'Punched out successfully',
                        'record' => $existing ? $this->decorateRecord($existing, null, $user) : null,
                    ],
                ];
            }
        }

        // Resolved before the lookup, because it decides which day the lookup
        // is for. A buffered punch-out belongs to the day it was made, not the
        // day the queue happened to drain.
        $checkOutAt = $this->resolveSyncTimestamp($syncContext['punch_out_at'] ?? null);

        $record = $this->recordToCheckOutOf($user, $checkOutAt);

        if (!$record || !$record->check_in_at) {
            return ['status' => 422, 'payload' => ['message' => 'Please check in first']];
        }

        $openPunch = $record->punches->first(fn ($p) => !$p->punch_out_at);
        if (!$openPunch) {
            return ['status' => 422, 'payload' => ['message' => 'No active punch-in found.']];
        }

        // A buffered punch-out cannot predate its own punch-in: clock skew on
        // the tracker machine would otherwise produce a negative session.
        $punchInAt = Carbon::parse($openPunch->punch_in_at);
        if ($checkOutAt->lessThan($punchInAt)) {
            $checkOutAt = $punchInAt;
        }

        $sessionWorkedSeconds = max(0, $punchInAt->diffInSeconds($checkOutAt));
        $openPunch->update([
            'punch_out_at' => $checkOutAt,
            'worked_seconds' => (int) $sessionWorkedSeconds,
            'punch_out_latitude' => $latitude,
            'punch_out_longitude' => $longitude,
            'local_id' => $localId ?? $openPunch->local_id,
            'device_id' => $deviceId ?? $openPunch->device_id,
        ]);

        $record = $record->fresh('punches');
        $workedSeconds = $this->calculateClosedWorkedSeconds($record);

        $record->update([
            'check_out_at' => $checkOutAt,
            'worked_seconds' => (int) $workedSeconds,
            'status' => 'present',
        ]);
        $this->closeRunningPrimaryTimers((int) $user->id, $checkOutAt);

        return [
            'status' => 200,
            'payload' => [
                'message' => 'Punched out successfully',
                'record' => $this->decorateRecord($record->fresh('punches'), null, $user),
            ],
        ];
    }

    public function calendar(Request $request, ?User $currentUser): array
    {
        if (!$currentUser || !$currentUser->organization_id) {
            return ['status' => 200, 'payload' => ['days' => [], 'summary' => null]];
        }

        $month = $request->get('month', now()->format('Y-m'));
        $monthStart = Carbon::createFromFormat('Y-m', $month)->startOfMonth();
        $monthEnd = $monthStart->copy()->endOfMonth();
        $scope = (string) $request->get('scope', 'selected');

        if ($scope === 'overall' && $this->canManage($currentUser)) {
            return $this->overallCalendarPayload($request, $currentUser, $monthStart, $monthEnd);
        }

        $targetUserId = $this->resolveTargetUserId($currentUser, $request);

        if (!$targetUserId) {
            return ['status' => 403, 'payload' => ['message' => 'Forbidden']];
        }

        $targetUser = $this->visibleUsersQuery($currentUser, $currentUser->getHierarchyLevel() > 10 && $currentUser->getHierarchyLevel() < 100)
            ->where('id', $targetUserId)
            ->first();
        if (!$targetUser) {
            return ['status' => 403, 'payload' => ['message' => 'Forbidden']];
        }

        $targetCountry = AttendanceHoliday::countryForSettings($targetUser->settings);

        $records = AttendanceRecord::where('organization_id', $currentUser->organization_id)
            ->where('user_id', $targetUserId)
            ->whereDate('attendance_date', '>=', $monthStart->toDateString())
            ->whereDate('attendance_date', '<=', $monthEnd->toDateString())
            ->orderBy('attendance_date')
            ->with('punches')
            ->get()
            ->keyBy(fn (AttendanceRecord $r) => Carbon::parse($r->attendance_date)->toDateString());

        $approvedLeaves = LeaveRequest::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where('user_id', $targetUserId)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $monthEnd->toDateString())
            ->whereDate('end_date', '>=', $monthStart->toDateString())
            ->get(['start_date', 'end_date', 'leave_type']);

        $leaveByDate = $approvedLeaves
            ->flatMap(fn (LeaveRequest $leave) => $leave->effectiveDateEntriesInRange($monthStart, $monthEnd))
            ->groupBy('date')
            ->map(function ($entries) {
                $maxUnits = (float) collect($entries)->max('units');
                $leaveType = collect($entries)->contains(fn ($entry) => ($entry['leave_type'] ?? null) === 'half_day')
                    ? 'half_day'
                    : 'full_day';

                return [
                    'units' => $maxUnits,
                    'leave_type' => $leaveType,
                ];
            });

        $holidays = AttendanceHoliday::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereBetween('holiday_date', [$monthStart->toDateString(), $monthEnd->toDateString()])
            ->whereIn('country', ['ALL', $targetCountry])
            ->orderBy('holiday_date')
            ->get();

        $holidayByDate = $holidays
            ->sortBy(fn (AttendanceHoliday $holiday) => $holiday->country === $targetCountry ? 0 : 1)
            ->groupBy(fn (AttendanceHoliday $holiday) => Carbon::parse($holiday->holiday_date)->toDateString())
            ->map(fn ($group) => $group->first());

        $days = [];
        $present = 0;
        $absent = 0;
        $weekend = 0;
        $leaveDays = 0;
        $holidayDays = 0;
        $late = 0;
        $totalWorked = 0;
        $today = now()->toDateString();

        foreach (CarbonPeriod::create($monthStart, $monthEnd) as $date) {
            $dateStr = $date->toDateString();
            $isWeekend = $date->isWeekend();
            $record = $records->get($dateStr);
            $leaveEntry = $leaveByDate->get($dateStr);
            $leaveUnits = (float) ($leaveEntry['units'] ?? 0);
            $isLeave = $leaveUnits > 0;
            $isHalfLeave = $leaveUnits > 0 && $leaveUnits < 1;
            $holiday = $holidayByDate->get($dateStr);
            $isHoliday = (bool) $holiday;

            if ($isHoliday) {
                $status = 'holiday';
                $holidayDays++;
                if ($record && $record->check_in_at) {
                    $present++;
                    $totalWorked += $this->calculateEffectiveWorkedSeconds($record);
                }
            } elseif ($isHalfLeave) {
                $status = 'half_leave';
                $leaveDays += $leaveUnits;
                if ($record && $record->check_in_at) {
                    $present++;
                    $totalWorked += $this->calculateEffectiveWorkedSeconds($record);
                }
            } elseif ($isLeave) {
                $status = 'leave';
                $leaveDays += $leaveUnits;
            } elseif ($record && $record->check_in_at && !$record->check_out_at) {
                $status = 'checked_in';
                $present++;
                $totalWorked += $this->calculateEffectiveWorkedSeconds($record);
            } elseif ($record && $record->check_in_at) {
                $status = 'present';
                $present++;
                $totalWorked += $this->calculateEffectiveWorkedSeconds($record);
            } else {
                $status = 'none';
                if ($isWeekend) {
                    $weekend++;
                } elseif ($dateStr <= $today) {
                    $absent++;
                }
            }

            if ($record && (int) $record->late_minutes > 0) {
                $late++;
            }

            $isLate = $record && (int) $record->late_minutes > 0;

            $days[] = [
                'date' => $dateStr,
                'status' => $status,
                'is_weekend' => $isWeekend,
                'is_leave' => $isLeave,
                'is_half_leave' => $isHalfLeave,
                'leave_units' => $leaveUnits,
                'leave_type' => $leaveEntry['leave_type'] ?? null,
                'is_holiday' => $isHoliday,
                'check_in_at' => $record?->check_in_at,
                'check_out_at' => $record?->check_out_at,
                'late_minutes' => (int) ($record?->late_minutes ?? 0),
                'worked_seconds' => $record ? $this->calculateEffectiveWorkedSeconds($record) : 0,
                'present_count' => ($status === 'present' || $status === 'checked_in') && !$isLate ? 1 : 0,
                'late_count' => ($status === 'present' || $status === 'checked_in') && $isLate ? 1 : 0,
                'absent_count' => $status === 'none' && !$isWeekend && !$isLeave && !$isHoliday ? 1 : 0,
                'total_employees' => 1,
                'holiday' => $holiday ? [
                    'id' => $holiday->id,
                    'date' => $dateStr,
                    'country' => $holiday->country,
                    'title' => $holiday->title,
                    'details' => $holiday->details,
                ] : null,
            ];
        }

        return [
            'status' => 200,
            'payload' => [
                'month' => $month,
                'scope' => 'selected',
                'user_id' => $targetUserId,
                'viewer_country' => $targetCountry,
                'days' => $days,
                'summary' => [
                    'present_days' => $present,
                    'absent_days' => $absent,
                    'weekend_days' => $weekend,
                    'leave_days' => round($leaveDays, 2),
                    'holiday_days' => $holidayDays,
                    'late_days' => $late,
                    'total_worked_seconds' => (int) $totalWorked,
                    'overall_employee_count' => 1,
                ],
            ],
        ];
    }

    private function overallCalendarPayload(Request $request, User $currentUser, Carbon $monthStart, Carbon $monthEnd): array
    {
        $countryFilter = AttendanceHoliday::normalizeCountry((string) $request->get('country', 'ALL'));

        $users = $this->visibleUsersQuery($currentUser, $currentUser->getHierarchyLevel() > 10 && $currentUser->getHierarchyLevel() < 100)
            ->get(['id', 'settings']);

        if ($countryFilter !== 'ALL') {
            $users = $users
                ->filter(fn (User $user) => AttendanceHoliday::countryForSettings($user->settings) === $countryFilter)
                ->values();
        }

        $userIds = $users->pluck('id')->values();
        $totalEmployees = $userIds->count();

        if ($userIds->isEmpty()) {
            $days = collect(CarbonPeriod::create($monthStart, $monthEnd))
                ->map(function (Carbon $date) {
                    return [
                        'date' => $date->toDateString(),
                        'status' => 'none',
                        'is_weekend' => $date->isWeekend(),
                        'is_leave' => false,
                        'is_holiday' => false,
                        'check_in_at' => null,
                        'check_out_at' => null,
                        'late_minutes' => 0,
                        'worked_seconds' => 0,
                        'holiday' => null,
                    ];
                })
                ->values()
                ->all();

            return [
                'status' => 200,
                'payload' => [
                    'month' => $monthStart->format('Y-m'),
                    'scope' => 'overall',
                    'user_id' => null,
                    'viewer_country' => $countryFilter,
                    'days' => $days,
                    'summary' => [
                        'present_days' => 0,
                        'absent_days' => 0,
                        'weekend_days' => collect($days)->where('is_weekend', true)->count(),
                        'leave_days' => 0,
                        'holiday_days' => 0,
                        'late_days' => 0,
                        'total_worked_seconds' => 0,
                        'overall_employee_count' => 0,
                    ],
                ],
            ];
        }

        $records = AttendanceRecord::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('user_id', $userIds->all())
            ->whereDate('attendance_date', '>=', $monthStart->toDateString())
            ->whereDate('attendance_date', '<=', $monthEnd->toDateString())
            ->get(['attendance_date', 'check_in_at', 'check_out_at', 'worked_seconds', 'manual_adjustment_seconds', 'late_minutes']);

        $recordsByDate = $records->groupBy(fn (AttendanceRecord $record) => Carbon::parse($record->attendance_date)->toDateString());

        $leaveCountsByDate = collect();
        $approvedLeaves = LeaveRequest::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('user_id', $userIds->all())
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $monthEnd->toDateString())
            ->whereDate('end_date', '>=', $monthStart->toDateString())
            ->get(['user_id', 'start_date', 'end_date', 'leave_type']);

        foreach ($approvedLeaves as $leave) {
            foreach ($leave->effectiveDateEntriesInRange($monthStart, $monthEnd) as $entry) {
                $dateStr = (string) ($entry['date'] ?? '');
                if ($dateStr === '') {
                    continue;
                }

                $existing = $leaveCountsByDate->get($dateStr, ['units' => 0.0, 'half_day_count' => 0, 'full_day_count' => 0]);
                $existing['units'] = (float) $existing['units'] + (float) ($entry['units'] ?? 0);
                if (($entry['leave_type'] ?? null) === 'half_day') {
                    $existing['half_day_count'] = (int) $existing['half_day_count'] + 1;
                } else {
                    $existing['full_day_count'] = (int) $existing['full_day_count'] + 1;
                }
                $leaveCountsByDate->put($dateStr, $existing);
            }
        }

        $holidayQuery = AttendanceHoliday::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereBetween('holiday_date', [$monthStart->toDateString(), $monthEnd->toDateString()]);

        if ($countryFilter !== 'ALL') {
            $holidayQuery->whereIn('country', ['ALL', $countryFilter]);
        }

        $holidays = $holidayQuery
            ->orderBy('holiday_date')
            ->get();

        $holidayByDate = $holidays
            ->sortBy(fn (AttendanceHoliday $holiday) => $holiday->country === $countryFilter ? 0 : 1)
            ->groupBy(fn (AttendanceHoliday $holiday) => Carbon::parse($holiday->holiday_date)->toDateString())
            ->map(fn ($group) => $group->first());

        $days = [];
        $present = 0;
        $absent = 0;
        $weekend = 0;
        $leaveDays = 0;
        $holidayDays = 0;
        $late = 0;
        $totalWorked = 0;
        $today = now()->toDateString();

        foreach (CarbonPeriod::create($monthStart, $monthEnd) as $date) {
            $dateStr = $date->toDateString();
            $isWeekend = $date->isWeekend();
            $dayRecords = $recordsByDate->get($dateStr, collect());
            $presentCount = $dayRecords->filter(fn ($record) => (bool) $record->check_in_at)->count();
            $lateCount = $dayRecords->filter(fn ($record) => (int) $record->late_minutes > 0 && (bool) $record->check_in_at)->count();
            $onTimeCount = $presentCount - $lateCount;
            $workedSeconds = (int) $dayRecords->sum(fn ($record) => (int) ($record->worked_seconds ?? 0) + (int) ($record->manual_adjustment_seconds ?? 0));
            $leaveMeta = $leaveCountsByDate->get($dateStr, ['units' => 0.0, 'half_day_count' => 0, 'full_day_count' => 0]);
            $leaveUnits = (float) ($leaveMeta['units'] ?? 0);
            $hasHalfLeave = (int) ($leaveMeta['half_day_count'] ?? 0) > 0;
            $holiday = $holidayByDate->get($dateStr);
            $isHoliday = (bool) $holiday;

            // Compute per-category counts for overall mode
            $absentCount = $totalEmployees - $onTimeCount - $lateCount;
            if ($hasHalfLeave) {
                $absentCount = max(0, $absentCount - $leaveMeta['half_day_count']);
            } elseif ($leaveUnits > 0) {
                $approxLeaveDays = (int) ceil($leaveUnits);
                $absentCount = max(0, $absentCount - $approxLeaveDays);
            }

            if ($isHoliday) {
                $status = 'holiday';
                $holidayDays++;
                if ($presentCount > 0) {
                    $present++;
                }
            } elseif ($hasHalfLeave) {
                $status = 'half_leave';
                $leaveDays += $leaveUnits;
                if ($presentCount > 0) {
                    $present++;
                }
            } elseif ($presentCount > 0) {
                $status = $presentCount >= $totalEmployees ? 'present' : 'checked_in';
                $present++;
            } elseif ($leaveUnits > 0) {
                $status = 'leave';
                $leaveDays += $leaveUnits;
            } else {
                $status = 'none';
                if ($isWeekend) {
                    $weekend++;
                } elseif ($dateStr <= $today) {
                    $absent++;
                }
            }

            if ($lateCount > 0) {
                $late++;
            }

            $totalWorked += $workedSeconds;

            $days[] = [
                'date' => $dateStr,
                'status' => $status,
                'is_weekend' => $isWeekend,
                'is_leave' => $leaveUnits > 0,
                'is_half_leave' => $hasHalfLeave,
                'leave_units' => $leaveUnits,
                'leave_type' => $hasHalfLeave ? 'half_day' : ($leaveUnits > 0 ? 'full_day' : null),
                'is_holiday' => $isHoliday,
                'check_in_at' => null,
                'check_out_at' => null,
                'late_minutes' => $lateCount,
                'worked_seconds' => $workedSeconds,
                'present_count' => $onTimeCount,
                'late_count' => $lateCount,
                'absent_count' => $absentCount,
                'total_employees' => $totalEmployees,
                'holiday' => $holiday ? [
                    'id' => $holiday->id,
                    'date' => $dateStr,
                    'country' => $holiday->country,
                    'title' => $holiday->title,
                    'details' => $holiday->details,
                ] : null,
            ];
        }

        return [
            'status' => 200,
            'payload' => [
                'month' => $monthStart->format('Y-m'),
                'scope' => 'overall',
                'user_id' => null,
                'viewer_country' => $countryFilter,
                'days' => $days,
                'summary' => [
                    'present_days' => $present,
                    'absent_days' => $absent,
                    'weekend_days' => $weekend,
                    'leave_days' => round($leaveDays, 2),
                    'holiday_days' => $holidayDays,
                    'late_days' => $late,
                    'total_worked_seconds' => (int) $totalWorked,
                    'overall_employee_count' => $totalEmployees,
                ],
            ],
        ];
    }

    public function summary(Request $request, ?User $currentUser): array
    {
        if (!$currentUser || !$currentUser->organization_id) {
            return ['data' => []];
        }

        $start = Carbon::parse($request->get('start_date', now()->startOfMonth()->toDateString()))->startOfDay();
        $end = Carbon::parse($request->get('end_date', now()->toDateString()))->endOfDay();
        if ($start->greaterThan($end)) {
            [$start, $end] = [$end->copy()->startOfDay(), $start->copy()->endOfDay()];
        }

        $usersQuery = $this->visibleUsersQuery($currentUser, $currentUser->getHierarchyLevel() > 10 && $currentUser->getHierarchyLevel() < 100);
        if ($this->canManage($currentUser) && $request->filled('q')) {
            $term = trim((string) $request->q);
            $usersQuery->where(function ($q) use ($term) {
                $q->where('name', 'like', "%{$term}%")
                    ->orWhere('email', 'like', "%{$term}%");
            });
        }

        $users = $usersQuery->orderBy('name')->get(['id', 'name', 'email', 'role', 'role_id']);
        $today = now()->toDateString();
        $approvedLeaveTodayByUserId = LeaveRequest::query()
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('user_id', $users->pluck('id'))
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $today)
            ->whereDate('end_date', '>=', $today)
            ->get(['user_id', 'leave_type'])
            ->keyBy(fn (LeaveRequest $leave) => (int) $leave->user_id);

        // Get active time entries (desktop timers) for today
        $activeTimeEntriesToday = TimeEntry::query()
            ->whereIn('user_id', $users->pluck('id'))
            ->whereNull('end_time')
            ->where('is_break', false)
            ->whereDate('start_time', '<=', now())
            ->get()
            ->keyBy(fn (TimeEntry $entry) => (int) $entry->user_id);

        $rows = $users->map(function (User $user) use ($approvedLeaveTodayByUserId, $activeTimeEntriesToday, $currentUser, $start, $end) {
            $records = AttendanceRecord::where('organization_id', $currentUser->organization_id)
                ->where('user_id', $user->id)
                ->whereDate('attendance_date', '>=', $start->toDateString())
                ->whereDate('attendance_date', '<=', $end->toDateString())
                ->with('punches')
                ->get();

            $presentDays = $records->whereNotNull('check_in_at')->count();
            $lateDays = $records->filter(fn ($r) => (int) $r->late_minutes > 0)->count();
            $totalWorkedSeconds = (int) $records->sum(fn (AttendanceRecord $r) => $this->calculateEffectiveWorkedSeconds($r));
            $todayRecord = $records->first(fn (AttendanceRecord $r) => Carbon::parse($r->attendance_date)->isToday());
            $latestRecord = $records->sortByDesc(fn (AttendanceRecord $r) => Carbon::parse($r->attendance_date)->timestamp)->first();
            $openPunch = $todayRecord?->punches?->first(fn (AttendancePunch $punch) => !$punch->punch_out_at);
            $latestPunch = $latestRecord?->punches?->sortByDesc(fn (AttendancePunch $punch) => Carbon::parse($punch->punch_in_at)->timestamp)->first();
            
            // Check if user has active time entry (desktop timer running)
            $hasActiveTimeEntry = $activeTimeEntriesToday->has((int) $user->id);
            $checkedInToday = ($todayRecord && $this->hasOpenPunch($todayRecord)) || $hasActiveTimeEntry;
            
            // If there's an active time entry but no attendance record, add worked seconds from timer
            if ($hasActiveTimeEntry && !$todayRecord) {
                $timeEntry = $activeTimeEntriesToday->get((int) $user->id);
                $timerSeconds = max(0, Carbon::parse($timeEntry->start_time)->diffInSeconds(now()));
                $totalWorkedSeconds += $timerSeconds;
            }
            $leaveToday = $approvedLeaveTodayByUserId->get((int) $user->id);
            $hasHalfDayLeaveToday = (bool) $leaveToday && $leaveToday->isHalfDay();
            $hasApprovedLeaveToday = (bool) $leaveToday && !$hasHalfDayLeaveToday;
            $attendanceStatus = (string) ($todayRecord?->status ?? '');

            if ($hasApprovedLeaveToday && !$checkedInToday && !$todayRecord?->check_in_at) {
                $attendanceStatus = 'leave';
            } elseif ($hasHalfDayLeaveToday && $attendanceStatus === '') {
                $attendanceStatus = 'half_leave';
            }

            // Determine effective attendance status
            $effectiveAttendanceStatus = $attendanceStatus;
            if ($hasActiveTimeEntry && empty($attendanceStatus)) {
                $effectiveAttendanceStatus = 'working'; // User has desktop timer running
            }

            return [
                'user' => $user,
                'present_days' => $presentDays,
                'late_days' => $lateDays,
                'late_minutes' => (int) ($todayRecord?->late_minutes ?? 0),
                'total_worked_seconds' => $totalWorkedSeconds,
                'is_checked_in' => (bool) $checkedInToday,
                'has_active_timer' => $hasActiveTimeEntry,
                'timer_started_at' => $activeTimeEntriesToday->get((int) $user->id)?->start_time,
                'check_in_at' => $todayRecord?->check_in_at,
                'check_out_at' => $todayRecord?->check_out_at,
                'open_punch_in_at' => $openPunch?->punch_in_at,
                'last_check_in_at' => $latestPunch?->punch_in_at ?? $latestRecord?->check_in_at,
                'last_check_out_at' => $latestPunch?->punch_out_at ?? $latestRecord?->check_out_at,
                'last_attendance_date' => $latestRecord ? Carbon::parse($latestRecord->attendance_date)->toDateString() : null,
                'attendance_status' => $effectiveAttendanceStatus,
                'has_approved_leave_today' => $hasApprovedLeaveToday,
                'has_half_day_leave_today' => $hasHalfDayLeaveToday,
                'is_leave' => $hasApprovedLeaveToday || $hasHalfDayLeaveToday || str_contains(strtolower($attendanceStatus), 'leave'),
            ];
        })->values();

        return [
            'start_date' => $start->toDateString(),
            'end_date' => $end->toDateString(),
            'data' => $rows,
        ];
    }

    private function resolveTargetUserId(User $currentUser, Request $request): ?int
    {
        if ($this->canManage($currentUser) && $request->filled('user_id')) {
            $target = $this->visibleUsersQuery($currentUser, $currentUser->getHierarchyLevel() > 10 && $currentUser->getHierarchyLevel() < 100)
                ->where('id', (int) $request->user_id)
                ->first();

            return $target?->id;
        }

        return $currentUser->id;
    }

    private function canManage(User $user): bool
    {
        return $user->getHierarchyLevel() < 100;
    }

    private function decorateRecord(
        ?AttendanceRecord $record,
        ?LeaveRequest $leaveForDate = null,
        ?User $user = null,
    ): ?array {
        if (!$record) {
            if (!$leaveForDate) {
                return null;
            }

            $target = $this->shiftTargetSecondsForLeave($leaveForDate, $user, now()->toDateString());

            return [
                'id' => null,
                'attendance_date' => now()->toDateString(),
                'check_in_at' => null,
                'check_out_at' => null,
                'worked_seconds' => 0,
                'manual_adjustment_seconds' => 0,
                'late_minutes' => 0,
                'status' => $leaveForDate->isHalfDay() ? 'half_leave' : 'absent',
                'is_checked_in' => false,
                'total_break_seconds' => 0,
                'work_time_breakdown' => [
                    'track_time' => 0,
                    'work_time' => 0,
                    'idle_time' => 0,
                    'break_time' => 0,
                ],
                'shift_target_seconds' => $target,
                'remaining_shift_seconds' => $target,
                'completed_shift' => false,
                'leave_type' => $leaveForDate->leave_type,
                'leave_units' => $leaveForDate->unitsForDate(now()),
                'punches' => [],
            ];
        }

        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        $worked = $this->calculateEffectiveWorkedSeconds($record);
        $breakSeconds = $this->calculateBreakSeconds($record);
        $recordDate = Carbon::parse($record->attendance_date)->startOfDay();
        // The record knows whose day it is; resolving the owner here means a
        // punch payload cannot report a different shift length from the one
        // /attendance/today reported five seconds earlier.
        $recordUser = $user && (int) $user->id === (int) $record->user_id
            ? $user
            : $record->user ?? User::find($record->user_id);
        $target = $this->shiftTargetSecondsForLeave($leaveForDate, $recordUser, $recordDate);
        $workTimeBreakdown = app(WorkTimeSummaryService::class)->forUserRange(
            $record->user_id,
            $recordDate,
            $recordDate->copy()->endOfDay()
        );

        return [
            'id' => $record->id,
            'attendance_date' => Carbon::parse($record->attendance_date)->toDateString(),
            'check_in_at' => $record->check_in_at,
            'check_out_at' => $record->check_out_at,
            'worked_seconds' => $worked,
            'manual_adjustment_seconds' => (int) ($record->manual_adjustment_seconds ?? 0),
            'late_minutes' => (int) $record->late_minutes,
            'status' => $record->status,
            'is_checked_in' => $this->hasOpenPunch($record),
            'total_break_seconds' => $breakSeconds,
            'work_time_breakdown' => $workTimeBreakdown,
            'shift_target_seconds' => $target,
            'remaining_shift_seconds' => max(0, $target - $worked),
            'completed_shift' => $worked >= $target,
            'leave_type' => $leaveForDate?->leave_type,
            'leave_units' => $leaveForDate ? $leaveForDate->unitsForDate($record->attendance_date) : 0,
            'punches' => $record->punches->map(fn (AttendancePunch $punch) => [
                'id' => $punch->id,
                'punch_in_at' => $punch->punch_in_at,
                'punch_out_at' => $punch->punch_out_at,
                'worked_seconds' => (int) $punch->worked_seconds,
            ])->values(),
        ];
    }

    /**
     * The organization-agnostic last resort: eight hours, from config.
     *
     * Kept only for callers that genuinely have no employee and no date to
     * resolve against. Anything that knows who and when must use
     * shiftTargetSecondsFor(), or it will report an eight-hour day to an
     * organization that does not run one.
     */
    public function shiftTargetSeconds(): int
    {
        return config('attendance.shift_seconds', 8 * 3600);
    }

    /**
     * How long this person's shift is on this date.
     *
     * The shift domain answers first. It returns null for an organization that
     * has configured no shifts — which is every organization until it rosters
     * someone — and for a day its shift does not run, so the config default
     * stays as the fallback rather than being replaced by a zero that would
     * mark every Sunday as an instantly completed shift.
     *
     * An explicit ZERO is the one exception, and it means something the null
     * does not: the employee is on a weekly-off policy that names this date as
     * a day off. That is a complete answer, not a missing one, and falling
     * through to eight hours there would tell somebody they owed a full day on
     * their day off. Only a configured weekly off can produce it — an
     * organization with no policy never sees a zero and is unaffected.
     */
    public function shiftTargetSecondsFor(?User $user, Carbon|string|null $date = null): int
    {
        $resolved = $user
            ? app(ShiftResolver::class)->expectedSecondsFor($user, $date)
            : null;

        if ($resolved !== null && $resolved >= 0) {
            return $resolved;
        }

        return $this->shiftTargetSeconds();
    }

    private function officeStartTimeForUser(User $user): string
    {
        // First check employee's personal expected_start_time from employee_work_infos
        $employeeWorkInfo = $user->employeeWorkInfo;
        if ($employeeWorkInfo && $employeeWorkInfo->expected_start_time) {
            return $this->normalizeTimeString(
                $employeeWorkInfo->expected_start_time,
                self::DEFAULT_OFFICE_START
            );
        }

        // Fall back to organization attendance settings
        $attendanceSettings = $this->attendanceSettingsForUser($user);

        return $this->normalizeTimeString(
            $attendanceSettings['office_start_time'] ?? null,
            self::DEFAULT_OFFICE_START
        );
    }

    private function lateAfterTimeForUser(User $user): string
    {
        // First check employee's personal expected_start_time from employee_work_infos
        $employeeWorkInfo = $user->employeeWorkInfo;
        if ($employeeWorkInfo && $employeeWorkInfo->expected_start_time) {
            // Use expected_start_time + 1.5 hours as late threshold (same logic as org settings)
            $expectedStart = $this->normalizeTimeString(
                $employeeWorkInfo->expected_start_time,
                self::DEFAULT_OFFICE_START
            );

            // Add 1.5 hours to expected start time for late threshold
            $startTime = Carbon::parse($expectedStart);
            $lateTime = $startTime->copy()->addMinutes(90);

            return $lateTime->format('H:i:s');
        }

        // Fall back to organization attendance settings
        $attendanceSettings = $this->attendanceSettingsForUser($user);

        return $this->normalizeTimeString(
            $attendanceSettings['late_after_time'] ?? null,
            config('attendance.late_after', self::DEFAULT_LATE_AFTER)
        );
    }

    /**
     * The chain this method used to own now lives in UserTimezoneResolver, so
     * the activity feed and the report rollups resolve the same zone this does.
     * Order and outcome are unchanged; only the home moved.
     */
    private function expectedTimezoneForUser(User $user): string
    {
        return $this->userTimezoneResolver->forUser($user);
    }

    private function attendanceSettingsForUser(User $user): array
    {
        $settings = is_array($user->organization?->settings) ? $user->organization->settings : [];
        $attendance = $settings['attendance'] ?? null;

        return is_array($attendance) ? $attendance : [];
    }

    private function normalizeTimeString(mixed $value, string $fallback): string
    {
        if (!is_string($value) || trim($value) === '') {
            return Carbon::parse($fallback)->format('H:i:s');
        }

        try {
            return Carbon::parse($value)->format('H:i:s');
        } catch (\Throwable) {
            return Carbon::parse($fallback)->format('H:i:s');
        }
    }

    private function shiftTargetSecondsForLeave(
        ?LeaveRequest $leave,
        ?User $user = null,
        Carbon|string|null $date = null,
    ): int {
        // Half a day is half of THIS person's shift, not half of a global
        // eight hours. On a six-hour shift the two answers differ by an hour.
        $baseTarget = $this->shiftTargetSecondsFor($user, $date);
        if (!$leave || !$leave->isHalfDay()) {
            return $baseTarget;
        }

        return max(1, (int) floor($baseTarget / 2));
    }

    private function approvedLeaveForDate(User $user, string $date): ?LeaveRequest
    {
        return LeaveRequest::where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $date)
            ->whereDate('end_date', '>=', $date)
            ->orderByRaw("case when leave_type = 'full_day' then 0 else 1 end")
            ->first();
    }

    private function hasApprovedFullDayLeaveOnDate(User $user, string $date): bool
    {
        $leave = $this->approvedLeaveForDate($user, $date);

        return (bool) $leave && !$leave->isHalfDay();
    }

    /**
     * Total the closed punches on a record.
     *
     * Public because the auto-close sweeper needs the same sum. Duplicating it
     * there is how the record total and the punches drift apart, which has
     * already happened once — a cron-closed day reported no work because the
     * punch was written and the record was not.
     */
    public function calculateClosedWorkedSeconds(AttendanceRecord $record): int
    {
        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        return (int) $record->punches
            ->filter(fn (AttendancePunch $punch) => (bool) $punch->punch_out_at)
            ->sum(fn (AttendancePunch $punch) => max(
                (int) $punch->worked_seconds,
                (int) Carbon::parse($punch->punch_in_at)->diffInSeconds(Carbon::parse($punch->punch_out_at))
            ));
    }

    public function calculateEffectiveWorkedSeconds(AttendanceRecord $record): int
    {
        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        $closed = $this->calculateClosedWorkedSeconds($record);
        $open = 0;
        $openPunch = $record->punches->first(fn (AttendancePunch $punch) => !$punch->punch_out_at);
        if ($openPunch) {
            $open = max(0, Carbon::parse($openPunch->punch_in_at)->diffInSeconds(now()));
        }

        return (int) max(0, max($record->worked_seconds ?? 0, $closed + $open) + (int) ($record->manual_adjustment_seconds ?? 0));
    }

    private function calculateBreakSeconds(AttendanceRecord $record): int
    {
        if (!$record->user_id) {
            return 0;
        }

        // Breaks are stored as is_break TimeEntry rows. Sum their durations
        // for the record's date so the break total is the single source of
        // truth (the work timer is paused during a break, so worked time
        // already excludes it).
        $breakSeconds = (int) TimeEntry::query()
            ->where('user_id', $record->user_id)
            ->where('is_break', true)
            ->whereNotNull('end_time')
            ->whereDate('start_time', $record->attendance_date)
            ->sum('duration');

        return (int) $breakSeconds;
    }

    private function hasOpenPunch(AttendanceRecord $record): bool
    {
        if (!$record->relationLoaded('punches')) {
            $record->load('punches');
        }

        return $record->punches->contains(fn (AttendancePunch $punch) => !$punch->punch_out_at);
    }

    private function runningPrimaryTimersQuery(int $userId): Builder
    {
        return TimeEntry::query()
            ->where('user_id', $userId)
            ->whereNull('end_time')
            ->where(function (Builder $query) {
                $query->where('timer_slot', 'primary')
                    ->orWhereNull('timer_slot');
            });
    }

    private function closeRunningPrimaryTimers(int $userId, Carbon $endedAt): void
    {
        $runningEntries = $this->runningPrimaryTimersQuery($userId)
            ->orderByDesc('start_time')
            ->get();

        foreach ($runningEntries as $runningEntry) {
            $runningEntry->update([
                'end_time' => $endedAt,
                'duration' => $this->calculateEntryDuration($runningEntry, $endedAt),
            ]);
        }
    }

    private function startPrimaryTimer(User $user, Carbon $startedAt, ?string $description = null): void
    {
        // organization_id is set explicitly, matching the AttendancePunch and
        // AttendanceRecord writes a few lines above in checkIn(). It cannot be
        // left to BelongsToOrganization's create-time stamp: checkIn() is also
        // reached from BiometricPunchProcessor::processDay(), driven by the
        // scheduled biometric:process-pending command, with no authenticated
        // user at all — the trait's stamp is a deliberate no-op there, and
        // this row would otherwise be created with organization_id null.
        TimeEntry::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'project_id' => null,
            'task_id' => null,
            'description' => $description,
            'start_time' => $startedAt,
            'timer_slot' => 'primary',
        ]);
    }

    private function calculateEntryDuration(TimeEntry $entry, ?Carbon $endedAt = null): int
    {
        if ($entry->end_time) {
            return (int) max(
                (int) ($entry->duration ?? 0),
                Carbon::parse($entry->start_time)->diffInSeconds(Carbon::parse($entry->end_time))
            );
        }

        $resolvedEnd = $endedAt ?: now();

        return (int) max(
            (int) ($entry->duration ?? 0),
            Carbon::parse($entry->start_time)->diffInSeconds($resolvedEnd)
        );
    }

    /**
     * Single source of truth for monthly attendance → payroll metrics.
     *
     * This is what every payroll path (bulk auto-process, individual
     * processEmployeePayroll, the wizard preview) must read from. It is a
     * pure read against AttendanceRecord/AttendancePunch/LeaveRequest/
     * AttendanceHoliday — never writes to the Tracker or Attendance tables.
     *
     * Per-day classification (config('attendance.shift_seconds') defines the
     * "1.0 day" target, default 8*3600):
     *   - holiday or weekend         -> counted in working_days, NOT in present/absent/LOP
     *   - approved full-day leave    -> counted in working_days + paid_leave, NOT in present/absent
     *   - approved half-day leave    -> 0.5 paid_leave; remaining 0.5 worked if any
     *   - worked >= shift_target     -> 1.0 present
     *   - worked >= half target      -> 0.5 present (half_day); 0.5 LOP
     *   - worked == 0                 -> 1.0 LOP (unless holiday/weekend/approved leave)
     *
     * Returned shape:
     *   [
     *     'month_year'              => 'YYYY-MM',
     *     'days_in_month'           => int,
     *     'working_days'            => float (excludes weekends/holidays),
     *     'holidays'                => int,
     *     'weekend_days'            => int,
     *     'present_days'            => float,
     *     'absent_days'             => float (== lop_days for clean reporting),
     *     'paid_leave_days'         => float,
     *     'lop_days'                => float,
     *     'half_days'               => int,
     *     'late_count'              => int,
     *     'unregularized_absences'  => int (working days with worked=0 and no approved leave),
     *     'overtime_seconds'        => int (worked - target, only on present days),
     *     'total_worked_seconds'    => int,
     *     'attendance_source'       => 'tracker' | 'no_records',
     *   ]
     */
    /**
     * Calculate simplified attendance metrics.
     * This is used by payroll system to calculate present/absent days.
     * 
     * @param User $user
     * @param string $monthYear Format: YYYY-MM
     * @return array Simplified attendance summary with present_days, paid_leave_days, etc.
     */
    public function calculateSimplifiedAttendance(User $user, string $monthYear): array
    {
        [$year, $month] = array_map('intval', explode('-', $monthYear));
        if ($year < 1970 || $month < 1 || $month > 12) {
            throw new \InvalidArgumentException("month_year must be YYYY-MM, got '{$monthYear}'");
        }

        $start = Carbon::create($year, $month, 1)->startOfDay();
        $end = $start->copy()->endOfMonth()->endOfDay();

        // Load holidays
        $country = AttendanceHoliday::countryForSettings(
            is_array($user->organization?->settings) ? $user->organization->settings : []
        );
        $holidayDates = AttendanceHoliday::where('organization_id', $user->organization_id)
            ->where(function ($q) use ($country) {
                $q->where('country', 'ALL');
                if ($country !== 'ALL') {
                    $q->orWhere('country', $country);
                }
            })
            ->whereBetween('holiday_date', [$start->toDateString(), $end->toDateString()])
            ->pluck('holiday_date')
            ->map(fn ($d) => Carbon::parse($d)->toDateString())
            ->flip();

        // Load approved leaves
        $approvedLeaves = LeaveRequest::where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->where(function ($q) use ($start, $end) {
                $q->whereDate('start_date', '<=', $end->toDateString())
                    ->whereDate('end_date', '>=', $start->toDateString());
            })
            ->get();

        // Load attendance records - simplified: just check if check-in exists
        $records = AttendanceRecord::where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->whereBetween('attendance_date', [$start->toDateString(), $end->toDateString()])
            ->with('punches')
            ->get()
            ->keyBy(fn (AttendanceRecord $r) => $r->attendance_date->toDateString());

        // Initialize counters
        $presentDays = 0.0;
        $paidLeaveDays = 0.0;
        $unpaidLeaveDays = 0.0;
        $halfDayPresent = 0.0;
        $halfDayAbsent = 0.0;
        $absentDays = 0.0;
        $totalPayableDays = 0.0;
        $totalLopDays = 0.0;
        $workingDays = 0.0;
        $weekendDays = 0;
        $holidayCount = 0;
        $lateCount = 0;

        foreach (CarbonPeriod::create($start, $end) as $date) {
            $dateStr = $date->toDateString();
            $isWeekend = $date->isWeekend();
            $isHoliday = $holidayDates->has($dateStr);

            if ($isHoliday) {
                $holidayCount++;
            }
            if ($isWeekend) {
                $weekendDays++;
            }
            if ($isWeekend || $isHoliday) {
                continue;
            }

            $workingDays += 1.0;

            $record = $records->get($dateStr);
            $hasCheckIn = $record !== null;
            
            if ($record && (int) ($record->late_minutes ?? 0) > 0) {
                $lateCount++;
            }

            // Get leave units for this date
            $leaveUnits = 0.0;
            foreach ($approvedLeaves as $leave) {
                $units = $leave->unitsForDate($date);
                if ($units > 0 && $units > $leaveUnits) {
                    $leaveUnits = $units;
                }
            }

            // Simplified logic:
            // 1. If check-in exists: present
            // 2. If approved leave exists: paid/unpaid based on leave type
            // 3. Otherwise: absent (LOP)
            
            if ($leaveUnits >= 0.5) {
                // Paid vs unpaid is decided by leave_category (and, on a quota
                // overrun, by consumed_breakdown) — never by leave_type, which
                // only ever holds 'full_day'/'half_day'.
                $leaveForDate = $approvedLeaves->first(fn ($l) => $l->unitsForDate($date) >= $leaveUnits);
                $split = $leaveForDate
                    ? $leaveForDate->paidUnpaidUnitsForDate($date)
                    : ['paid' => 0.0, 'unpaid' => $leaveUnits];

                if ($leaveUnits >= 1.0) {
                    $paidLeaveDays += $split['paid'];
                    $unpaidLeaveDays += $split['unpaid'];
                } else {
                    $halfDayPresent += $split['paid'];
                    $halfDayAbsent += $split['unpaid'];
                }
            } elseif ($hasCheckIn) {
                // Has check-in, no leave
                $presentDays += 1.0;
            } else {
                // No check-in, no leave
                $absentDays += 1.0;
            }
        }

        // Calculate totals
        $totalPayableDays = $presentDays + $paidLeaveDays + $halfDayPresent;
        $totalLopDays = $absentDays + $unpaidLeaveDays + $halfDayAbsent;

        return [
            'month_year' => $monthYear,
            'days_in_month' => (int) $start->daysInMonth,
            'working_days' => round($workingDays, 2),
            'holidays' => $holidayCount,
            'weekend_days' => $weekendDays,
            
            // Simplified metrics (new)
            'present_days' => round($presentDays, 2),
            'paid_leave_days' => round($paidLeaveDays, 2),
            'unpaid_leave_days' => round($unpaidLeaveDays, 2),
            'half_day_present' => round($halfDayPresent, 2),
            'half_day_absent' => round($halfDayAbsent, 2),
            'absent_days' => round($absentDays, 2),
            'total_payable_days' => round($totalPayableDays, 2),
            'total_lop_days' => round($totalLopDays, 2),
            
            // Legacy metrics for backward compatibility
            'legacy_present_days' => round($presentDays + $halfDayPresent, 2),
            'legacy_lop_days' => round($absentDays + $unpaidLeaveDays + $halfDayAbsent, 2),
            
            'late_count' => $lateCount,
            'attendance_source' => $records->isNotEmpty() ? 'tracker' : 'no_records',
            'calculation_mode' => 'simplified',
        ];
    }

    public function monthlyAttendanceSummary(User $user, string $monthYear): array
    {
        // For now, use the simplified calculation
        // This can be switched back to hours-based if needed
        return $this->calculateSimplifiedAttendance($user, $monthYear);
    }
}
