<?php

namespace Tests\Unit;

use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;
use App\Services\SalaryFormulaEngine;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * Regression tests for the payroll correctness hotfixes.
 *
 * Each case pins a bug that produced a plausible-looking but wrong number,
 * which is why these are value assertions and property sweeps rather than
 * smoke tests.
 */
class PayrollStatutoryCorrectnessTest extends TestCase
{
    private PayrollCalculatorService $calculator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calculator = new PayrollCalculatorService();
    }

    // -------------------------------------------------- Professional Tax

    /**
     * The bug: slab tables declare min as `previous max + 1` (7500 then 7501),
     * and matching required `gross >= min && gross <= max`. A gross of 7,500.50
     * matched no band at all and returned zero PT. LOP-adjusted gross is
     * fractional by construction, so this fired constantly.
     */
    #[Test]
    #[DataProvider('ptStateProvider')]
    public function pt_has_no_gaps_between_slab_boundaries(string $state): void
    {
        $previous = 0.0;

        // Half-rupee steps specifically to land inside the old boundary holes.
        for ($gross = 0.0; $gross <= 60000.0; $gross += 250.0) {
            foreach ([$gross, $gross + 0.5] as $probe) {
                $amount = PTStateService::calculate($state, $probe);

                $this->assertGreaterThanOrEqual(
                    $previous,
                    $amount,
                    "PT for {$state} dropped from {$previous} to {$amount} at gross {$probe}"
                );
                $previous = $amount;
            }
        }
    }

    #[Test]
    public function pt_boundary_values_resolve_to_the_expected_band(): void
    {
        // Maharashtra: 0-7500 nil, 7501-10000 -> 175, above -> 200.
        $this->assertSame(0.0, PTStateService::calculate('maharashtra', 7500));
        $this->assertSame(175.0, PTStateService::calculate('maharashtra', 7500.5), 'Fell through the old slab gap');
        $this->assertSame(175.0, PTStateService::calculate('maharashtra', 10000));
        $this->assertSame(200.0, PTStateService::calculate('maharashtra', 10000.5), 'Fell through the old slab gap');
        $this->assertSame(200.0, PTStateService::calculate('maharashtra', 50000));
    }

    /**
     * The bug: the February top-up returned for ANY non-zero band, so a 9,000
     * earner in Maharashtra paid 300 instead of 175. It applies only to the top
     * band, which is what makes that band total the 2,500 annual figure.
     */
    #[Test]
    public function maharashtra_february_surcharge_applies_only_to_the_top_band(): void
    {
        $this->assertSame(300.0, PTStateService::calculate('maharashtra', 25000, 2));
        $this->assertSame(175.0, PTStateService::calculate('maharashtra', 9000, 2));
        $this->assertSame(0.0, PTStateService::calculate('maharashtra', 5000, 2));

        // Non-February is unaffected.
        $this->assertSame(200.0, PTStateService::calculate('maharashtra', 25000, 1));
    }

    #[Test]
    public function maharashtra_top_band_totals_the_statutory_annual_figure(): void
    {
        $annual = 0.0;
        for ($month = 1; $month <= 12; $month++) {
            $annual += PTStateService::calculate('maharashtra', 25000, $month);
        }

        // 11 x 200 + 300 (February) = 2,500.
        $this->assertSame(2500.0, $annual, 'Annual PT for the top band must reach 2,500');
    }

    /**
     * The bug: eight jurisdictions that levy no professional tax at all
     * carried invented slabs and were deducting from real employees on every
     * run. Chandigarh's was also 3,000 a year, over the constitutional cap.
     *
     * This sweeps every configured jurisdiction rather than pinning the eight,
     * so re-adding a slab to a non-levying state fails here rather than
     * reaching payroll.
     */
    #[Test]
    #[DataProvider('ptStateProvider')]
    public function no_jurisdiction_exceeds_the_constitutional_annual_cap(string $state): void
    {
        // Article 276(2) binds every state and UT to 2,500 a year.
        $this->assertLessThanOrEqual(
            2500.0,
            PTStateService::getAnnualLimit($state),
            "Annual PT for {$state} breaches the Article 276(2) ceiling of 2,500"
        );
    }

    /**
     * Professional tax is state-levied and these jurisdictions do not levy it.
     * A high gross in any month must still deduct nothing.
     */
    #[Test]
    #[DataProvider('nonLevyingJurisdictionProvider')]
    public function jurisdictions_that_levy_no_pt_deduct_nothing(string $state): void
    {
        for ($month = 1; $month <= 12; $month++) {
            $this->assertSame(
                0.0,
                PTStateService::calculate($state, 500000, $month),
                "{$state} levies no professional tax but deducted in month {$month}"
            );
        }

        $this->assertSame(0.0, PTStateService::getAnnualLimit($state));
    }

    /**
     * getAnnualLimit() used to compute max-monthly x 12, which folded
     * Maharashtra's February instalment into the monthly maximum and returned
     * 3,600 against a real 2,500. It is now derived from calculate() itself;
     * this pins that derivation so the two cannot drift apart again.
     */
    #[Test]
    #[DataProvider('ptStateProvider')]
    public function annual_limit_agrees_with_twelve_months_of_calculate(string $state): void
    {
        $summed = 0.0;
        for ($month = 1; $month <= 12; $month++) {
            $summed += PTStateService::calculate($state, 1000000000.0, $month);
        }

        $this->assertSame(
            $summed,
            PTStateService::getAnnualLimit($state),
            "getAnnualLimit({$state}) disagrees with twelve months of calculate()"
        );
    }

    public static function ptStateProvider(): array
    {
        $cases = [];
        foreach (PTStateService::getStates() as $state) {
            $code = $state['code'];
            $cases[$code] = [$code];
        }

        return $cases;
    }

    public static function nonLevyingJurisdictionProvider(): array
    {
        $cases = [];

        foreach ([
            'andaman_and_nicobar',
            'arunachal_pradesh',
            'chandigarh',
            'chhattisgarh',
            'dadra_and_nagar_haveli',
            'daman_and_diu',
            'delhi',
            'goa',
            'haryana',
            'himachal_pradesh',
            'jammu_and_kashmir',
            'ladakh',
            'lakshadweep',
            'punjab',
            'rajasthan',
            'uttar_pradesh',
            'uttarakhand',
        ] as $code) {
            $cases[$code] = [$code];
        }

        return $cases;
    }

    // ------------------------------------------------------ Monthly TDS

    /**
     * April is the base month and must not be a special case in the code.
     * With no YTD and eleven months projected, the cumulative true-up has to
     * reduce exactly to annual tax over twelve.
     */
    #[Test]
    public function april_reduces_to_annual_tax_over_twelve(): void
    {
        $monthly = 100000.0;

        $trueUp = $this->calculator->calculateCumulativeMonthlyTds(
            ytdGrossPaid: 0,
            thisMonthGross: $monthly,
            projectedRemainingGross: $monthly * 11,
            previousEmployerGross: 0,
            tdsAlreadyDeducted: 0,
            previousEmployerTds: 0,
            monthsRemainingInFy: 12,
        );

        $flat = $this->calculator->calculateMonthlyTDS($monthly * 12);

        $this->assertEqualsWithDelta($flat['monthly_tds'], $trueUp['monthly_tds'], 0.02);
    }

    /**
     * The defect this replaces, and it is worse than a rounding error.
     *
     * The old form annualised whatever this month happened to be. A single
     * month with heavy loss of pay therefore restated the employee's whole
     * projected year downwards -- and for a high earner it can drop the
     * estimate below the new regime's ₹12,00,000 rebate limit, at which point
     * s.87A wipes the liability out and the month deducts **nothing at all**.
     * On a ₹24L salary. In March, with no month left to correct it in.
     *
     * The true-up counts the eleven months already paid, so the annual estimate
     * barely moves and the remaining liability is still collected.
     */
    #[Test]
    public function a_lop_month_does_not_collapse_the_year_and_zero_the_deduction(): void
    {
        $monthly = 200000.0;   // ₹24L a year
        $lopMonth = 80000.0;

        // March: eleven months paid, this month short, nothing left to project.
        $trueUp = $this->calculator->calculateCumulativeMonthlyTds(
            ytdGrossPaid: $monthly * 11,
            thisMonthGross: $lopMonth,
            projectedRemainingGross: 0,
            previousEmployerGross: 0,
            tdsAlreadyDeducted: 0,
            previousEmployerTds: 0,
            monthsRemainingInFy: 1,
        );

        // What the old form did: annualise this month and divide by twelve.
        $oldForm = $this->calculator->calculateMonthlyTDS($lopMonth * 12);

        $this->assertSame(
            0.0,
            $oldForm['monthly_tds'],
            'Annualising ₹80,000 lands under the ₹12L rebate limit and 87A zeroes it — the defect.'
        );

        // Nothing was withheld all year in this fixture, so March carries the
        // entire liability on ₹22.8L of earnings — roughly ₹2.6L.
        $this->assertGreaterThan(
            200000.0,
            $trueUp['monthly_tds'],
            'The true-up still collects the year’s outstanding liability in the final month.'
        );

        // And the annual estimate reflects the year actually earned, not the
        // ₹9.6L the old form imagined from one short month.
        $this->assertGreaterThan(2000000.0, $trueUp['taxable_income']);
    }

    /**
     * Tax already withheld is credited, so the year's deductions sum to the
     * year's liability rather than overshooting it.
     */
    #[Test]
    public function tax_already_deducted_is_credited_against_the_annual_liability(): void
    {
        $result = $this->calculator->calculateCumulativeMonthlyTds(
            ytdGrossPaid: 600000,
            thisMonthGross: 100000,
            projectedRemainingGross: 500000,
            previousEmployerGross: 0,
            tdsAlreadyDeducted: 40000,
            previousEmployerTds: 0,
            monthsRemainingInFy: 6,
        );

        $this->assertSame(40000.0, $result['tax_credited']);
        $this->assertEqualsWithDelta(
            $result['annual_tax'] - 40000,
            $result['remaining_tax'],
            0.01
        );
        $this->assertEqualsWithDelta(
            $result['remaining_tax'] / 6,
            $result['monthly_tds'],
            0.01
        );
    }

    /**
     * Previous-employer salary is taxed in the same ledger and its TDS is
     * credited, rather than being assessed as a separate annual lump.
     */
    #[Test]
    public function previous_employer_income_and_its_tds_both_land_in_the_ledger(): void
    {
        $withPrevious = $this->calculator->calculateCumulativeMonthlyTds(
            ytdGrossPaid: 300000,
            thisMonthGross: 100000,
            projectedRemainingGross: 500000,
            previousEmployerGross: 400000,
            tdsAlreadyDeducted: 0,
            previousEmployerTds: 15000,
            monthsRemainingInFy: 6,
        );

        $withoutPrevious = $this->calculator->calculateCumulativeMonthlyTds(
            ytdGrossPaid: 300000,
            thisMonthGross: 100000,
            projectedRemainingGross: 500000,
            previousEmployerGross: 0,
            tdsAlreadyDeducted: 0,
            previousEmployerTds: 0,
            monthsRemainingInFy: 6,
        );

        $this->assertGreaterThan($withoutPrevious['annual_tax'], $withPrevious['annual_tax']);
        $this->assertSame(15000.0, $withPrevious['tax_credited']);
    }

    /**
     * Over-withholding must stay signed. Clamping it to zero would strand the
     * excess with the employee's refund claim instead of correcting it in the
     * months that remain, which is the whole point of a true-up -- and it is
     * the same rule the codebase already applies to net pay.
     */
    #[Test]
    public function over_withholding_produces_a_negative_remainder(): void
    {
        $result = $this->calculator->calculateCumulativeMonthlyTds(
            ytdGrossPaid: 500000,
            thisMonthGross: 50000,
            projectedRemainingGross: 100000,
            previousEmployerGross: 0,
            tdsAlreadyDeducted: 200000, // far more than the year can owe
            previousEmployerTds: 0,
            monthsRemainingInFy: 3,
        );

        $this->assertLessThan(0, $result['remaining_tax']);
        $this->assertLessThan(0, $result['monthly_tds']);
    }

    #[Test]
    public function the_financial_year_runs_april_to_march(): void
    {
        $this->assertSame(1, PayrollCalculatorService::financialYearMonthIndex(4));
        $this->assertSame(9, PayrollCalculatorService::financialYearMonthIndex(12));
        $this->assertSame(10, PayrollCalculatorService::financialYearMonthIndex(1));
        $this->assertSame(12, PayrollCalculatorService::financialYearMonthIndex(3));
    }

    // ------------------------------------------------- CTC decomposition

    /**
     * The bug: special allowance was max(0, gross - fixedComponents). When a
     * structure could not fit, the residual read 0, gross was left untouched,
     * and the components stopped summing to it -- a payslip that does not foot,
     * with nothing raised or logged. The clamp is gone; the identity holds
     * whether the structure fits or not.
     */
    #[Test]
    #[DataProvider('salaryStructureProvider')]
    public function components_always_sum_to_gross(float $monthlyCtc, array $config): void
    {
        $c = $this->calculator->calculateSalaryComponents($monthlyCtc, $config);

        $this->assertEqualsWithDelta(
            $c['gross'],
            $c['basic'] + $c['hra'] + $c['conveyance'] + $c['special_allowance'],
            0.01,
            'The earnings lines must add up to the gross they decompose.'
        );
    }

    /**
     * A structure that cannot fit reports how far it misses by, rather than
     * quietly reading zero. 60% basic on a low CTC keeps basic under the PF
     * cap, so employer PF still tracks it and the envelope runs out.
     */
    #[Test]
    public function an_infeasible_structure_reports_its_shortfall(): void
    {
        $config = [
            'basic_percentage' => 0.60,
            'hra_percentage_of_basic' => 0.50,
            'conveyance_allowance' => 1600,
        ];

        $c = $this->calculator->calculateSalaryComponents(25000, $config);

        $this->assertLessThan(0, $c['special_allowance'], 'The real number must be visible to validation.');
        $this->assertEqualsWithDelta(-$c['special_allowance'], $c['residual_shortfall'], 0.01);
        $this->assertGreaterThan(0, $c['residual_shortfall']);
    }

    #[Test]
    public function a_structure_that_fits_reports_no_shortfall(): void
    {
        $c = $this->calculator->calculateSalaryComponents(100000, [
            'basic_percentage' => 0.40,
            'hra_percentage_of_basic' => 0.50,
            'conveyance_allowance' => 1600,
        ]);

        $this->assertGreaterThan(0, $c['special_allowance']);
        $this->assertSame(0.0, (float) $c['residual_shortfall']);
    }

    /**
     * Raising basic by ₹1 costs the residual ₹1.668, not ₹1 -- HRA is derived
     * from basic, and employer PF and the gratuity provision are inside the
     * CTC envelope. This pins the factor against the decomposition itself, so
     * the two cannot drift.
     */
    #[Test]
    public function the_residual_absorbs_more_than_one_rupee_per_rupee_of_basic(): void
    {
        $config = [
            'basic_percentage' => 0.40,
            'hra_percentage_of_basic' => 0.50,
            'conveyance_allowance' => 1600,
        ];

        // Below the PF wage cap: 1 + 0.50 + 0.12 + 0.0481.
        $this->assertEqualsWithDelta(1.6681, $this->calculator->residualAbsorptionFactor(10000, $config), 0.0001);

        // Above it, employer PF stops tracking basic and drops out.
        $this->assertEqualsWithDelta(1.5481, $this->calculator->residualAbsorptionFactor(60000, $config), 0.0001);
    }

    /**
     * maxBasicWithinCtc() is only useful if it is exact: a basic set to it must
     * leave the residual at zero, not merely near it.
     */
    #[Test]
    public function the_maximum_feasible_basic_lands_the_residual_on_zero(): void
    {
        $config = [
            'basic_percentage' => 0.40,
            'hra_percentage_of_basic' => 0.50,
            'conveyance_allowance' => 1600,
        ];
        $monthlyCtc = 100000.0;

        $maxBasic = $this->calculator->maxBasicWithinCtc($monthlyCtc, $config);

        // Re-express that basic as the percentage the structure would need.
        $atMax = $this->calculator->calculateSalaryComponents($monthlyCtc, [
            'basic_percentage' => $maxBasic / $monthlyCtc,
            'hra_percentage_of_basic' => 0.50,
            'conveyance_allowance' => 1600,
        ]);

        $this->assertEqualsWithDelta(0.0, $atMax['special_allowance'], 0.01);
        $this->assertSame(0.0, (float) $atMax['residual_shortfall']);
    }

    public static function salaryStructureProvider(): array
    {
        $cases = [];

        foreach ([25000.0, 50000.0, 100000.0, 250000.0] as $ctc) {
            foreach ([0.35, 0.40, 0.50, 0.60] as $basicPct) {
                $cases["ctc {$ctc} basic {$basicPct}"] = [
                    $ctc,
                    [
                        'basic_percentage' => $basicPct,
                        'hra_percentage_of_basic' => 0.50,
                        'conveyance_allowance' => 1600,
                    ],
                ];
            }
        }

        return $cases;
    }

    // ------------------------------------------------------- Provident Fund

    /**
     * The bug: callers signalled "contribute above the cap" by passing
     * PHP_FLOAT_MAX as basic, which min($basic, 15000) clamped straight back to
     * the ceiling. Opting in produced a flat 1,800 for everyone and
     * over-deducted from anyone whose basic was below 15,000.
     */
    #[Test]
    public function pf_above_cap_scales_with_basic_instead_of_flattening(): void
    {
        $this->assertSame(2400.0, $this->calculator->calculateEmployeePF(20000, 0, true));
        $this->assertSame(6000.0, $this->calculator->calculateEmployeePF(50000, 0, true));

        // Below the ceiling, opting in must not inflate the deduction.
        $this->assertSame(1200.0, $this->calculator->calculateEmployeePF(10000, 0, true));
        $this->assertSame(1200.0, $this->calculator->calculateEmployeePF(10000, 0, false));
    }

    #[Test]
    public function pf_is_capped_at_the_wage_ceiling_by_default(): void
    {
        $this->assertSame(1800.0, $this->calculator->calculateEmployeePF(50000));
        $this->assertSame(1800.0, $this->calculator->calculateEmployeePF(15000));
    }

    #[Test]
    public function pf_wages_include_dearness_allowance(): void
    {
        // Statutorily PF wages are basic + DA, not basic alone.
        $this->assertSame(12000.0, $this->calculator->pfWages(10000, 2000));
        // Still subject to the ceiling.
        $this->assertSame(15000.0, $this->calculator->pfWages(14000, 5000));
        $this->assertSame(19000.0, $this->calculator->pfWages(14000, 5000, true));
    }

    // ------------------------------------------------ Chapter VI-A relief

    /**
     * The bug: callers passed the SUM of every section as `section_80c`, which
     * the calculator then capped at 1.5L — so relief above the 80C cap was
     * discarded. 1.5L of 80C plus 2L of home-loan interest yielded 1.5L of
     * relief instead of 3.5L.
     */
    #[Test]
    public function sections_beyond_80c_are_not_swallowed_by_the_80c_cap(): void
    {
        $gross = 1800000;

        $only80c = $this->calculator->calculateOldRegimeTax($gross, [
            'section_80c' => 150000,
        ]);

        $withHomeLoan = $this->calculator->calculateOldRegimeTax($gross, [
            'section_80c' => 150000,
            'section_24b' => 200000,
        ]);

        $this->assertLessThan(
            (float) $only80c['total_tax'],
            (float) $withHomeLoan['total_tax'],
            '24(b) relief was swallowed by the 80C cap'
        );

        $claimed = $withHomeLoan['deductions_claimed'];
        $this->assertSame(150000.0, (float) $claimed['80c']);
        $this->assertSame(200000.0, (float) $claimed['24b']);
    }

    #[Test]
    public function an_exemption_map_and_a_bare_float_are_not_equivalent(): void
    {
        // A bare float is 80C-only by definition, so it must NOT produce the
        // same relief as a map spreading the same total across sections.
        $asFloat = $this->calculator->calculatePayroll(
            annualCtc: 2000000,
            taxRegime: 'old',
            annualTaxExemptions: 350000
        );

        $asMap = $this->calculator->calculatePayroll(
            annualCtc: 2000000,
            taxRegime: 'old',
            annualTaxExemptions: ['section_80c' => 150000, 'section_24b' => 200000]
        );

        $this->assertGreaterThan(
            $asMap['components']['deductions']['tds'],
            $asFloat['components']['deductions']['tds'],
            'The per-section map must yield more relief than a flat 80C total'
        );
    }

    // ------------------------------------------------------ Formula engine

    /**
     * The bug: only IF() was substituted. MAX/MIN/ROUND/ABS/FLOOR/CEIL were
     * registered and advertised but never replaced, so MAX(Basic, 15000)
     * degraded to 0.0 — and validateFormula() still reported it as valid.
     */
    #[Test]
    #[DataProvider('formulaProvider')]
    public function formula_engine_evaluates_registered_functions(string $expression, float $expected): void
    {
        $engine = new SalaryFormulaEngine();
        $engine->setVariables(['CTC' => 600000, 'MonthlyCTC' => 50000, 'Basic' => 20000]);

        $this->assertEqualsWithDelta($expected, $engine->evaluate($expression), 0.01);
    }

    public static function formulaProvider(): array
    {
        return [
            'bare variable' => ['CTC * 0.08', 48000.0],
            'bracketed variable' => ['[Basic] * 0.5', 10000.0],
            'MAX' => ['MAX(Basic, 15000)', 20000.0],
            'MIN' => ['MIN(Basic, 15000)', 15000.0],
            'ROUND' => ['ROUND(Basic * 0.1234, 2)', 2468.0],
            'ABS' => ['ABS(0 - 7)', 7.0],
            'FLOOR' => ['FLOOR(9.9)', 9.0],
            'CEIL' => ['CEIL(1.2)', 2.0],
            'IF true' => ['IF(CTC > 500000, 50000, 0)', 50000.0],
            'IF false' => ['IF(CTC > 900000, 50000, 0)', 0.0],
            'nested' => ['MAX(MIN(Basic, 25000), 10000)', 20000.0],
            'unary minus' => ['-5 + 10', 5.0],
            'negative operand' => ['Basic * -2', -40000.0],
        ];
    }

    /**
     * A formula that cannot be resolved must fail loudly. It previously
     * evaluated to 0.0 — silently paying nothing — while validateFormula()
     * returned true.
     */
    #[Test]
    #[DataProvider('invalidFormulaProvider')]
    public function unresolvable_formulas_are_rejected_rather_than_paying_zero(string $expression): void
    {
        $engine = new SalaryFormulaEngine();
        $engine->setVariables(['Basic' => 20000]);

        $this->assertFalse(
            $engine->validateFormula($expression),
            "'{$expression}' must not validate — it would silently pay 0"
        );

        $this->expectException(\RuntimeException::class);
        $engine->evaluate($expression);
    }

    public static function invalidFormulaProvider(): array
    {
        return [
            'unknown variable' => ['NoSuchVariable * 2'],
            'unknown function' => ['NOPE(1, 2)'],
            'typo'             => ['Basicc + 1'],
        ];
    }

    // ------------------------------------------------------------- LOP guard

    #[Test]
    public function lop_never_exceeds_month_gross_and_survives_zero_divisors(): void
    {
        $this->assertSame(0.0, $this->calculator->calculateLOP(50000, 3, 0));
        $this->assertSame(50000.0, $this->calculator->calculateLOP(50000, 40, 26));
    }
}
