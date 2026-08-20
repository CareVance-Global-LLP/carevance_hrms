<?php

namespace App\Services\Attendance;

use App\Models\Shift;
use App\Models\ShiftAllowancePolicy;
use App\Models\User;
use App\Models\WeeklyOffPolicy;
use Carbon\Carbon;

/**
 * How much night and weekend premium one person earns on one date.
 *
 * THE RULE, IN FULL
 * -----------------
 * A premium is earned by the OVERLAP between the shift the person is actually
 * rostered on and the window the policy calls night — not by the shift being
 * labelled "night", and not by the clock the punch happened to land on. An
 * 18:00→02:00 shift against a 22:00→06:00 window earns four hours of night, and
 * the policy's minimum decides whether four is enough to pay anything. That
 * distinction is the entire reason this is a policy and not a boolean.
 *
 * WHERE THE NUMBERS COME FROM, IN ORDER
 * -------------------------------------
 *   1. The ShiftAllowancePolicy assigned to the employee and in force on the
 *      date (PolicyAssignmentResolver).
 *   2. The workspace default policy.
 *   3. The shift's own columns — has_shift_differential,
 *      differential_percentage/fixed and the three weekend equivalents — which
 *      is what organizations are being paid off TODAY. Nothing in the policy
 *      split is allowed to silently zero a differential already in production,
 *      so the columns stay and stay authoritative when no policy answers.
 *      An assignment's custom_differential_rate still overrides the shift's
 *      percentage here, exactly as it does now.
 *   4. Nothing.
 *
 * WHAT COUNTS AS A WEEKEND
 * ------------------------
 * The employee's weekly-off policy, when they have one. An Indian workplace
 * whose week off is Tuesday pays its weekend premium on Tuesday, and a
 * calendar-shaped answer would be wrong in both directions — paying a normal
 * working Sunday and skipping the actual rest day. With no weekly-off policy
 * configured the fallback is Saturday and Sunday, which is what the shift's
 * weekend differential column has always meant.
 *
 * MONEY
 * -----
 * Decimal strings throughout, rounded once at the boundary, computed with
 * bcmath where the extension is present. A percentage premium with no base
 * amount returns NULL rather than zero: the premium is earned, and only the
 * caller holding the salary structure can say what it bites on.
 */
class ShiftAllowanceEngine
{
    public function __construct(
        private readonly ShiftResolver $shifts,
        private readonly PolicyAssignmentResolver $policies,
    ) {
    }

    /**
     * @param string|int|float|null $baseAmount The amount a percentage premium
     *        is a percentage OF — typically the day's basic pay or the per-shift
     *        wage. Null means "do not quantify percentages".
     */
    public function computeFor(
        ?User $user,
        Carbon|string|null $date = null,
        string|int|float|null $baseAmount = null,
    ): ShiftAllowanceBreakdown {
        $on = self::normalizeDate($date);

        if (! $user || ! $user->organization_id) {
            return ShiftAllowanceBreakdown::nothing($on);
        }

        // No occurrence means no shift ran for this person on this date, so
        // there is no night to be inside of and no weekend shift to uplift.
        // That stays true even with a policy assigned — a policy pays for work
        // done, not for existing.
        $occurrence = $this->shifts->occurrenceFor($user, $on);
        if (! $occurrence) {
            return ShiftAllowanceBreakdown::nothing($on);
        }

        $base = self::toDecimalString($baseAmount);
        $isWeeklyOff = $this->isWeeklyOffOn($user, $on);

        $resolved = $this->policies->shiftAllowanceFor($user, $on);
        $policy = $resolved->policy;

        if ($policy instanceof ShiftAllowancePolicy) {
            return $this->fromPolicy($policy, $resolved->source, $occurrence, $on, $base, $isWeeklyOff);
        }

        return $this->fromShiftColumns($occurrence, $on, $base, $isWeeklyOff);
    }

