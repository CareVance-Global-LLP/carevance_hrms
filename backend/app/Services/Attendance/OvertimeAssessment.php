<?php

namespace App\Services\Attendance;

use App\Models\OvertimePolicyScope;
use Carbon\Carbon;

/**
 * One day's overtime, with every number that produced it still visible.
 *
 * The chain is raw -> qualifying -> rounded -> counted, and each link is kept
 * rather than collapsed because they answer different questions and a dispute
 * is always about one of them:
 *
 *   rawMinutes        what the clock actually showed over the shift.
 *   qualifyingMinutes what survived minimum_minutes_before_accrual. Zero here
 *                     with a non-zero raw is "you worked it, it did not accrue"
 *                     — a real answer, and one the employee is owed.
 *   roundedMinutes    what the rounding rule made of that.
 *   countedMinutes    what payroll may use. ZERO while approval is pending.
 *
 * countedMinutes and pendingMinutes are deliberately separate accessors and
 * separate keys in toArray(). Keka's rule is "only approved hours will be
 * considered", and the way that goes wrong is never a loud failure — it is
 * unapproved hours quietly folded into a single total and paid.
 *
 * multiplier is a decimal STRING, and amountForHourlyRate() computes in bcmath.
 * A rate carried as a float drifts by a paisa an hour, which is invisible on
 * one payslip and material across a payroll run.
 */
final class OvertimeAssessment
{
    /** Approval is not configured for this policy; the hours simply count. */
    public const APPROVAL_NOT_REQUIRED = 'not_required';

    /** Approval is required and has not been given. Nothing counts yet. */
    public const APPROVAL_PENDING = 'pending';

    /** Approval is required and was given. */
    public const APPROVAL_APPROVED = 'approved';

    /** An overtime policy decided this. */
    public const SOURCE_POLICY = 'policy';

    /** No policy was assigned; shifts.overtime_multiplier answered. */
    public const SOURCE_SHIFT = 'shift';

    /** Neither — no policy and no shift. Nothing accrues. */
    public const SOURCE_NONE = 'none';

    /** Where the multiplier itself came from, which can differ from source. */
    public const MULTIPLIER_FROM_POLICY_SCOPE = 'policy_scope';
    public const MULTIPLIER_FROM_SHIFT = 'shift';
    public const MULTIPLIER_FROM_DEFAULT = 'default';

    /**
     * The configured rate was below what the law requires and the establishment
     * is enforcing the floor, so the statutory rate is what applies.
     */
    public const MULTIPLIER_FROM_STATUTORY_FLOOR = 'statutory_floor';

    public function __construct(
        public readonly Carbon $attendanceDate,
        /** working_day | weekly_off | holiday */
        public readonly string $scope,
        /** pay | comp_off */
        public readonly string $treatment,
        /** Decimal string, e.g. "1.50". Never a float. */
        public readonly string $multiplier,
        /** gross | effective */
        public readonly string $basis,
        public readonly int $workedMinutes,
        /**
         * The baseline the work was measured against, on the basis above.
         * Zero on a weekly off or holiday — nothing was expected, so every
         * minute is overtime. NULL when no shift length is configured, which
         * is a different fact from zero and the reason nothing accrues.
         */
        public readonly ?int $expectedMinutes,
        public readonly int $rawMinutes,
        public readonly int $qualifyingMinutes,
        public readonly int $roundedMinutes,
        public readonly string $approvalState,
        public readonly string $source,
        public readonly ?int $policyId = null,
        public readonly ?int $scopeRateId = null,
        public readonly string $multiplierSource = self::MULTIPLIER_FROM_DEFAULT,
        /**
         * The least an overtime hour may be worth here, as a decimal string.
         * Null where the establishment is unregulated or unknown.
         */
        public readonly ?string $statutoryMultiplierFloor = null,
        /**
         * What the POLICY said, before any floor was applied. Null means the
         * policy's rate is what `multiplier` already holds.
         *
         * Kept separately rather than overwritten because "we paid 2x because
         * the law says so, and your policy says 1.5x" is the sentence a
         * compliance report has to be able to say. Overwriting the configured
         * rate makes the payslip correct and the explanation impossible.
         */
        public readonly ?string $configuredMultiplier = null,
    ) {
    }

    /**
     * Is the configured rate below the statutory floor?
     *
     * True whether or not the floor is being enforced — that is the point. An
     * establishment that has not switched enforcement on still needs to be told
     * it is underpaying, and an establishment that has needs the shortfall
     * visible so somebody eventually fixes the policy rather than relying on
     * the floor forever.
     */
    public function isBelowStatutoryFloor(): bool
    {
        if ($this->statutoryMultiplierFloor === null) {
            return false;
        }

        return bccomp($this->configuredMultiplier ?? $this->multiplier, $this->statutoryMultiplierFloor, 2) < 0;
    }

