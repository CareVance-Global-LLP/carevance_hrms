<?php

namespace App\Services\Attendance;

use App\Models\EmployeeShift;
use App\Models\Shift;
use Carbon\Carbon;

/**
 * One OCCURRENCE of a shift: the pattern, the calendar date it is being run on,
 * and both ends as real datetimes in the employee's own wall clock.
 *
 * This is the shape Keka stores — an explicit attendanceDate alongside
 * shiftStartTime and shiftEndTime as full DATE-TIMES — and it exists because
 * the two are genuinely different facts for a night shift. A 22:00→06:00 shift
 * on the 19th has attendanceDate 2026-08-19 and an end at 06:00 on the 20th.
 * Work attaches to the occurrence; it is never bucketed by the punch's own
 * calendar date, which is what puts half a night's hours on the wrong day.
 *
 * Distinct from ResolvedShift, which answers "which pattern and how long" and
 * builds its instants in whatever zone the caller handed it. An occurrence is
 * always anchored in the employee's resolved timezone, and carries that zone so
 * a caller can see which clock it is reading.
 *
 * shiftEndAt is nullable: when all that is configured is an expected start time
 * there is no honest end, and null says so rather than inventing one.
 */
final class ShiftOccurrence
{
    public function __construct(
        /** Local midnight of the attendance date, in $timezone. */
        public readonly Carbon $attendanceDate,
        public readonly string $timezone,
        public readonly string $source,
        public readonly Carbon $shiftStartAt,
        public readonly ?Carbon $shiftEndAt = null,
        public readonly ?int $expectedSeconds = null,
        public readonly ?Shift $shift = null,
        public readonly ?EmployeeShift $assignment = null,
        /**
         * The date is one of this person's weekly offs.
         *
         * The occurrence still exists — the pattern says when the shift would
         * run, and people do work on their days off — but expectedSeconds is
         * zero. Deleting the occurrence instead would send an after-midnight
         * punch from a night shift that began on the weekly off to the wrong
         * attendance date, and would erase the fact that makes the work
         * weekly-off overtime rather than an ordinary day.
         */
        public readonly bool $isWeeklyOff = false,
    ) {
    }

    public function attendanceDateString(): string
    {
        return $this->attendanceDate->toDateString();
    }

    /**
     * Does this occurrence end on a later calendar date than it started?
     *
     * Compared in the occurrence's own timezone — the same clock the employee
     * reads. Comparing UTC dates here would call an 09:00–18:00 IST day shift a
     * midnight-crosser as soon as the server was in UTC.
     */
    public function crossesMidnight(): bool
    {
        if (! $this->shiftEndAt) {
            return false;
        }

        return $this->shiftEndAt->copy()->setTimezone($this->timezone)->toDateString()
            !== $this->attendanceDateString();
    }

    /**
     * Is this instant inside the scheduled window, inclusive at both ends?
     *
     * $toleranceMinutes extends the tail only. Overrun is the normal case — the
     * handover runs long and the punch-out lands at 06:12 for a shift scheduled
     * to end at 06:00 — and without a tail those minutes book to the next day,
     * splitting one night across two attendance dates.
     */
    public function covers(Carbon $instant, int $toleranceMinutes = 0): bool
    {
        if ($instant->lessThan($this->shiftStartAt)) {
            return false;
        }

        if (! $this->shiftEndAt) {
            return false;
        }

        $end = $toleranceMinutes > 0
            ? $this->shiftEndAt->copy()->addMinutes($toleranceMinutes)
            : $this->shiftEndAt;

        return $instant->lessThanOrEqualTo($end);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'attendance_date' => $this->attendanceDateString(),
            'timezone' => $this->timezone,
            'source' => $this->source,
            'shift_id' => $this->shift?->id,
            'shift_name' => $this->shift?->name,
            'shift_code' => $this->shift?->code,
            'shift_start_at' => $this->shiftStartAt->toIso8601String(),
            'shift_end_at' => $this->shiftEndAt?->toIso8601String(),
            'crosses_midnight' => $this->crossesMidnight(),
            'expected_seconds' => $this->expectedSeconds,
            'is_weekly_off' => $this->isWeeklyOff,
        ];
    }
}