    /**
     * Is this date a weekly off for this person?
     *
     * Exposed because the weekend premium is not the only thing that needs the
     * answer, and because a caller wanting to know why a premium applied should
     * not have to re-derive it.
     */
    public function isWeeklyOffOn(?User $user, Carbon|string|null $date = null): bool
    {
        $on = self::normalizeDate($date);
        $policy = $this->policies->weeklyOffFor($user, $on)->policy;

        if ($policy instanceof WeeklyOffPolicy) {
            return $policy->isOffOn($on);
        }

        // No weekly-off policy configured: the calendar weekend, which is what
        // shifts.has_weekend_differential has always meant.
        $iso = (int) Carbon::parse($on)->dayOfWeekIso;

        return $iso === 6 || $iso === 7;
    }

    private function fromPolicy(
        ShiftAllowancePolicy $policy,
        string $source,
        ShiftOccurrence $occurrence,
        string $on,
        ?string $base,
        bool $isWeeklyOff,
    ): ShiftAllowanceBreakdown {
        $minutes = $this->nightMinutesFor(
            $occurrence,
            $policy->night_window_start,
            $policy->night_window_end,
        );

        // A minimum of 0 still requires at least one minute inside the window:
        // "any overlap qualifies" is not "no overlap qualifies".
        $required = max(1, (int) $policy->night_minimum_minutes_in_window);
        $nightApplies = $policy->paysNightPremium() && $minutes >= $required;
        $weekendApplies = $policy->paysWeekendPremium() && $isWeeklyOff;

        $nightType = $nightApplies ? (string) $policy->night_allowance_type : ShiftAllowancePolicy::TYPE_NONE;
        $weekendType = $weekendApplies ? (string) $policy->weekend_allowance_type : ShiftAllowancePolicy::TYPE_NONE;

        $nightRate = self::rateFor($nightType, (string) $policy->night_percentage, (string) $policy->night_fixed);
        $weekendRate = self::rateFor($weekendType, (string) $policy->weekend_percentage, (string) $policy->weekend_fixed);

        $nightAmount = self::amountFor($nightType, $nightRate, $base);
        $weekendAmount = self::amountFor($weekendType, $weekendRate, $base);

        return new ShiftAllowanceBreakdown(
            attendanceDate: $on,
            source: $source,
            policyId: (int) $policy->id,
            policyName: (string) $policy->name,
            nightApplies: $nightApplies,
            nightType: $nightType,
            nightRate: $nightRate,
            nightAmount: $nightAmount,
            nightMinutesInWindow: $minutes,
            weekendApplies: $weekendApplies,
            weekendType: $weekendType,
            weekendRate: $weekendRate,
            weekendAmount: $weekendAmount,
            isWeeklyOff: $isWeeklyOff,
            totalAmount: self::sum($nightAmount, $weekendAmount),
        );
    }

