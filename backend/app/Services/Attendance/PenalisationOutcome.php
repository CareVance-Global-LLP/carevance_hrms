<?php

namespace App\Services\Attendance;

use Carbon\Carbon;

/**
 * What one day cost, and — the whole point — WHY.
 *
 * An attendance penalty is the single most disputed number an HR system
 * produces. "Half day" on its own is unusable in that conversation: the person
 * wants to know which rule fired, what it measured, and what the bar was. So
 * this object carries the full working, not a verdict:
 *
 *   Worked 3h 12m of an 8h 00m shift (40.00%), below the 50.00% rung —
 *   0.50 day deducted as loss of pay.
 *
 * Every field is one of those three kinds:
 *
 *   INPUT      what was measured — arrivedAt, workedSeconds, requiredSeconds
 *   RULE       what the bar was  — gracePeriodMinutes, halfDayRungPercent
 *   OUTCOME    what it cost      — leavesDeducted, lopDays, status
 *
 * Nothing here is a float. Leaves are a quantity of days, not money, but they
 * reach payroll through the LOP path and a day accumulated as a float across a
 * month drifts, so they are decimal strings built from integer arithmetic and
 * rounded exactly once, here at the boundary.
 *
 * Statuses are the MOST SEVERE finding, and the flags stay readable underneath:
 * a day can be both late and short, and `status` reporting `half_day` does not
 * erase `isLate`.
 */
final class PenalisationOutcome
{
    /** Nothing could be judged — no shift ran on this date. */
    public const STATUS_NOT_EVALUATED = 'not_evaluated';
    /** Evaluated, nothing to answer for. */
    public const STATUS_CLEAR = 'clear';
    /** Late past grace, but the day itself is whole. */
    public const STATUS_LATE = 'late';
    /** The half-day ladder took part of a day. */
    public const STATUS_HALF_DAY = 'half_day';
    /** The ladder took a whole day. */
    public const STATUS_FULL_DAY = 'full_day';
    /** Below the no-show bar: the day is treated as not having happened. */
    public const STATUS_NO_SHOW = 'no_show';

    /** Where the rules came from. */
    public const SOURCE_ASSIGNMENT = 'assignment';
    public const SOURCE_ORGANIZATION_DEFAULT = 'organization_default';
    public const SOURCE_SHIFT_COLUMNS = 'shift_columns';
    public const SOURCE_NONE = 'none';

    /** Where a deduction is taken from. */
    public const DEDUCT_FROM_LOP = 'lop';
    public const DEDUCT_FROM_LEAVE_BALANCE = 'leave_balance';
    public const DEDUCT_FROM_NOTHING = 'none';

    /** Why a late arrival did not become a penalty. */
    public const WAIVED_HOURS_MET = 'hours_met';
    public const WAIVED_CYCLE_EXEMPTION = 'cycle_exemption';

    /**
     * @param list<array{code: string, message: string}> $reasons
     */
    public function __construct(
        public readonly Carbon $attendanceDate,
        public readonly string $timezone,
        public readonly string $status,

        // ---- which rules applied -------------------------------------
        public readonly string $policySource,
        public readonly ?int $policyId,
        public readonly ?string $policyName,
        public readonly string $hoursBasis,

        // ---- late ----------------------------------------------------
        public readonly int $gracePeriodMinutes,
        /** policy | shift | none */
        public readonly string $graceSource,
        public readonly ?Carbon $shiftStartAt,
        public readonly ?Carbon $arrivedAt,
        public readonly int $lateSeconds,
        public readonly bool $isLate,
        public readonly ?string $lateWaivedBy,
        public readonly bool $latePenaltyApplies,
        public readonly ?string $lateRuleType,
        /** Decimal string: incidents when the rule is incident-based, hours when hours-based. */
        public readonly ?string $lateThreshold,

        // ---- the cycle the late rule counts in ------------------------
        public readonly ?string $cycle,
        public readonly ?string $cycleStart,
        public readonly ?string $cycleEnd,
        public readonly int $exemptionsPerCycle,
        public readonly int $exemptionsUsedInCycle,
        public readonly int $countableLateIncidentsInCycle,
        public readonly int $countableLateSecondsInCycle,

        // ---- hours ----------------------------------------------------
        public readonly int $workedSeconds,
        /** gross_span | effective_clock — which reading workedSeconds came from. */
        public readonly string $workedSecondsSource,
        public readonly ?int $requiredSeconds,
        /** Decimal string, two places, or null when there is no denominator. */
        public readonly ?string $percentOfShiftWorked,
        public readonly bool $hoursMet,

        // ---- no show ---------------------------------------------------
        public readonly bool $isNoShow,
        public readonly ?string $noShowBelowHours,

        // ---- the ladder ------------------------------------------------
        public readonly ?int $halfDayRuleId,
        public readonly ?string $halfDayRungPercent,

        // ---- what it cost ----------------------------------------------
        public readonly string $leavesDeducted,
        public readonly bool $isLop,
        public readonly string $lopDays,
        public readonly string $deductionSource,

        public readonly array $reasons = [],
    ) {
    }

