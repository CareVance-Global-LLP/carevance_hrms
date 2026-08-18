<?php

namespace App\Services\Payroll;

/**
 * The Code on Wages, 2019 definition of "wages", and the 50% floor that falls
 * out of it.
 *
 * In force since 21 November 2025. Section 2(y) defines wages as basic pay,
 * dearness allowance and retaining allowance, and then excludes a list of
 * allowances -- house rent allowance, conveyance, overtime, commission and the
 * rest. The proviso is the part that bites:
 *
 *     "Provided that, for calculating the wages under this clause, if payments
 *      made by the employer to the employee under clauses (a) to (i) exceeds
 *      one-half ... of all remuneration calculated under this clause, the
 *      amount which exceeds such one-half ... shall be deemed as remuneration
 *      and shall be added in wages under this clause."
 *
 * So the rule is not "basic must be 50%". It is that the *excluded* allowances
 * may not exceed half of total remuneration, and any excess is deemed to be
 * wages. Stated as arithmetic that collapses to one line:
 *
 *     statutory wage base = max(basic + DA, 50% of total remuneration)
 *
 * which is why this class is small. PF, gratuity, bonus and leave encashment
 * all key off that base, so getting it wrong is not one wrong number but four.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It does not restructure anyone's salary. The structure stays as agreed
 *    with the employee; the statutory base is a parallel figure computed from
 *    it. An offer letter that no longer matches the template is its own defect.
 *  - It does not decide the adoption date. Central and state implementing rules
 *    are still landing, so organisations will adopt on different dates, and
 *    recomputing a pre-adoption month must use the pre-adoption base. Callers
 *    pass the rule that applied to the period being computed -- see
 *    appliesOn() -- rather than assuming today's.
 *
 * Neither Keka nor greytHR handles this without vendor engineering: Zoho shows
 * an advisory note on three screens, Keka's own Labour Codes guide tells the
 * admin to "validate whether your salary structures follow the 50% wage rule"
 * by hand, and its minimum-wage validation -- built only for its US product --
 * is explicitly non-blocking even there. A validator is therefore a real
 * differentiator rather than catch-up.
 */
class CodeOnWagesService
{
    /** The proviso's one-half. */
    public const WAGE_FLOOR_RATIO = 0.50;

    /** Wage base computed the pre-Code way: whatever the structure says. */
    public const RULE_PRE_CODE = 'pre_code';

    /** Wage base subject to the s.2(y) proviso. */
    public const RULE_CODE_ON_WAGES = 'code_on_wages_50pct';

    /**
     * The date the Code on Wages came into force. An organisation may adopt
     * later as its state's rules land, but not earlier.
     */
    public const IN_FORCE_FROM = '2025-11-21';

    /**
     * Which rule governs a period, given the organisation's adoption date.
     *
     * Resolved against the period being computed, not against today: this is
     * what makes recomputing a pre-adoption month reproduce the figure that was
     * actually paid, which is the first thing an EPFO audit asks.
     */
    public function ruleFor(?string $adoptionDate, string $monthYear): string
    {
        if ($adoptionDate === null || $adoptionDate === '') {
            return self::RULE_PRE_CODE;
        }

        // Both are compared as 'Y-m': a rule adopted mid-month governs that
        // whole month, because a wage base cannot change halfway through a
        // statutory contribution period without making the PF return unfilable.
        return substr($adoptionDate, 0, 7) <= $monthYear
            ? self::RULE_CODE_ON_WAGES
            : self::RULE_PRE_CODE;
    }

    /**
     * The wage base PF, gratuity, bonus and leave encashment must be computed on.
     *
     * @param float $contractualWages    basic + DA + retaining allowance
     * @param float $totalRemuneration   all remuneration payable to the employee.
     *                                   This is gross, NOT cost-to-company:
     *                                   employer PF and the gratuity provision
     *                                   are the employer's cost and are not
     *                                   "payable to" anyone, so including them
     *                                   inflates the base and over-deducts.
     */
    public function statutoryWageBase(
        float $contractualWages,
        float $totalRemuneration,
        string $rule = self::RULE_CODE_ON_WAGES
    ): float {
        $wages = max(0.0, $contractualWages);

        if ($rule !== self::RULE_CODE_ON_WAGES) {
            return $wages;
        }

        return max($wages, max(0.0, $totalRemuneration) * self::WAGE_FLOOR_RATIO);
    }

    /**
     * The amount the proviso deems into wages — 0 when the structure already
     * complies. This is the figure to show an admin, because it names the size
     * of the problem rather than just its existence.
     */
    public function deemedAddition(float $contractualWages, float $totalRemuneration): float
    {
        return round(
            $this->statutoryWageBase($contractualWages, $totalRemuneration) - max(0.0, $contractualWages),
            2
        );
    }

    public function complies(float $contractualWages, float $totalRemuneration): bool
    {
        if ($totalRemuneration <= 0) {
            return true;
        }

        return $contractualWages >= $totalRemuneration * self::WAGE_FLOOR_RATIO;
    }

    /**
     * A structure's standing against the rule, in the shape a screen or a
     * pre-run readiness check can render directly.
     *
     * Advisory rather than blocking, matching the only two vendors who
     * implement anything here at all. Blocking payroll on a wage-definition
     * question the central and state rules have not finished answering would
     * stop people being paid over a compliance opinion.
     *
     * @return array{complies: bool, wage_ratio: float, contractual_wages: float,
     *               statutory_wage_base: float, deemed_addition: float,
     *               shortfall_in_wages: float, rule: string, message: string}
     */
    public function assess(
        float $contractualWages,
        float $totalRemuneration,
        string $rule = self::RULE_CODE_ON_WAGES
    ): array {
        $base = $this->statutoryWageBase($contractualWages, $totalRemuneration, $rule);
        $complies = $this->complies($contractualWages, $totalRemuneration);
        $ratio = $totalRemuneration > 0 ? $contractualWages / $totalRemuneration : 1.0;

        // What the structure would have to move into basic/DA to comply on its
        // own terms, as opposed to having it deemed there by the proviso.
        $shortfall = max(0.0, $totalRemuneration * self::WAGE_FLOOR_RATIO - $contractualWages);

        return [
            'complies' => $complies,
            'wage_ratio' => round($ratio, 4),
            'contractual_wages' => round($contractualWages, 2),
            'statutory_wage_base' => round($base, 2),
            'deemed_addition' => $this->deemedAddition($contractualWages, $totalRemuneration),
            'shortfall_in_wages' => round($shortfall, 2),
            'rule' => $rule,
            'message' => $complies
                ? 'Wages are at least 50% of total remuneration.'
                : sprintf(
                    'Wages are %.1f%% of total remuneration. The Code on Wages proviso deems a further '
                    .'%s into wages, so PF, gratuity and bonus are computed on %s rather than %s. '
                    .'Move %s into basic or DA to make the structure comply on its own terms.',
                    $ratio * 100,
                    number_format($this->deemedAddition($contractualWages, $totalRemuneration), 2),
                    number_format($base, 2),
                    number_format($contractualWages, 2),
                    number_format($shortfall, 2),
                ),
        ];
    }
}
