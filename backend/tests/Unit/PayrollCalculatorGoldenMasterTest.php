<?php

namespace Tests\Unit;

use App\Services\PayrollCalculatorService;
use PHPUnit\Framework\TestCase;

/**
 * Golden-master test for PayrollCalculatorService.
 *
 * Every value below was captured from the live calculator in June 2026
 * and represents the contract this test pins down. If a future change
 * to the calculator changes any of these numbers intentionally, the
 * golden values must be re-captured and this test re-asserted (or the
 * change rejected in code review).
 *
 * Why this matters: the calculator is the single source of truth for
 * net pay across every payroll run. A regression here is a financial
 * bug.
 */
class PayrollCalculatorGoldenMasterTest extends TestCase
{
    private PayrollCalculatorService $calc;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calc = new PayrollCalculatorService();
    }

    public function test_ctc_1_2m_basic_40_pct_hra_50_pct_new_regime_non_metro(): void
    {
        $r = $this->calc->calculatePayroll(
            annualCtc: 1_200_000,
            stateCode: 'maharashtra',
            isMetroCity: false,
            taxRegime: 'new',
        );

        $m = $r['monthly'];
        $c = $r['components'];

        // CTC = 1,200,000 / 12 = 100,000 monthly.
        // gross = monthly - employer PF - gratuity provision.
        $this->assertEqualsWithDelta(96276.0, $m['gross'], 0.5, 'monthly gross');
        $this->assertEqualsWithDelta(40000.0, $c['earnings']['basic'], 0.5, 'basic = 40% of CTC/12');
        $this->assertEqualsWithDelta(16000.0, $c['earnings']['hra'], 0.5, 'HRA = 50% of basic (non-metro)');
        $this->assertEqualsWithDelta(1800.0, $c['deductions']['pf_employee'], 0.5, 'PF = 12% of 15000 cap');
        $this->assertEqualsWithDelta(0.0, $c['deductions']['esi_employee'], 0.5, 'ESI = 0 (gross > 21K)');
        $this->assertEqualsWithDelta(200.0, $c['deductions']['pt'], 0.5, 'PT Maharashtra 25-50K slab');
        $this->assertEqualsWithDelta(0.0, $c['deductions']['tds'], 0.5, 'TDS = 0 (87A rebate under 12L)');
        $this->assertEqualsWithDelta(94276.0, $m['net'], 0.5, 'net pay');
    }

    public function test_pf_cap_when_basic_exceeds_15k(): void
    {
        // CTC = 600,000, basic = 40% = 20,000 > 15,000 cap.
        // PF should be capped at 12% × 15,000 = 1,800.
        $r = $this->calc->calculatePayroll(
            annualCtc: 600_000,
            stateCode: 'maharashtra',
            isMetroCity: true,
            taxRegime: 'new',
        );

        $this->assertEqualsWithDelta(1800.0, $r['components']['deductions']['pf_employee'], 0.5,
            'PF employee contribution must be capped at 1,800 (12% of 15,000)');
        // The new code path returns 'breakdown' only when the calculator
        // uses the older formula branch. When present, pf_cap_applied=true.
        if (isset($r['breakdown']['pf_cap_applied'])) {
            $this->assertTrue($r['breakdown']['pf_cap_applied'],
                'pf_cap_applied flag must be true');
        }
    }

    public function test_esi_applied_when_gross_le_21k(): void
    {
        // CTC = 240,000 / 12 = 20,000 monthly gross (< 21K => ESI applies).
        $r = $this->calc->calculatePayroll(
            annualCtc: 240_000,
            stateCode: 'maharashtra',
            isMetroCity: true,
            taxRegime: 'new',
        );

        $this->assertEqualsWithDelta(18655.20, $r['monthly']['gross'], 0.5, 'monthly gross');
        $this->assertGreaterThan(0.0, $r['components']['deductions']['esi_employee'],
            'ESI must be > 0 when gross <= 21,000');
        // ESI = 0.75% of gross = 0.0075 * 18655.20 ≈ 139.91
        $this->assertEqualsWithDelta(139.91, $r['components']['deductions']['esi_employee'], 0.5,
            'ESI employee = 0.75% of gross');
        if (isset($r['breakdown']['esi_applicable'])) {
            $this->assertTrue($r['breakdown']['esi_applicable'],
                'esi_applicable flag must be true');
        }
    }

    public function test_pt_maharashtra_25k_to_50k_slab(): void
    {
        // CTC 9L / 12 = 75,000 monthly. PT Maharashtra slab 25-50K = 200/month.
        $r = $this->calc->calculatePayroll(
            annualCtc: 900_000,
            stateCode: 'maharashtra',
            isMetroCity: true,
            taxRegime: 'new',
        );

        $this->assertEqualsWithDelta(200.0, $r['components']['deductions']['pt'], 0.5,
            'PT Maharashtra 25-50K = ₹200/month');
    }

    public function test_tds_new_regime_87a_full_rebate_at_12L(): void
    {
        // CTC = 12L → annual gross 11,55,312 < 12,00,000 after standard deduction.
        // 87A rebate applies, monthly TDS = 0.
        $r = $this->calc->calculatePayroll(
            annualCtc: 1_200_000,
            stateCode: 'maharashtra',
            isMetroCity: true,
            taxRegime: 'new',
        );

        $this->assertEqualsWithDelta(0.0, $r['components']['deductions']['tds'], 0.5,
            '87A full rebate at 12L: monthly TDS must be 0');
    }

    public function test_tds_new_regime_still_rebated_when_gross_exceeds_12L_but_taxable_does_not(): void
    {
        // CTC = 13L → annual gross 12,53,388 → taxable 11,78,388 after the
        // 75,000 standard deduction. Sec 87A tests TOTAL (taxable) income, not
        // gross, so the full rebate still applies and TDS is nil.
        //
        // This test previously asserted 5012.7/month, which encoded the bug
        // where the rebate was compared against GROSS income — it denied the
        // rebate to employees who were legally entitled to it and over-deducted
        // roughly 60,000 a year.
        $r = $this->calc->calculatePayroll(
            annualCtc: 1_300_000,
            stateCode: 'maharashtra',
            isMetroCity: true,
            taxRegime: 'new',
        );

        $this->assertEqualsWithDelta(0.0, $r['components']['deductions']['tds'], 0.5,
            'Taxable income below 12L must attract no TDS even when gross exceeds it');
    }

    public function test_tds_new_regime_tax_above_12L_taxable_threshold(): void
    {
        // CTC = 14L → annual gross 13,51,464 → taxable 12,76,464, genuinely
        // past the 12L threshold, so 87A no longer applies.
        $r = $this->calc->calculatePayroll(
            annualCtc: 1_400_000,
            stateCode: 'maharashtra',
            isMetroCity: true,
            taxRegime: 'new',
        );

        $this->assertGreaterThan(0.0, $r['components']['deductions']['tds'],
            'TDS must be > 0 above the 12L 87A threshold');
        // Golden value: 6194.03
        $this->assertEqualsWithDelta(6194.03, $r['components']['deductions']['tds'], 0.5,
            'Monthly TDS at CTC 14L new regime');
    }

    public function test_tds_old_regime_with_80c_150k(): void
    {
        // Old regime, 15L CTC, 150K 80C claimed.
        $r = $this->calc->calculatePayroll(
            annualCtc: 1_500_000,
            stateCode: 'maharashtra',
            isMetroCity: true,
            taxRegime: 'old',
            annualTaxExemptions: 150_000.0,
        );

        $this->assertGreaterThan(0.0, $r['components']['deductions']['tds'],
            'TDS must be > 0 in old regime at 15L CTC');
        // Golden: 16238.04 monthly
        $this->assertEqualsWithDelta(16238.04, $r['components']['deductions']['tds'], 0.5,
            'Old regime monthly TDS at 15L with 80C 150K');
    }
}
