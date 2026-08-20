<?php

namespace App\Services\Attendance;

use App\Models\AttendanceHoliday;
use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
use App\Models\LeaveRequest;
use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonPeriod;

/**
 * One month of days, each one carrying WHAT KIND OF DAY it was and WHAT IT
 * COST — the two facts the attendance calendar could not previously tell apart.
 *
 * Before this, `attendance/calendar` rendered `status: 'none'` for a weekly off
 * and `status: 'none'` for an unexplained absence, and the screen drew the same
 * grey cell for both. It also had no way to say why a day was short: the
 * penalisation engine already produced "worked 3h 12m of an 8h 00m shift
 * (40.00%), below the 50.00% rung", and nothing carried that sentence to a
 * screen. A penalty an employee cannot see the working of is a penalty they
 * cannot dispute, and attendance penalties are disputed constantly.
 *
 * This is a SEPARATE endpoint rather than more keys on the calendar payload,
 * deliberately. The penalisation engine walks a whole exemption cycle per day
 * to decide whether a late arrival counts, so a month of outcomes is an order
 * of magnitude more work than the calendar it decorates. Keeping it apart lets
 * the calendar paint immediately and the outcomes arrive after, and means the
 * roster — which loads the same calendar for every employee in the org — pays
 * none of that cost.
 *
 * Three decisions live here rather than in the engines:
 *
 *   FUTURE DAYS ARE NOT JUDGED. A day that has not finished has not been
 *   missed. The month is still returned whole, so the calendar can draw it.
 *
 *   APPROVED LEAVE SUPPRESSES PENALISATION. The penalisation engine knows about
 *   shifts and clocks, not leave, so a fully approved leave day reaches it as
 *   zero hours worked and comes back a no-show. That is the engine being asked
 *   the wrong question, not the engine being wrong, so the question is not
 *   asked — and the day says so in as many words rather than going quiet.
 *
 *   THE APPROVAL THE OVERTIME ENGINE ASKS ABOUT IS THE TIME-EDIT REQUEST. That
 *   is the only approval trail attendance has: an approved
 *   `attendance_time_edit_requests` row for the date is the manager saying yes
 *   to the extra time. Absent one, a policy that requires approval reports the
 *   minutes as PENDING — never zero, and never folded into the counted total.
 *
 * Tenancy is pinned explicitly with forOrganization() rather than left to the
 * global scope. The scope resolves the organization through the authenticated
 * user and is a deliberate no-op without one, so a console command or a queued
 * job calling this would otherwise read every tenant's attendance.
 */
class DayOutcomeService
{
    /** The viewer may not see this employee. */
    public const STATUS_FORBIDDEN = 403;

    public function __construct(
        private readonly PenalisationEngine $penalisation,
        private readonly OvertimeEngine $overtime,
        private readonly WeeklyOffResolver $weeklyOffs,
        private readonly ShiftResolver $shifts,
        private readonly UserTimezoneResolver $timezones,
    ) {
    }

    /**
     * @return array{status: int, payload: array<string, mixed>}
     */
    public function forMonth(?User $viewer, ?int $targetUserId, ?string $month = null): array
    {
        if (! $viewer || ! $viewer->organization_id) {
            return ['status' => self::STATUS_FORBIDDEN, 'payload' => ['message' => 'Forbidden']];
        }

        $target = $this->resolveTarget($viewer, $targetUserId);

        if (! $target) {
            return ['status' => self::STATUS_FORBIDDEN, 'payload' => ['message' => 'Forbidden']];
        }

        $monthStart = $this->monthStart($month);
        $monthEnd = $monthStart->copy()->endOfMonth();
        $timezone = $this->timezones->forUser($target);
        $today = Carbon::now($timezone)->toDateString();

        $records = $this->recordsByDate($target, $monthStart, $monthEnd);
        $leaveUnits = $this->leaveUnitsByDate($target, $monthStart, $monthEnd);
        $holidays = $this->holidaysByDate($target, $monthStart, $monthEnd);
        $approvedExtras = $this->approvedExtraDates($target, $monthStart, $monthEnd);

        $days = [];

        foreach (CarbonPeriod::create($monthStart, $monthEnd) as $date) {
            $days[] = $this->dayFor(
                $target,
                $date->toDateString(),
                $timezone,
                $today,
                $records[$date->toDateString()] ?? null,
                (float) ($leaveUnits[$date->toDateString()] ?? 0),
                $holidays[$date->toDateString()] ?? null,
                isset($approvedExtras[$date->toDateString()]),
            );
        }

        return [
            'status' => 200,
            'payload' => [
                'month' => $monthStart->format('Y-m'),
                'user_id' => (int) $target->id,
                'timezone' => $timezone,
                'days' => $days,
            ],
        ];
    }

