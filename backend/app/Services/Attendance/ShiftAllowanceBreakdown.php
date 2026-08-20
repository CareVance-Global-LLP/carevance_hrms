<?php

namespace App\Services\Attendance;

/**
 * What one person earns in premiums for one date, and why.
 *
 * Every money field is a decimal STRING with two places, never a float. A
 * differential is a per-shift amount that a payroll run adds up across a month
 * and then across an organization; a float that is a paisa out per shift is a
 * reconciliation nobody can close.
 *
 * The amounts are nullable, and the null is load-bearing: a percentage premium
 * with no base amount supplied is *earned* but not *quantified*. Reporting zero
 * there would say the employee is owed nothing, which is a different and wrong
 * statement. Null says "you did not tell me what this bites on" — and only the
 * caller, holding the salary structure, is entitled to answer that.
 *
 * nightMinutesInWindow is reported even when the premium does not apply. "Four
 * hours of night, below the policy's five-hour minimum" and "no night at all"
 * are different facts, and a payroll query that cannot tell them apart cannot
 * explain a payslip to the person holding it.
 */
final class ShiftAllowanceBreakdown
{
    public const SOURCE_ASSIGNMENT = 'assignment';
    public const SOURCE_DEFAULT = 'default';
    public const SOURCE_SHIFT = 'shift';
    public const SOURCE_NONE = 'none';

    public function __construct(
        public readonly string $attendanceDate,
        public readonly string $source,
        public readonly ?int $policyId = null,
        public readonly ?string $policyName = null,
        public readonly bool $nightApplies = false,
        public readonly string $nightType = 'none',
        public readonly string $nightRate = '0.00',
        public readonly ?string $nightAmount = '0.00',
        public readonly int $nightMinutesInWindow = 0,
        public readonly bool $weekendApplies = false,
        public readonly string $weekendType = 'none',
        public readonly string $weekendRate = '0.00',
        public readonly ?string $weekendAmount = '0.00',
        public readonly bool $isWeeklyOff = false,
        public readonly ?string $totalAmount = '0.00',
    ) {
    }

    public static function nothing(string $attendanceDate, string $source = self::SOURCE_NONE): self
    {
        return new self(attendanceDate: $attendanceDate, source: $source);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'attendance_date' => $this->attendanceDate,
            'source' => $this->source,
            'policy_id' => $this->policyId,
            'policy_name' => $this->policyName,
            'night' => [
                'applies' => $this->nightApplies,
                'type' => $this->nightType,
                'rate' => $this->nightRate,
                'amount' => $this->nightAmount,
                'minutes_in_window' => $this->nightMinutesInWindow,
            ],
            'weekend' => [
                'applies' => $this->weekendApplies,
                'type' => $this->weekendType,
                'rate' => $this->weekendRate,
                'amount' => $this->weekendAmount,
                'is_weekly_off' => $this->isWeeklyOff,
            ],
            'total_amount' => $this->totalAmount,
        ];
    }
}
