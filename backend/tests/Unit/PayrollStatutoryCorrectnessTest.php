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

    public static function ptStateProvider(): array
    {
        $cases = [];
        foreach (PTStateService::getStates() as $state) {
            $code = $state['code'];
            $cases[$code] = [$code];
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
