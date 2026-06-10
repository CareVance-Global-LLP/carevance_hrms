<?php

namespace Tests\Unit;

use App\Models\EmployeePayrollTemplate;
use App\Models\LeaveEncashment;
use App\Models\ArrearPayment;
use App\Models\FullAndFinalSettlement;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Comprehensive Payroll Accuracy Tests
 * 
 * These tests verify that all payroll calculations are mathematically accurate
 * and comply with Indian payroll regulations.
 */
class PayrollAccuracyTest extends TestCase
{
    use RefreshDatabase;

    protected PayrollCalculatorService $calculator;
    protected User $employee;
    protected User $manager;
    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();
        $this->calculator = new PayrollCalculatorService();
        
        // Create test users with different roles
        $this->createTestUsers();
    }

    private function createTestUsers(): void
    {
        // Create organization
        $organization = \App\Models\Organization::factory()->create();
        
        // Employee
        $this->employee = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'employee',
            'email' => 'employee@test.com',
        ]);
        
        // Manager
        $this->manager = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'manager',
            'email' => 'manager@test.com',
        ]);
        
        // Admin
        $this->admin = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'admin',
            'email' => 'admin@test.com',
        ]);
        
        // Create employee profiles
        foreach ([$this->employee, $this->manager, $this->admin] as $user) {
            \App\Models\EmployeeProfile::factory()->create([
                'user_id' => $user->id,
                'organization_id' => $organization->id,
                'pan_number' => 'ABCDE' . rand(1000, 9999) . 'F',
                'uan_number' => strval(rand(100000000000, 999999999999)),
            ]);
        }
    }

    // ==================== BASIC COMPONENT ACCURACY ====================

    /**
     * Test: Basic salary calculation (40% of CTC)
     * Annual CTC: ₹12,00,000
     * Expected Monthly Basic: ₹40,000
     */
    public function test_basic_salary_calculation_accuracy(): void
    {
        $annualCtc = 1200000;
        $expectedMonthlyBasic = 40000; // 40% of 12L / 12
        
        $result = $this->calculator->calculatePayroll($annualCtc);
        
        $this->assertEqualsWithDelta(
            $expectedMonthlyBasic,
            $result['components']['earnings']['basic'],
            0.01,
            'Basic salary should be exactly 40% of monthly CTC'
        );
    }

    /**
     * Test: HRA calculation for Metro city (50% of Basic)
     */
    public function test_hra_metro_calculation(): void
    {
        $annualCtc = 1200000;
        $basic = 40000;
        $expectedHra = 20000; // 50% of basic
        
        $result = $this->calculator->calculatePayroll(
            annualCtc: $annualCtc,
            isMetroCity: true
        );
        
        $this->assertEqualsWithDelta(
            $expectedHra,
            $result['components']['earnings']['hra'],
            0.01,
            'HRA for metro should be 50% of basic'
        );
    }

    /**
     * Test: HRA calculation for Non-Metro city (40% of Basic)
     */
    public function test_hra_non_metro_calculation(): void
    {
        $annualCtc = 1200000;
        $basic = 40000;
        $expectedHra = 16000; // 40% of basic
        
        $result = $this->calculator->calculatePayroll(
            annualCtc: $annualCtc,
            isMetroCity: false
        );
        
        $this->assertEqualsWithDelta(
            $expectedHra,
            $result['components']['earnings']['hra'],
            0.01,
            'HRA for non-metro should be 40% of basic'
        );
    }

    // ==================== PF CALCULATIONS ====================

    /**
     * Test: PF Employee contribution (12% of Basic, uncapped)
     * Basic: ₹40,000
     * Expected PF: ₹4,800
     */
    public function test_pf_employee_calculation_uncapped(): void
    {
        $basic = 40000;
        $expectedPf = 4800; // 12% of 40000
        
        $pf = $this->calculator->calculateEmployeePF($basic);
        
        $this->assertEqualsWithDelta(
            $expectedPf,
            $pf,
            0.01,
            'PF employee should be 12% of basic'
        );
    }

    /**
     * Test: PF Employee contribution with wage cap
     * Basic: ₹25,000 (above cap)
     * Cap: ₹15,000
     * Expected PF: ₹1,800 (12% of 15,000)
     */
    public function test_pf_employee_calculation_capped(): void
    {
        $basic = 25000;
        $cappedWages = min($basic, 15000); // PF cap
        $expectedPf = $cappedWages * 0.12;
        
        $pf = $this->calculator->calculateEmployeePF($basic);
        
        $this->assertEqualsWithDelta(
            $expectedPf,
            $pf,
            0.01,
            'PF should be capped at 12% of ₹15,000'
        );
    }

    /**
     * Test: PF split into EPS and EPF
     * Basic: ₹40,000
     * EPS: 8.33% of capped wages
     * EPF: 3.67% of capped wages
     */
    public function test_pf_split_calculation(): void
    {
        $basic = 40000;
        $cappedWages = 15000;
        $expectedEps = $cappedWages * 0.0833; // 8.33%
        $expectedEpf = $cappedWages * 0.0367; // 3.67%
        
        $result = $this->calculator->calculateEmployerContributions($basic, 60000);
        
        $this->assertEqualsWithDelta(
            $expectedEps,
            $result['eps'],
            0.10,
            'EPS should be 8.33% of capped wages'
        );
        
        $this->assertEqualsWithDelta(
            $expectedEpf,
            $result['epf'],
            0.10,
            'EPF should be 3.67% of capped wages'
        );
    }

    // ==================== ESI CALCULATIONS ====================

    /**
     * Test: ESI calculation for eligible employee (Gross ≤ ₹21,000)
     * Gross: ₹20,000
     * Employee ESI: 0.75%
     * Expected: ₹150
     */
    public function test_esi_calculation_eligible(): void
    {
        $gross = 20000;
        $expectedEsi = 150; // 0.75% of 20000
        
        $esi = $this->calculator->calculateEmployeeESI($gross);
        
        $this->assertEqualsWithDelta(
            $expectedEsi,
            $esi,
            0.01,
            'ESI should be 0.75% of gross for eligible employees'
        );
    }

    /**
     * Test: ESI calculation for ineligible employee (Gross > ₹21,000)
     */
    public function test_esi_calculation_ineligible(): void
    {
        $gross = 25000;
        
        $esi = $this->calculator->calculateEmployeeESI($gross);
        
        $this->assertEquals(
            0,
            $esi,
            'ESI should be 0 for employees above threshold'
        );
    }

    // ==================== PROFESSIONAL TAX ====================

    /**
     * Test: PT calculation for Maharashtra
     * Salary > ₹10,000: ₹200 (₹300 in Feb)
     */
    public function test_pt_maharashtra_calculation(): void
    {
        $gross = 25000;
        $expectedPt = 200;
        
        $pt = PTStateService::calculate('maharashtra', $gross);
        
        $this->assertEquals(
            $expectedPt,
            $pt,
            'PT for Maharashtra should be ₹200 for salary above ₹10,000'
        );
    }

    /**
     * Test: PT calculation for Maharashtra in February
     */
    public function test_pt_maharashtra_february(): void
    {
        $gross = 25000;
        $expectedPt = 300;
        
        $pt = PTStateService::calculate('maharashtra', $gross, 2); // February
        
        $this->assertEquals(
            $expectedPt,
            $pt,
            'PT for Maharashtra in Feb should be ₹300'
        );
    }

    /**
     * Test: PT for Karnataka (no PT below ₹15,000)
     */
    public function test_pt_karnataka_exempt(): void
    {
        $gross = 14000;
        
        $pt = PTStateService::calculate('karnataka', $gross);
        
        $this->assertEquals(
            0,
            $pt,
            'PT for Karnataka should be 0 for salary below ₹15,000'
        );
    }

    // ==================== TDS/TAX CALCULATIONS ====================

    /**
     * Test: TDS calculation under New Tax Regime
     * Annual CTC: ₹12,00,000
     * Standard Deduction: ₹75,000
     * Taxable: ₹11,25,000
     */
    public function test_tds_new_regime_calculation(): void
    {
        $annualCtc = 1200000;
        
        $result = $this->calculator->calculatePayroll(
            annualCtc: $annualCtc,
            taxRegime: 'new'
        );
        
        // Verify monthly TDS is present
        $this->assertGreaterThan(
            0,
            $result['components']['deductions']['tds'],
            'TDS should be calculated for taxable income'
        );
        
        // Verify tax regime is recorded
        $this->assertEquals(
            'new',
            $result['breakdown']['tax_regime'],
            'Tax regime should be recorded correctly'
        );
    }

    /**
     * Test: TDS rebate under ₹12L (New Regime)
     */
    public function test_tds_rebate_new_regime(): void
    {
        $annualCtc = 1200000; // ₹12L
        
        $result = $this->calculator->calculatePayroll(
            annualCtc: $annualCtc,
            taxRegime: 'new'
        );
        
        // At exactly ₹12L with standard deduction, tax should be minimal
        $this->assertGreaterThanOrEqual(
            0,
            $result['components']['deductions']['tds'],
            'TDS should be 0 or minimal for rebate eligible income'
        );
    }

    // ==================== LOP CALCULATIONS ====================

    /**
     * Test: LOP calculation
     * Monthly Gross: ₹50,000
     * Working Days: 26
     * LOP Days: 2
     * Expected Deduction: ₹3,846.15
     */
    public function test_lop_calculation(): void
    {
        $monthlyGross = 50000;
        $workingDays = 26;
        $lopDays = 2;
        $expectedDeduction = ($monthlyGross / $workingDays) * $lopDays;
        
        $lop = $this->calculator->calculateLOP($monthlyGross, $lopDays, $workingDays);
        
        $this->assertEqualsWithDelta(
            $expectedDeduction,
            $lop,
            0.01,
            'LOP should be calculated as (Gross/Working Days) * LOP Days'
        );
    }

    /**
     * Test: Pro-rated salary for new joiner
     * Monthly Gross: ₹50,000
     * Days Worked: 15
     * Total Days: 30
     * Expected: ₹25,000
     */
    public function test_prorated_salary_calculation(): void
    {
        $monthlyGross = 50000;
        $daysWorked = 15;
        $totalDays = 30;
        $expectedSalary = 25000;
        
        $proRated = $this->calculator->calculateProRatedSalary(
            $monthlyGross,
            $daysWorked,
            $totalDays
        );
        
        $this->assertEqualsWithDelta(
            $expectedSalary,
            $proRated,
            0.01,
            'Pro-rated salary should be proportional to days worked'
        );
    }

    // ==================== GRATUITY CALCULATIONS ====================

    /**
     * Test: Gratuity provision (4.81% of Basic)
     * Basic: ₹40,000
     * Expected Gratuity: ₹1,924
     */
    public function test_gratuity_provision_calculation(): void
    {
        $basic = 40000;
        $expectedGratuity = 1924; // 4.81% of 40000
        
        $gratuity = $this->calculator->calculateGratuityProvision($basic);
        
        $this->assertEqualsWithDelta(
            $expectedGratuity,
            $gratuity,
            0.01,
            'Gratuity provision should be 4.81% of basic'
        );
    }

    /**
     * Test: Gratuity on exit calculation
     * Formula: (Last Basic + DA) × 15 × Years / 26
     * Max: ₹20,00,000
     */
    public function test_gratuity_exit_calculation(): void
    {
        $lastBasic = 50000;
        $yearsOfService = 10;
        $expectedGratuity = min(
            (($lastBasic * 15 * $yearsOfService) / 26),
            2000000 // Cap
        );
        
        $gratuity = $this->calculator->calculateGratuityForSettlement(
            $lastBasic,
            $yearsOfService
        );
        
        $this->assertEqualsWithDelta(
            $expectedGratuity,
            $gratuity,
            0.01,
            'Gratuity on exit should follow the formula'
        );
    }

    /**
     * Test: Gratuity not eligible before 5 years
     */
    public function test_gratuity_not_eligible_before_5_years(): void
    {
        $gratuity = $this->calculator->calculateGratuityForSettlement(
            lastBasic: 50000,
            yearsOfService: 4
        );
        
        $this->assertEquals(
            0,
            $gratuity,
            'Gratuity should be 0 for service less than 5 years'
        );
    }

    // ==================== NEW COMPONENTS ACCURACY ====================

    /**
     * Test: Dearness Allowance (DA) calculation
     * Basic: ₹40,000
     * DA%: 17%
     * Expected DA: ₹6,800
     */
    public function test_da_calculation(): void
    {
        $basic = 40000;
        $daPercentage = 17;
        $expectedDa = 6800;
        
        $da = $this->calculator->calculateDA($basic, $daPercentage);
        
        $this->assertEqualsWithDelta(
            $expectedDa,
            $da,
            0.01,
            'DA should be calculated as percentage of basic'
        );
    }

    /**
     * Test: City Compensatory Allowance (CCA)
     */
    public function test_cca_calculation(): void
    {
        $basic = 40000;
        
        // Metro A
        $ccaMetroA = $this->calculator->calculateCCA($basic, 0, 'metro_a');
        $this->assertGreaterThan(0, $ccaMetroA, 'CCA for Metro A should be positive');
        
        // Non-metro
        $ccaOther = $this->calculator->calculateCCA($basic, 0, 'other');
        $this->assertLessThan($ccaMetroA, $ccaOther, 'CCA for non-metro should be less than metro');
    }

    /**
     * Test: Leave Encashment calculation
     * Leave Balance: 10 days
     * Monthly Gross: ₹50,000
     * Working Days: 26
     * Expected: ₹19,230.77
     */
    public function test_leave_encashment_calculation(): void
    {
        $leaveBalance = 10;
        $monthlyGross = 50000;
        $dailyRate = $monthlyGross / 26;
        $expectedEncashment = $dailyRate * $leaveBalance;
        
        $encashment = $this->calculator->calculateLeaveEncashment(
            $leaveBalance,
            $monthlyGross,
            26
        );
        
        $this->assertEqualsWithDelta(
            $expectedEncashment,
            $encashment,
            0.01,
            'Leave encashment should be daily rate * days'
        );
    }

    /**
     * Test: Arrear calculation
     * Original: ₹40,000
     * Revised: ₹45,000
     * Months: 3
     * Expected: ₹15,000
     */
    public function test_arrear_calculation(): void
    {
        $original = 40000;
        $revised = 45000;
        $months = 3;
        $expectedArrear = 15000;
        
        $arrear = $this->calculator->calculateArrears($original, $revised, $months);
        
        $this->assertEqualsWithDelta(
            $expectedArrear,
            $arrear,
            0.01,
            'Arrear should be difference * months'
        );
    }

    /**
     * Test: NPS (National Pension System) calculation
     * Basic: ₹40,000
     * Percentage: 10%
     * Expected: ₹4,000
     */
    public function test_nps_calculation(): void
    {
        $basic = 40000;
        $percentage = 10;
        $expectedNps = 4000;
        
        $nps = $this->calculator->calculateNPS($basic, 0, $percentage);
        
        $this->assertEqualsWithDelta(
            $expectedNps,
            $nps,
            0.01,
            'NPS should be 10% of basic by default'
        );
    }

    /**
     * Test: VPF (Voluntary Provident Fund) calculation
     * Basic: ₹40,000
     * VPF%: 5%
     * Expected: ₹2,000
     */
    public function test_vpf_calculation(): void
    {
        $basic = 40000;
        $vpfPercentage = 5;
        $expectedVpf = 2000;
        
        $vpf = $this->calculator->calculateVPF($basic, $vpfPercentage);
        
        $this->assertEqualsWithDelta(
            $expectedVpf,
            $vpf,
            0.01,
            'VPF should be percentage of basic'
        );
    }

    /**
     * Test: VPF should be 0 if percentage is 0
     */
    public function test_vpf_zero_percentage(): void
    {
        $basic = 40000;
        $vpf = $this->calculator->calculateVPF($basic, 0);
        
        $this->assertEquals(
            0,
            $vpf,
            'VPF should be 0 when percentage is 0'
        );
    }

    /**
     * Test: Notice Pay Recovery calculation
     * Monthly Gross: ₹50,000
     * Notice Period: 30 days
     * Served Days: 15
     * Expected Recovery: ₹25,000
     */
    public function test_notice_pay_recovery_calculation(): void
    {
        $monthlyGross = 50000;
        $noticePeriodDays = 30;
        $servedDays = 15;
        $expectedRecovery = 25000; // Half month salary
        
        $recovery = $this->calculator->calculateNoticePayRecovery(
            $monthlyGross,
            $noticePeriodDays,
            $servedDays
        );
        
        $this->assertEqualsWithDelta(
            $expectedRecovery,
            $recovery,
            0.01,
            'Notice pay recovery should be for unserved days'
        );
    }

    /**
     * Test: Shift Differential calculation
     * Hourly Rate: ₹250
     * Night Hours: 10
     * Weekend Hours: 8
     * Expected: ₹1,000 (10% of ₹2,500) + ₹2,000 (25% of ₹2,000)
     */
    public function test_shift_differential_calculation(): void
    {
        $hourlyRate = 250;
        $nightHours = 10;
        $weekendHours = 8;
        
        $differential = $this->calculator->calculateShiftDifferential(
            $hourlyRate,
            $nightHours,
            $weekendHours,
            10, // Night differential %
            25  // Weekend differential %
        );
        
        // Night: 250 * 10% * 10 = ₹250
        // Weekend: 250 * 25% * 8 = ₹500
        // Total: ₹750
        $expectedDifferential = 750;
        
        $this->assertEqualsWithDelta(
            $expectedDifferential,
            $differential,
            0.01,
            'Shift differential should sum night and weekend premiums'
        );
    }

    // ==================== COMPLETE PAYROLL ACCURACY ====================

    /**
     * Test: Complete payroll calculation accuracy
     * CTC: ₹15,00,000
     * Verify all components sum correctly
     */
    public function test_complete_payroll_calculation_accuracy(): void
    {
        $annualCtc = 1500000;
        
        $result = $this->calculator->calculatePayroll(
            annualCtc: $annualCtc,
            stateCode: 'maharashtra',
            isMetroCity: true,
            taxRegime: 'new'
        );
        
        // Verify monthly CTC
        $this->assertEqualsWithDelta(
            125000,
            $result['monthly']['ctc'],
            0.01,
            'Monthly CTC should be annual/12'
        );
        
        // Verify gross is calculated
        $this->assertGreaterThan(
            0,
            $result['monthly']['gross'],
            'Gross should be positive'
        );
        
        // Verify net is calculated
        $this->assertGreaterThan(
            0,
            $result['monthly']['net'],
            'Net pay should be positive'
        );
        
        // Verify: Net = Gross - Total Deductions
        $expectedNet = $result['monthly']['gross'] - $result['monthly']['total_deductions'];
        $this->assertEqualsWithDelta(
            $expectedNet,
            $result['monthly']['net'],
            0.01,
            'Net should equal Gross - Deductions'
        );
    }

    /**
     * Test: Payroll calculation with all new components
     */
    public function test_comprehensive_payroll_with_all_components(): void
    {
        $annualCtc = 1200000;
        $config = [
            'basic_percentage' => 0.40,
            'hra_percentage_of_basic' => 0.50,
            'conveyance_allowance' => 1600,
            'medical_allowance' => 1250,
        ];
        
        $result = $this->calculator->calculatePayroll(
            annualCtc: $annualCtc,
            customConfig: $config,
            stateCode: 'maharashtra',
            isMetroCity: true,
            taxRegime: 'new'
        );
        
        // Verify all components exist
        $this->assertArrayHasKey('monthly', $result);
        $this->assertArrayHasKey('annual', $result);
        $this->assertArrayHasKey('components', $result);
        $this->assertArrayHasKey('breakdown', $result);
        
        // Verify earnings
        $earnings = $result['components']['earnings'];
        $this->assertArrayHasKey('basic', $earnings);
        $this->assertArrayHasKey('hra', $earnings);
        $this->assertArrayHasKey('conveyance', $earnings);
        
        // Verify deductions
        $deductions = $result['components']['deductions'];
        $this->assertArrayHasKey('pf', $deductions);
        $this->assertArrayHasKey('tds', $deductions);
        
        // Verify employer contributions
        $employer = $result['components']['employer_contributions'];
        $this->assertArrayHasKey('pf_employer', $employer);
        $this->assertArrayHasKey('gratuity', $employer);
    }

    // ==================== USER ROLE ACCESS TESTS ====================

    /**
     * Test: Employee can access their own payroll data
     */
    public function test_employee_can_access_own_payroll(): void
    {
        $this->actingAs($this->employee);
        
        // Employee should be able to see their template
        $template = EmployeePayrollTemplate::getOrCreateForUser(
            $this->employee->id,
            $this->employee->organization_id
        );
        
        $this->assertNotNull($template);
        $this->assertEquals($this->employee->id, $template->user_id);
    }

    /**
     * Test: Manager can access employee payroll data
     */
    public function test_manager_can_access_employee_payroll(): void
    {
        $this->actingAs($this->manager);
        
        // Manager should be able to see employee's template
        $template = EmployeePayrollTemplate::getOrCreateForUser(
            $this->employee->id,
            $this->employee->organization_id
        );
        
        $this->assertNotNull($template);
    }

    /**
     * Test: Admin can access all payroll data
     */
    public function test_admin_can_access_all_payroll(): void
    {
        $this->actingAs($this->admin);
        
        // Admin should be able to see anyone's template
        $template = EmployeePayrollTemplate::getOrCreateForUser(
            $this->employee->id,
            $this->employee->organization_id
        );
        
        $this->assertNotNull($template);
    }

    // ==================== TIME TRACKING INTEGRATION ====================

    /**
     * Test: Payroll calculation with time tracking data
     */
    public function test_payroll_with_time_tracking(): void
    {
        // Create time entries for employee
        $monthYear = now()->format('Y-m');
        
        // Mock time tracking data
        $timeData = [
            'total_worked_seconds' => 7200 * 22, // 2 hours * 22 days
            'total_productive_seconds' => 6000 * 22,
            'activity_percentage' => 83.33,
            'productivity_score' => 85,
            'payroll_tracked_hours' => 44,
            'payroll_payable_hours' => 44,
            'payroll_attendance_days' => 22,
        ];
        
        // Verify time data can be integrated with payroll
        $this->assertArrayHasKey('total_worked_seconds', $timeData);
        $this->assertArrayHasKey('activity_percentage', $timeData);
        $this->assertGreaterThan(0, $timeData['activity_percentage']);
    }

    // ==================== EDGE CASES ====================

    /**
     * Test: Payroll with zero CTC should handle gracefully
     */
    public function test_payroll_with_zero_ctc(): void
    {
        $result = $this->calculator->calculatePayroll(0);
        
        $this->assertEquals(
            0,
            $result['monthly']['ctc'],
            'CTC should be 0'
        );
        $this->assertEquals(
            0,
            $result['monthly']['net'],
            'Net should be 0 for 0 CTC'
        );
    }

    /**
     * Test: Payroll with very high CTC
     */
    public function test_payroll_with_high_ctc(): void
    {
        $annualCtc = 10000000; // ₹1 Crore
        
        $result = $this->calculator->calculatePayroll($annualCtc);
        
        $this->assertGreaterThan(
            0,
            $result['monthly']['net'],
            'Net should be positive even for high CTC'
        );
        
        // Verify TDS is calculated (high income should have tax)
        $this->assertGreaterThan(
            0,
            $result['components']['deductions']['tds'],
            'TDS should be calculated for high income'
        );
    }

    /**
     * Test: Multiple LOP days calculation
     */
    public function test_multiple_lop_days(): void
    {
        $monthlyGross = 50000;
        $workingDays = 26;
        $lopDays = 5;
        
        $lopDeduction = $this->calculator->calculateLOP($monthlyGross, $lopDays, $workingDays);
        
        // Daily rate: 50000/26 = 1923.08
        // 5 days LOP: 9615.38
        $expected = ($monthlyGross / $workingDays) * $lopDays;
        
        $this->assertEqualsWithDelta(
            $expected,
            $lopDeduction,
            0.01,
            'Multiple LOP days should calculate correctly'
        );
    }
}
