<?php

namespace App\Support;

use InvalidArgumentException;

/**
 * The arithmetic of a repayment schedule, in one place and with no state.
 *
 * A loan is three numbers that must agree — amount, EMI and instalment count —
 * and until now nothing made them agree. The request form took all three
 * independently, so a ₹40,000 loan could be stored as ₹6,000 a month over four
 * instalments and nobody noticed the ₹16,000 that would never be recovered.
 *
 * TWO OF THE THREE DETERMINE THE THIRD. Give it an amount and an EMI and it
 * answers how many months; give it an amount and a count and it answers the
 * EMI. The UI binds both directions to this so the client and the server can
 * never disagree about a schedule.
 *
 * The tail is the interesting part. ₹40,000 at ₹6,000 is 6.67 months, which is
 * not a number of payments. It becomes SEVEN instalments — six of ₹6,000 and a
 * final ₹4,000 — because the employee asked for a round ₹6,000 and should get
 * it. That final instalment is smaller than the EMI, which is precisely the
 * case the payroll recovery has to stop over-charging (see
 * PayrollDepartmentController: it used to take a full EMI and clamp the
 * resulting negative balance to zero, quietly costing the employee ₹2,000).
 */
final class LoanSchedule
{
    /** Below this a repayment is not a repayment, it is a rounding artefact. */
    public const MIN_AMOUNT = 100.0;

    /** Matches the API's `total_installments` ceiling. */
    public const MAX_INSTALMENTS = 60;

    /**
     * How many months an amount takes at a given EMI.
     *
     * Rounds UP, because a part-month still has to be collected: ₹40,000 at
     * ₹6,000 is seven payments, not six and a bit.
     */
    public static function instalmentsFor(float $amount, float $emi): int
    {
        self::guardAmount($amount);

        if ($emi <= 0) {
            throw new InvalidArgumentException('EMI must be greater than zero.');
        }

        return (int) max(1, ceil(round($amount / $emi, 6)));
    }

    /**
     * What each month costs to clear an amount in a fixed number of payments.
     *
     * Rounds UP to the paisa. Rounding down would leave a residue that the
     * final instalment has to absorb, which is how a "12-month loan" quietly
     * becomes a thirteen-month one.
     */
    public static function emiFor(float $amount, int $instalments): float
    {
        self::guardAmount($amount);

        if ($instalments < 1 || $instalments > self::MAX_INSTALMENTS) {
            throw new InvalidArgumentException(
                'Instalments must be between 1 and '.self::MAX_INSTALMENTS.'.'
            );
        }

        return ceil(($amount / $instalments) * 100) / 100;
    }

    /**
     * The last payment, which is the remainder and never larger than the EMI.
     *
     * Equal to the EMI when the amount divides exactly.
     */
    public static function finalInstalmentFor(float $amount, float $emi): float
    {
        $count = self::instalmentsFor($amount, $emi);
        $tail = round($amount - ($emi * ($count - 1)), 2);

        // A tail of zero means the division was exact and the last payment is a
        // normal one; anything negative means the EMI overshoots the whole
        // amount, so the single payment is the amount itself.
        return $tail > 0 ? min($tail, $emi) : min($amount, $emi);
    }

    /**
     * The whole schedule, in the shape the API and the form both consume.
     *
     * @return array{amount: float, emi: float, instalments: int, final_instalment: float, has_smaller_final: bool}
     */
    public static function fromEmi(float $amount, float $emi): array
    {
        $instalments = self::instalmentsFor($amount, $emi);
        $final = self::finalInstalmentFor($amount, $emi);

        return [
            'amount' => round($amount, 2),
            'emi' => round($emi, 2),
            'instalments' => $instalments,
            'final_instalment' => $final,
            'has_smaller_final' => $instalments > 1 && $final < round($emi, 2),
        ];
    }

    /** The same schedule, derived from a chosen number of instalments. */
    public static function fromInstalments(float $amount, int $instalments): array
    {
        return self::fromEmi($amount, self::emiFor($amount, $instalments));
    }

    private static function guardAmount(float $amount): void
    {
        if ($amount < self::MIN_AMOUNT) {
            throw new InvalidArgumentException(
                'Loan amount must be at least '.self::MIN_AMOUNT.'.'
            );
        }
    }
}