    /**
     * What this one day was, and what it cost.
     *
     * `kind` answers what kind of day it was — the calendar's question — and
     * `penalisation.status` answers what it cost, which is payroll's. They are
     * separate keys because they are separate facts: a day can be a working day
     * that cost half a day, and a weekly off costs nothing while still being a
     * day somebody worked overtime on.
     *
     * @param array<string, mixed>|null $holiday
     * @return array<string, mixed>
     */
    private function dayFor(
        User $target,
        string $date,
        string $timezone,
        string $today,
        ?AttendanceRecord $record,
        float $leaveUnits,
        ?array $holiday,
        bool $extraApproved,
    ): array {
        $isEvaluated = $date <= $today;
        $isHoliday = $holiday !== null;
        $isWeeklyOff = $this->weeklyOffs->isWeeklyOff($target, $date);
        $isLeave = $leaveUnits > 0;
        $isFullLeave = $leaveUnits >= 1;
        $hasShift = $this->shifts->occurrenceFor($target, $date) !== null;

        // A public holiday outranks a weekly off, which outranks leave — the
        // same order OvertimeEngine::scopeFor uses, so the two never disagree
        // about what kind of day this was.
        $kind = match (true) {
            $isHoliday => 'holiday',
            $isWeeklyOff => 'weekly_off',
            $isLeave => 'leave',
            $hasShift => 'working',
            default => 'not_rostered',
        };

        $checkedIn = (bool) $record?->check_in_at;

        // An absence is a day somebody was expected and did not come. A weekly
        // off, a holiday, a leave day, a day nothing is rostered on and a day
        // that has not happened yet are each a different thing, and drawing any
        // of them as an absence is the bug this key exists to close.
        $isAbsence = $kind === 'working' && $isEvaluated && ! $checkedIn;

        [$grossMinutes, $effectiveMinutes] = $this->clocksFor($record);

        return [
            'date' => $date,
            'kind' => $kind,
            'is_evaluated' => $isEvaluated,
            'is_weekly_off' => $isWeeklyOff,
            'weekly_off_source' => $isWeeklyOff ? $this->weeklyOffs->sourceFor($target, $date) : null,
            'is_holiday' => $isHoliday,
            'holiday_title' => $holiday['title'] ?? null,
            'is_leave' => $isLeave,
            'leave_units' => round($leaveUnits, 2),
            'is_absence' => $isAbsence,
            'has_record' => $record !== null,
            'checked_in_at' => $record?->check_in_at?->toIso8601String(),
            'checked_out_at' => $record?->check_out_at?->toIso8601String(),
            'worked_seconds' => $effectiveMinutes * 60,
            'penalisation' => $this->penalisationFor(
                $target,
                $date,
                $timezone,
                $isEvaluated,
                $isFullLeave,
                $isHoliday,
                $isWeeklyOff,
            ),
            'overtime' => $this->overtime->evaluate(
                $isEvaluated ? $target : null,
                $date,
                grossMinutes: $isEvaluated ? $grossMinutes : 0,
                effectiveMinutes: $isEvaluated ? $effectiveMinutes : null,
                approved: $extraApproved,
            )->toArray(),
        ];
    }

    /**
     * The penalisation block, or an honest refusal to produce one.
     *
     * The skeleton for a day that is not judged comes from the engine itself —
     * evaluating a null employee is its own "nothing can be judged" path and
     * costs no queries — so the shape can never drift from the real thing. Only
     * the reason is replaced, because the reason is the entire point: "no
     * employee in scope" would be a lie on a leave day.
     *
     * @return array<string, mixed>
     */
    private function penalisationFor(
        User $target,
        string $date,
        string $timezone,
        bool $isEvaluated,
        bool $isFullLeave,
        bool $isHoliday,
        bool $isWeeklyOff,
    ): array {
        if (! $isEvaluated) {
            return $this->notJudged($date, $timezone, 'not_yet', 'This day has not finished, so nothing is judged on it yet.');
        }

        if ($isFullLeave) {
            return $this->notJudged(
                $date,
                $timezone,
                'on_approved_leave',
                'On approved leave for the whole day, so no attendance penalty applies.',
            );
        }

        if ($isHoliday) {
            return $this->notJudged(
                $date,
                $timezone,
                'public_holiday',
                'A public holiday — no shift was owed, so no attendance penalty applies.',
            );
        }

        /*
         * A weekly off is the same case as a public holiday and was missed.
         *
         * The day was already labelled `weekly_off` above and then handed to the
         * penalisation engine anyway, which saw zero worked seconds against a
         * rostered shift and called it a no-show. A browser run on 20 Aug 2026
         * drew "Weekly off" and "LOP 1.00 day" on the same calendar cell and
         * charged 18 loss-of-pay days across 20 elapsed days. Nobody was rostered
         * on those days, so there was no shortfall to penalise.
         */
        if ($isWeeklyOff) {
            return $this->notJudged(
                $date,
                $timezone,
                'weekly_off',
                'A weekly off — no shift was owed, so no attendance penalty applies.',
            );
        }

        return $this->penalisation->evaluate($target, $date)->toArray();
    }

    /**
     * @return array<string, mixed>
     */
    private function notJudged(string $date, string $timezone, string $code, string $message): array
    {
        $skeleton = $this->penalisation->evaluate(null, $date)->toArray();

        $skeleton['timezone'] = $timezone;
        $skeleton['reasons'] = [['code' => $code, 'message' => $message]];
        $skeleton['explanation'] = $message;

        return $skeleton;
    }