    public function attendanceDateString(): string
    {
        return $this->attendanceDate->toDateString();
    }

    /** Did this day cost anything at all? */
    public function isPenalised(): bool
    {
        return $this->latePenaltyApplies || $this->leavesDeducted !== '0.00';
    }

    /**
     * The sentence a manager can put in front of the person it happened to.
     *
     * Built from the reasons rather than re-deriving anything, so the prose and
     * the fields can never disagree.
     */
    public function explain(): string
    {
        if ($this->reasons === []) {
            return 'Nothing to report for '.$this->attendanceDateString().'.';
        }

        return implode(' ', array_map(
            static fn (array $reason): string => $reason['message'],
            $this->reasons,
        ));
    }

    /** "3h 12m", the way an attendance screen writes it. */
    public static function humanSeconds(?int $seconds): string
    {
        if ($seconds === null) {
            return 'unknown';
        }

        $seconds = max(0, $seconds);

        return sprintf('%dh %02dm', intdiv($seconds, 3600), intdiv($seconds % 3600, 60));
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'attendance_date' => $this->attendanceDateString(),
            'timezone' => $this->timezone,
            'status' => $this->status,
            'policy' => [
                'source' => $this->policySource,
                'id' => $this->policyId,
                'name' => $this->policyName,
                'hours_basis' => $this->hoursBasis,
            ],
            'late' => [
                'grace_period_minutes' => $this->gracePeriodMinutes,
                'grace_source' => $this->graceSource,
                'shift_start_at' => $this->shiftStartAt?->toIso8601String(),
                'arrived_at' => $this->arrivedAt?->toIso8601String(),
                'late_seconds' => $this->lateSeconds,
                'is_late' => $this->isLate,
                'waived_by' => $this->lateWaivedBy,
                'penalty_applies' => $this->latePenaltyApplies,
                'rule_type' => $this->lateRuleType,
                'threshold' => $this->lateThreshold,
            ],
            'cycle' => [
                'name' => $this->cycle,
                'start' => $this->cycleStart,
                'end' => $this->cycleEnd,
                'exemptions_per_cycle' => $this->exemptionsPerCycle,
                'exemptions_used' => $this->exemptionsUsedInCycle,
                'countable_incidents' => $this->countableLateIncidentsInCycle,
                'countable_late_seconds' => $this->countableLateSecondsInCycle,
            ],
            'hours' => [
                'worked_seconds' => $this->workedSeconds,
                'worked_seconds_source' => $this->workedSecondsSource,
                'required_seconds' => $this->requiredSeconds,
                'percent_of_shift' => $this->percentOfShiftWorked,
                'hours_met' => $this->hoursMet,
            ],
            'no_show' => [
                'is_no_show' => $this->isNoShow,
                'below_hours' => $this->noShowBelowHours,
            ],
            'half_day' => [
                'rule_id' => $this->halfDayRuleId,
                'rung_percent' => $this->halfDayRungPercent,
            ],
            'cost' => [
                'leaves_deducted' => $this->leavesDeducted,
                'is_lop' => $this->isLop,
                'lop_days' => $this->lopDays,
                'deduction_source' => $this->deductionSource,
            ],
            'reasons' => $this->reasons,
            'explanation' => $this->explain(),
        ];
    }
}
