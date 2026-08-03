<?php

namespace Tests\Unit;

use App\Services\PayrollCalculatorService;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\TestCase;

/**
 * Golden-file regression tests for the income-tax engine.
 *
 * Each case below pins a behaviour that was previously wrong in a way that
 * silently mis-paid employees. These are deliberately expressed as
 * expected-rupee assertions rather than "does it run" smoke tests — the bugs
 * this suite guards against all produced plausible-looking numbers.
 */
class PayrollTaxCalculationTest extends TestCase
{
    private PayrollCalculatorService $calculator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calculator = new PayrollCalculatorService();
    }

    // ------------------------------------------------------------ 87A rebate

    #[Test]
    public function new_regime_rebate_is_assessed_on_taxable_income_not_gross(): void
    {
        // Gross ₹12.5L − ₹75k standard deduction = ₹11.75L taxable, which is
        // under the ₹12L limit, so tax is nil. The old code compared the
        // ₹12.5L GROSS against the limit, denied the rebate, and charged
        // roughly ₹70,000.
        $result = $this->calculator->calculateNewRegimeTax(1250000);

        $this->assertSame(1175000.0, (float) $result['taxable_income']);
        $this->assertSame(0.0, (float) $result['total_tax']);
    }

    #[Test]
    public function new_regime_charges_tax_once_taxable_income_exceeds_the_limit(): void
    {
        // Gross ₹15L → ₹14.25L taxable, comfortably past ₹12L.
        $result = $this->calculator->calculateNewRegimeTax(1500000);

        $this->assertGreaterThan(0, (float) $result['total_tax']);
        $this->assertSame(0.0, (float) $result['rebate_87a']);
    }

    #[Test]
    public function new_regime_applies_marginal_relief_just_above_the_rebate_limit(): void
    {
        // ₹12,75,000 gross → ₹12,00,000 taxable: exactly at the limit, nil tax.
        $atLimit = $this->calculator->calculateNewRegimeTax(1275000);
        $this->assertSame(0.0, (float) $atLimit['total_tax']);

        // ₹10,000 above the limit must not attract more than ₹10,000 of tax.
        // Without marginal relief this jumps to roughly ₹60,000.
        //
        // Relief caps the tax itself; the 4% health & education cess is then
        // levied on the relieved figure, so total_tax lands at ₹10,400.
        $justOver = $this->calculator->calculateNewRegimeTax(1285000);
        $this->assertLessThanOrEqual(10000.0, (float) $justOver['tax_before_cess']);
        $this->assertEqualsWithDelta(10400.0, (float) $justOver['total_tax'], 0.01);
    }

    #[Test]
    public function old_regime_rebate_is_assessed_on_taxable_income(): void
    {
        // ₹5.4L gross − ₹50k standard deduction = ₹4.9L taxable → rebate applies.
        $result = $this->calculator->calculateOldRegimeTax(540000);

        $this->assertSame(490000.0, (float) $result['taxable_income']);
        $this->assertSame(0.0, (float) $result['total_tax']);
    }

    // --------------------------------------------------------------- slabs

    #[Test]
    public function new_regime_slab_boundaries_are_contiguous(): void
    {
        // Walk across every boundary in ₹0.50 steps. Tax must never decrease
        // as income rises — a gap in the slab table shows up as a dip.
        $previous = -1.0;
        foreach ([399999.5, 400000.0, 400000.5, 799999.5, 800000.0, 800000.5] as $taxable) {
            $result = $this->calculator->calculateNewRegimeTax($taxable + 75000);
            $current = (float) $result['total_tax'];
            $this->assertGreaterThanOrEqual($previous, $current, "Tax dipped at taxable income {$taxable}");
            $previous = $current;
        }
    }

    // ----------------------------------------------------------- surcharge

    #[Test]
    public function surcharge_has_no_gap_at_the_one_crore_boundary(): void
    {
        // The old slab table jumped from max 10000000 to min 10000001, so an
        // income of ₹1,00,00,000.50 matched no slab and paid zero surcharge.
        $atBoundary = $this->calculator->calculateNewRegimeTax(10000000 + 75000);
        $justOver = $this->calculator->calculateNewRegimeTax(10000000.5 + 75000);

        $this->assertGreaterThan(0, (float) $atBoundary['surcharge']);
        $this->assertGreaterThan(
            0,
            (float) $justOver['surcharge'],
            'Income just past ₹1Cr fell through the surcharge slab gap'
        );
    }

    #[Test]
    public function new_regime_surcharge_is_capped_at_twenty_five_percent(): void
    {
        // Sec 115BAC caps the new-regime surcharge at 25% even above ₹5Cr,
        // where the old regime goes to 37%.
        $new = $this->calculator->calculateNewRegimeTax(60000000);
        $old = $this->calculator->calculateOldRegimeTax(60000000);

        $newRate = (float) $new['surcharge'] / max(1.0, (float) $new['tax_before_cess'] - (float) $new['surcharge']);
        $this->assertLessThanOrEqual(0.2501, $newRate);

        $oldRate = (float) $old['surcharge'] / max(1.0, (float) $old['tax_before_cess'] - (float) $old['surcharge']);
        $this->assertGreaterThan(0.2501, $oldRate, 'Old regime should exceed the 25% new-regime cap above ₹5Cr');
    }

    #[Test]
    public function surcharge_is_not_charged_below_fifty_lakh(): void
    {
        $result = $this->calculator->calculateNewRegimeTax(4000000);
        $this->assertSame(0.0, (float) $result['surcharge']);
    }

    // ------------------------------------------------------ exemption keys

    #[Test]
    #[DataProvider('sectionKeyProvider')]
    public function exemption_keys_normalise_to_the_form_the_calculator_reads(
        string $input,
        string $expected
    ): void {
        $this->assertSame($expected, PayrollCalculatorService::exemptionKey($input));
    }

    public static function sectionKeyProvider(): array
    {
        return [
            'upper case' => ['80C', 'section_80c'],
            'lower case' => ['80c', 'section_80c'],
            'already prefixed' => ['section_80c', 'section_80c'],
            'housing interest' => ['24B', 'section_24b'],
            'nps' => ['80CCD1B', 'section_80ccd1b'],
            'padded' => ['  80D  ', 'section_80d'],
        ];
    }

    #[Test]
    public function declared_deductions_actually_reduce_old_regime_tax(): void
    {
        // The key the map builder emits must be the key the calculator reads.
        // Previously the builder wrote '80c' while the calculator looked up
        // 'section_80c', so every declaration was silently worth nothing.
        $key = PayrollCalculatorService::exemptionKey('80C');

        $without = $this->calculator->calculateOldRegimeTax(1200000);
        $with = $this->calculator->calculateOldRegimeTax(1200000, [$key => 150000]);

        $this->assertLessThan(
            (float) $without['total_tax'],
            (float) $with['total_tax'],
            'A ₹1.5L 80C declaration did not reduce tax — key mismatch has regressed'
        );
    }

    #[Test]
    public function section_80c_is_capped_at_the_statutory_limit(): void
    {
        $atCap = $this->calculator->calculateOldRegimeTax(1200000, ['section_80c' => 150000]);
        $overCap = $this->calculator->calculateOldRegimeTax(1200000, ['section_80c' => 500000]);

        $this->assertSame(
            (float) $atCap['total_tax'],
            (float) $overCap['total_tax'],
            'Claiming more than ₹1.5L under 80C must not reduce tax further'
        );
    }

    // ------------------------------------------------------ safety guards

    #[Test]
    public function lop_calculation_survives_a_zero_divisor(): void
    {
        // Used to raise an uncaught DivisionByZeroError (HTTP 500) mid pay run.
        $this->assertSame(0.0, $this->calculator->calculateLOP(50000, 3, 0));
        $this->assertSame(0.0, $this->calculator->calculateProRatedSalary(50000, 10, 0));
    }

    #[Test]
    public function lop_never_exceeds_the_month_gross(): void
    {
        // 40 LOP days in a 26-working-day month must not produce a negative
        // net salary via an over-sized deduction.
        $this->assertSame(50000.0, $this->calculator->calculateLOP(50000, 40, 26));
    }

    #[Test]
    public function zero_income_produces_zero_tax_in_both_regimes(): void
    {
        $this->assertSame(0.0, (float) $this->calculator->calculateNewRegimeTax(0)['total_tax']);
        $this->assertSame(0.0, (float) $this->calculator->calculateOldRegimeTax(0)['total_tax']);
    }

    #[Test]
    public function hra_exemption_takes_the_least_of_the_three_statutory_limits(): void
    {
        // Actual HRA 240000; 50% of basic 300000; rent − 10% basic = 180000.
        // The least is 180000.
        $exemption = $this->calculator->calculateHraExemption(
            hraReceived: 240000,
            basicAnnual: 600000,
            rentPaid: 240000,
            isMetroCity: true
        );

        $this->assertSame(180000.0, $exemption);
    }

    #[Test]
    public function hra_exemption_is_never_negative_when_rent_is_below_ten_percent_of_basic(): void
    {
        $exemption = $this->calculator->calculateHraExemption(
            hraReceived: 240000,
            basicAnnual: 600000,
            rentPaid: 10000,
            isMetroCity: true
        );

        $this->assertSame(0.0, $exemption);
    }
}