    /**
     * The two clocks for a day, in minutes.
     *
     * Effective is what the timers measured, breaks already out. Gross is the
     * span from first punch to last, and only exists once the day is closed —
     * an open day falls back to effective rather than manufacturing a span
     * against `now`, which would grow every time the page was refreshed.
     *
     * @return array{0: int, 1: int}
     */
    private function clocksFor(?AttendanceRecord $record): array
    {
        if (! $record) {
            return [0, 0];
        }

        $effectiveSeconds = max(0, (int) ($record->worked_seconds ?? 0) + (int) ($record->manual_adjustment_seconds ?? 0));
        $grossSeconds = ($record->check_in_at && $record->check_out_at)
            ? max(0, (int) $record->check_in_at->diffInSeconds($record->check_out_at, false))
            : $effectiveSeconds;

        return [intdiv($grossSeconds, 60), intdiv($effectiveSeconds, 60)];
    }

    /**
     * Own always; anybody else only for someone who manages, and only inside
     * their own organization. Another tenant's employee is refused rather than
     * reported as missing, because the difference between "no such person" and
     * "not yours" is itself a leak.
     */
    private function resolveTarget(User $viewer, ?int $targetUserId): ?User
    {
        if (! $targetUserId || $targetUserId === (int) $viewer->id) {
            return $viewer;
        }

        if ($viewer->getHierarchyLevel() >= 100) {
            return null;
        }

        // User is one of the four models deliberately outside
        // BelongsToOrganization — its scope would have to resolve the acting
        // user through Auth to filter itself — so the tenant clause here is
        // hand-written because there is no global scope to inherit.
        return User::query()
            ->where('organization_id', (int) $viewer->organization_id)
            ->whereKey($targetUserId)
            ->first();
    }

    private function monthStart(?string $month): Carbon
    {
        $candidate = trim((string) ($month ?: ''));

        if ($candidate === '' || ! preg_match('/^\d{4}-\d{2}$/', $candidate)) {
            return Carbon::now()->startOfMonth();
        }

        return Carbon::createFromFormat('Y-m', $candidate)->startOfMonth();
    }

    /** @return array<string, AttendanceRecord> */
    private function recordsByDate(User $target, Carbon $from, Carbon $to): array
    {
        return AttendanceRecord::forOrganization((int) $target->organization_id)
            ->where('user_id', $target->id)
            ->whereDate('attendance_date', '>=', $from->toDateString())
            ->whereDate('attendance_date', '<=', $to->toDateString())
            ->get()
            ->keyBy(fn (AttendanceRecord $record) => Carbon::parse($record->attendance_date)->toDateString())
            ->all();
    }

    /** @return array<string, float> */
    private function leaveUnitsByDate(User $target, Carbon $from, Carbon $to): array
    {
        $units = [];

        $leaves = LeaveRequest::forOrganization((int) $target->organization_id)
            ->where('user_id', $target->id)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $to->toDateString())
            ->whereDate('end_date', '>=', $from->toDateString())
            ->get();

        foreach ($leaves as $leave) {
            foreach ($leave->effectiveDateEntriesInRange($from, $to) as $entry) {
                $date = (string) ($entry['date'] ?? '');
                if ($date === '') {
                    continue;
                }

                $units[$date] = ($units[$date] ?? 0) + (float) ($entry['units'] ?? 0);
            }
        }

        return $units;
    }

    /** @return array<string, array<string, mixed>> */
    private function holidaysByDate(User $target, Carbon $from, Carbon $to): array
    {
        $country = AttendanceHoliday::countryForSettings($target->settings);

        return AttendanceHoliday::forOrganization((int) $target->organization_id)
            ->whereBetween('holiday_date', [$from->toDateString(), $to->toDateString()])
            ->whereIn('country', ['ALL', $country])
            ->get()
            // A country-specific entry outranks the ALL entry on the same date.
            ->sortBy(fn (AttendanceHoliday $holiday) => $holiday->country === $country ? 0 : 1)
            ->groupBy(fn (AttendanceHoliday $holiday) => Carbon::parse($holiday->holiday_date)->toDateString())
            ->map(fn ($group) => ['title' => (string) $group->first()->title])
            ->all();
    }

    /**
     * Dates whose extra time a reviewer has actually approved.
     *
     * @return array<string, true>
     */
    private function approvedExtraDates(User $target, Carbon $from, Carbon $to): array
    {
        return AttendanceTimeEditRequest::forOrganization((int) $target->organization_id)
            ->where('user_id', $target->id)
            ->where('status', 'approved')
            ->whereDate('attendance_date', '>=', $from->toDateString())
            ->whereDate('attendance_date', '<=', $to->toDateString())
            ->get()
            ->mapWithKeys(fn (AttendanceTimeEditRequest $request) => [
                Carbon::parse($request->attendance_date)->toDateString() => true,
            ])
            ->all();
    }
}