    /** How far below, as a decimal string, or null when it is not below. */
    public function statutoryShortfall(): ?string
    {
        if (! $this->isBelowStatutoryFloor()) {
            return null;
        }

        return bcsub($this->statutoryMultiplierFloor, $this->configuredMultiplier ?? $this->multiplier, 2);
    }

    /** Has the approval gate been satisfied? */
    public function isCounted(): bool
    {
        return $this->approvalState !== self::APPROVAL_PENDING;
    }

    /** Minutes payroll may act on. Zero while approval is pending. */
    public function countedMinutes(): int
    {
        return $this->isCounted() ? $this->roundedMinutes : 0;
    }

    /** Minutes measured but held behind approval. Never silently dropped. */
    public function pendingMinutes(): int
    {
        return $this->isCounted() ? 0 : $this->roundedMinutes;
    }

    /** Counted minutes this scope pays money for. */
    public function payableMinutes(): int
    {
        return $this->treatment === OvertimePolicyScope::TREATMENT_PAY
            ? $this->countedMinutes()
            : 0;
    }

    /** Counted minutes this scope hands back as comp-off instead of money. */
    public function compOffMinutes(): int
    {
        return $this->treatment === OvertimePolicyScope::TREATMENT_COMP_OFF
            ? $this->countedMinutes()
            : 0;
    }

    /**
     * payable minutes / 60 x hourly rate x multiplier, as a decimal string
     * with two places.
     *
     * Computed in bcmath at eight places and rounded ONCE here, at the
     * boundary. Pass the rate as a string; an int is exact too. A float is
     * accepted only so a caller holding one is not forced to cast it badly,
     * and is normalised at six places on the way in.
     *
     * Comp-off pays nothing, and a pending assessment pays nothing, so both
     * return "0.00" rather than an amount somebody might book.
     */
    public function amountForHourlyRate(string|int|float $hourlyRate): string
    {
        $minutes = $this->payableMinutes();

        if ($minutes <= 0) {
            return '0.00';
        }

        $rate = $this->decimalString($hourlyRate);

        $amount = bcdiv(
            bcmul(bcmul((string) $minutes, $rate, 8), $this->multiplier, 8),
            '60',
            8,
        );

        return $this->roundHalfUp($amount);
    }

    /** @return array<string, mixed> */
    public function toArray(): array
    {
        return [
            'attendance_date' => $this->attendanceDate->toDateString(),
            'scope' => $this->scope,
            'treatment' => $this->treatment,
            'multiplier' => $this->multiplier,
            'multiplier_source' => $this->multiplierSource,
            'basis' => $this->basis,
            'worked_minutes' => $this->workedMinutes,
            'expected_minutes' => $this->expectedMinutes,
            'raw_minutes' => $this->rawMinutes,
            'qualifying_minutes' => $this->qualifyingMinutes,
            'rounded_minutes' => $this->roundedMinutes,
            // Counted and pending are separate keys on purpose — see the class
            // docblock. A consumer that wants a single number has to choose.
            'counted_minutes' => $this->countedMinutes(),
            'pending_minutes' => $this->pendingMinutes(),
            'payable_minutes' => $this->payableMinutes(),
            'comp_off_minutes' => $this->compOffMinutes(),
            'approval_state' => $this->approvalState,
            'source' => $this->source,
            'overtime_policy_id' => $this->policyId,
            'overtime_policy_scope_id' => $this->scopeRateId,
            'statutory_multiplier_floor' => $this->statutoryMultiplierFloor,
            'configured_multiplier' => $this->configuredMultiplier ?? $this->multiplier,
            'is_below_statutory_floor' => $this->isBelowStatutoryFloor(),
            'statutory_shortfall' => $this->statutoryShortfall(),
        ];
    }

    private function decimalString(string|int|float $value): string
    {
        if (is_string($value)) {
            $trimmed = trim($value);

            return is_numeric($trimmed) ? $trimmed : '0';
        }

        if (is_int($value)) {
            return (string) $value;
        }

        return sprintf('%.6F', $value);
    }

    /**
     * Half-up to two places on a decimal string. bcadd truncates, so the
     * rounding is done by adding half an increment first — and the sign is
     * handled explicitly, because truncation moves a negative the other way.
     */
    private function roundHalfUp(string $amount): string
    {
        $negative = str_starts_with($amount, '-');
        $magnitude = $negative ? substr($amount, 1) : $amount;

        $rounded = bcadd($magnitude, '0.005', 2);

        return ($negative && bccomp($rounded, '0', 2) !== 0) ? '-'.$rounded : $rounded;
    }
}