    /**
     * The fallback nobody may break: the shift's own differential columns.
     *
     * These are what organizations with no policy are being paid off right now.
     * The night window is the shift's night_shift_start/night_shift_end when
     * both are set; with neither set, the whole shift counts, because a
     * differential recorded against a shift and no window is a differential for
     * working that shift at all.
     */
    private function fromShiftColumns(
        ShiftOccurrence $occurrence,
        string $on,
        ?string $base,
        bool $isWeeklyOff,
    ): ShiftAllowanceBreakdown {
        $shift = $occurrence->shift;

        if (! $shift instanceof Shift) {
            return ShiftAllowanceBreakdown::nothing($on);
        }

        $hasNight = (bool) $shift->has_shift_differential;
        $hasWeekend = (bool) $shift->has_weekend_differential;

        if (! $hasNight && ! $hasWeekend) {
            return ShiftAllowanceBreakdown::nothing($on);
        }

        $minutes = $hasNight
            ? $this->nightMinutesFor($occurrence, $shift->night_shift_start, $shift->night_shift_end)
            : 0;

        // The roster row may override the pattern's rate for one person — an
        // existing column with existing rows, and dropping it here would change
        // what somebody is paid.
        $custom = $occurrence->assignment?->custom_differential_rate;
        $nightPercentage = ($custom !== null && (float) $custom > 0)
            ? (string) $custom
            : (string) $shift->differential_percentage;

        $nightType = self::columnType($hasNight && $minutes > 0, $nightPercentage, (string) $shift->differential_fixed);
        $weekendType = self::columnType(
            $hasWeekend && $isWeeklyOff,
            (string) $shift->weekend_differential_percentage,
            (string) $shift->weekend_differential_fixed,
        );

        $nightRate = self::rateFor($nightType, $nightPercentage, (string) $shift->differential_fixed);
        $weekendRate = self::rateFor(
            $weekendType,
            (string) $shift->weekend_differential_percentage,
            (string) $shift->weekend_differential_fixed,
        );

        $nightAmount = self::amountFor($nightType, $nightRate, $base);
        $weekendAmount = self::amountFor($weekendType, $weekendRate, $base);

        return new ShiftAllowanceBreakdown(
            attendanceDate: $on,
            source: ShiftAllowanceBreakdown::SOURCE_SHIFT,
            nightApplies: $nightType !== ShiftAllowancePolicy::TYPE_NONE,
            nightType: $nightType,
            nightRate: $nightRate,
            nightAmount: $nightAmount,
            nightMinutesInWindow: $minutes,
            weekendApplies: $weekendType !== ShiftAllowancePolicy::TYPE_NONE,
            weekendType: $weekendType,
            weekendRate: $weekendRate,
            weekendAmount: $weekendAmount,
            isWeeklyOff: $isWeeklyOff,
            totalAmount: self::sum($nightAmount, $weekendAmount),
        );
    }

    /**
     * Minutes of the shift that fall inside the night window.
     *
     * The window is a pair of wall-clock times with no date, and it crosses
     * midnight by definition, so it is instantiated on three consecutive
     * calendar days around the attendance date and the overlaps are summed.
     * Anchoring it to a single day would drop the half of a night shift that
     * lands on the far side of midnight — the exact bug this domain keeps
     * producing.
     *
     * With no window configured the whole shift counts: a policy that pays a
     * night premium without saying what night is means the shift itself is the
     * night.
     */
    private function nightMinutesFor(ShiftOccurrence $occurrence, ?string $windowStart, ?string $windowEnd): int
    {
        $shiftStart = $occurrence->shiftStartAt;
        $shiftEnd = $occurrence->shiftEndAt;

        // No end means only a start time was ever configured. There is no
        // measurable overlap, and inventing a length here is how the eight-hour
        // assumption spread in the first place.
        if (! $shiftEnd) {
            return 0;
        }

        $start = Shift::normalizeTime($windowStart);
        $end = Shift::normalizeTime($windowEnd);

        if ($start === null || $end === null) {
            return (int) $shiftStart->diffInMinutes($shiftEnd);
        }

        $spanMinutes = self::windowSpanMinutes($start, $end);
        if ($spanMinutes <= 0) {
            return 0;
        }

        $minutes = 0;

        foreach ([-1, 0, 1] as $offset) {
            $day = $occurrence->attendanceDate->copy()->addDays($offset);
            $windowOpens = self::wallClockOn($day, $start, $occurrence->timezone);
            $windowCloses = $windowOpens->copy()->addMinutes($spanMinutes);

            $overlapStart = $shiftStart->greaterThan($windowOpens) ? $shiftStart : $windowOpens;
            $overlapEnd = $shiftEnd->lessThan($windowCloses) ? $shiftEnd : $windowCloses;

            if ($overlapEnd->greaterThan($overlapStart)) {
                $minutes += (int) $overlapStart->diffInMinutes($overlapEnd);
            }
        }

        return $minutes;
    }

    private static function windowSpanMinutes(string $start, string $end): int
    {
        $reference = Carbon::create(2000, 1, 3, 0, 0, 0); // a Monday, and irrelevant
        $opens = self::wallClockOn($reference, $start, $reference->timezoneName);
        $closes = self::wallClockOn($reference, $end, $reference->timezoneName);

        if ($closes->lessThanOrEqualTo($opens)) {
            $closes->addDay();
        }

        return (int) $opens->diffInMinutes($closes);
    }

    /**
     * A wall-clock time on a date, in a named timezone.
     *
     * Carbon::create rather than midnight-plus-N-hours: on a DST transition day
     * local midnight plus twenty-two hours is not 22:00, and an hour lost there
     * is an hour of night premium lost.
     */
    private static function wallClockOn(Carbon $date, string $time, string $timezone): Carbon
    {
        $parts = array_map('intval', explode(':', $time));

        $created = Carbon::create(
            $date->year,
            $date->month,
            $date->day,
            $parts[0] ?? 0,
            $parts[1] ?? 0,
            $parts[2] ?? 0,
            $timezone,
        );

        return $created instanceof Carbon ? $created : $date->copy()->startOfDay();
    }

    /** Which of the two shift columns a differential is expressed in. */
    private static function columnType(bool $applies, string $percentage, string $fixed): string
    {
        if (! $applies) {
            return ShiftAllowancePolicy::TYPE_NONE;
        }

        if ((float) $percentage > 0) {
            return ShiftAllowancePolicy::TYPE_PERCENTAGE;
        }

        return (float) $fixed > 0 ? ShiftAllowancePolicy::TYPE_FIXED : ShiftAllowancePolicy::TYPE_NONE;
    }

    private static function rateFor(string $type, string $percentage, string $fixed): string
    {
        return match ($type) {
            ShiftAllowancePolicy::TYPE_PERCENTAGE => self::round2($percentage),
            ShiftAllowancePolicy::TYPE_FIXED => self::round2($fixed),
            default => '0.00',
        };
    }

    /**
     * Null, not zero, for an unquantifiable percentage — see the breakdown's
     * docblock.
     */
    private static function amountFor(string $type, string $rate, ?string $base): ?string
    {
        return match ($type) {
            ShiftAllowancePolicy::TYPE_FIXED => $rate,
            ShiftAllowancePolicy::TYPE_PERCENTAGE => $base === null ? null : self::percentageOf($base, $rate),
            default => '0.00',
        };
    }

    private static function sum(?string $first, ?string $second): ?string
    {
        if ($first === null || $second === null) {
            return null;
        }

        return function_exists('bcadd')
            ? bcadd($first, $second, 2)
            : self::round2((string) ((float) $first + (float) $second));
    }

    private static function percentageOf(string $base, string $percent): string
    {
        if (function_exists('bcmul') && function_exists('bcdiv')) {
            return self::round2(bcdiv(bcmul($base, $percent, 8), '100', 8));
        }

        return self::round2((string) ((float) $base * (float) $percent / 100));
    }

    /**
     * Two decimal places, half up, rounded exactly once — at this boundary.
     *
     * bcadd truncates at its scale, so adding 0.005 first is a half-up round
     * that never sees a float.
     */
    private static function round2(string $value): string
    {
        $value = trim($value);

        if ($value === '' || ! is_numeric($value)) {
            return '0.00';
        }

        if (function_exists('bcadd')) {
            $negative = str_starts_with($value, '-');
            $magnitude = bcadd(ltrim($value, '+-'), '0.005', 2);

            return ($negative && bccomp($magnitude, '0', 2) !== 0) ? '-'.$magnitude : $magnitude;
        }

        return number_format(round((float) $value, 2), 2, '.', '');
    }

    /**
     * Whatever the caller handed in, as a decimal string — the one place a
     * float is allowed anywhere near this, and only to leave immediately.
     */
    private static function toDecimalString(string|int|float|null $value): ?string
    {
        if ($value === null) {
            return null;
        }

        if (is_string($value)) {
            $trimmed = trim($value);

            return ($trimmed !== '' && is_numeric($trimmed)) ? $trimmed : null;
        }

        return number_format((float) $value, 6, '.', '');
    }

    private static function normalizeDate(Carbon|string|null $date): string
    {
        if ($date instanceof Carbon) {
            return $date->toDateString();
        }

        if (is_string($date) && trim($date) !== '') {
            return Carbon::parse($date)->toDateString();
        }

        return Carbon::now()->toDateString();
    }
}
