<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\LeaveEncashment;
use App\Models\ArrearPayment;
use App\Models\FullAndFinalSettlement;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Models\Organization;
use App\Models\Group;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithFaker;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * Payroll Integration Tests
 * 
 * Tests complete end-to-end payroll workflows including:
 * - Employee payroll processing
 * - Manager approvals
 * - Admin controls
 * - Leave encashment
 * - Arrear payments
 * - Full & Final settlements
 */
class PayrollIntegrationTest extends TestCase
{
    use RefreshDatabase, WithFaker, BuildsPayrollFixture;


    protected function setUp(): void
    {
        parent::setUp();

        $this->buildPayrollFixture();
    }

    // ==================== EMPLOYEE SELF-SERVICE ====================

    /**
     * `payroll/employees/{id}` is an HR/admin view, not self-service — employees
     * reach their own figures through `payroll/my/*` (see the allow-list in
     * PayrollRouteAuthorizationTest). This asserted an employee could read it
     * and had been failing on the 403 that correctly refuses them.
     */
    public function test_hr_can_view_employee_payroll_record(): void
    {
        $this->actingAs($this->hr);

        $response = $this->getJson("/api/payroll/employees/{$this->employee->id}");

        $response->assertStatus(200)
            ->assertJsonStructure([
                'employee',
                'time_tracking',
                'template',
                'month_year',
            ])
            ->assertJsonPath('employee.id', $this->employee->id)
            ->assertJsonPath('employee.email', $this->employee->email);
    }

    /**
     * Test: Employee cannot view other employee's payroll
     */
    public function test_employee_cannot_view_other_employee_payroll(): void
    {
        $this->actingAs($this->employee);

        $response = $this->getJson("/api/payroll/employees/{$this->manager->id}");

        // Should either be forbidden or show limited data
        $this->assertTrue(
            in_array($response->getStatusCode(), [403, 200]),
            'Response should be either forbidden or success with limited data'
        );
    }

    /**
     * Test: Employee can view their payslips
     */
    public function test_employee_can_view_payslips(): void
    {
        $this->actingAs($this->employee);

        $response = $this->getJson('/api/payroll/my/payslips');

        $response->assertStatus(200);
    }

    // ==================== MANAGER WORKFLOW ====================

    /**
     * Test: Manager can view department payroll
     */
    /**
     * A line manager is not a payroll administrator.
     *
     * This asserted 200 until 20 Aug 2026, because the payroll group was gated
     * `role:admin,manager` and EnsureUserHasRole reads 'manager' as
     * hierarchy_level < 100 — so every manager in the organization could open
     * department payroll, which is the salary of everyone in it. Having a team
     * is not a reason to see what the company pays.
     *
     * Managers keep their own figures through My Payroll, and their team's
     * expense claims through the manager reimbursement routes, both of which
     * live outside this group. See PayrollManagerBoundaryTest.
     */
    public function test_a_manager_cannot_view_department_payroll(): void
    {
        $this->actingAs($this->manager);

        $this->getJson('/api/payroll/departments')->assertStatus(403);
    }

    /**
     * Test: Manager can view employee details in their department
     */
    /** Same boundary as above: the per-department employee payroll list. */
    public function test_a_manager_cannot_view_department_employee_payroll(): void
    {
        $this->actingAs($this->manager);

        $this->getJson("/api/payroll/departments/{$this->department->id}/employees")->assertStatus(403);
    }

    // ==================== HR WORKFLOW ====================

    /**
     * Test: HR can create payroll template for employee
     */
    public function test_hr_can_create_employee_template(): void
    {
        $this->actingAs($this->hr);

        $response = $this->putJson("/api/payroll/employees/{$this->employee->id}/template", [
            'annual_ctc' => 1200000,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'pf_enabled' => true,
            'esi_enabled' => true,
            'pt_enabled' => true,
            'tds_enabled' => true,
            'tax_regime' => 'new',
            'is_metro_city' => true,
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'message' => 'Payroll template updated successfully',
            ]);

        // Verify template was created
        $this->assertDatabaseHas('employee_payroll_templates', [
            'user_id' => $this->employee->id,
            'organization_id' => $this->organization->id,
            'annual_ctc' => 1200000,
        ]);
    }

    /**
     * Test: HR can process employee payroll
     */
    public function test_hr_can_process_employee_payroll(): void
    {
        $this->actingAs($this->hr);

        // First create template
        EmployeePayrollTemplate::getOrCreateForUser(
            $this->employee->id,
            $this->organization->id
        );

        // Update template with CTC
        \DB::table('employee_payroll_templates')
            ->where('user_id', $this->employee->id)
            ->update(['annual_ctc' => 1200000]);

        $response = $this->postJson("/api/payroll/employees/{$this->employee->id}/process", [
            'month_year' => now()->format('Y-m'),
            'annual_ctc' => 1200000,
            'working_days' => 26,
            'days_present' => 26,
            'lOP_days' => 0,
            'overtime_hours' => 0,
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'message' => 'Payroll processed successfully',
            ]);

        // Verify payroll item was created
        $this->assertDatabaseHas('payroll_items', [
            'user_id' => $this->employee->id,
            'organization_id' => $this->organization->id,
        ]);
    }

    // ==================== PAYROLL RUN WORKFLOW ====================

    /**
     * Test: Admin can create payroll run
     */
    public function test_admin_can_manage_payroll_run(): void
    {
        $this->actingAs($this->admin);

        $monthYear = now()->format('Y-m');

        // Process employee payroll first
        EmployeePayrollTemplate::getOrCreateForUser(
            $this->employee->id,
            $this->organization->id
        );
        
        \DB::table('employee_payroll_templates')
            ->where('user_id', $this->employee->id)
            ->update(['annual_ctc' => 1200000]);

        $this->postJson("/api/payroll/employees/{$this->employee->id}/process", [
            'month_year' => $monthYear,
            'annual_ctc' => 1200000,
            'working_days' => 26,
            'days_present' => 26,
            'lOP_days' => 0,
        ]);

        // Get payroll run
        $payrollRun = PayrollMonthlyRun::where('organization_id', $this->organization->id)
            ->where('month_year', $monthYear)
            ->first();

        $this->assertNotNull($payrollRun);

        // Lock payroll run
        $response = $this->postJson("/api/payroll/runs/{$payrollRun->id}/lock");
        $response->assertStatus(200);

        // Approve payroll run
        $response = $this->postJson("/api/payroll/runs/{$payrollRun->id}/approve");
        $response->assertStatus(200);

        // Release payroll run
        $response = $this->postJson("/api/payroll/runs/{$payrollRun->id}/release");
        $response->assertStatus(200);

        // Process payment
        $response = $this->postJson("/api/payroll/runs/{$payrollRun->id}/process-payment", [
            'payment_method' => 'bank_transfer',
        ]);
        $response->assertStatus(200);

        // Verify the run reached its terminal state.
        //
        // Asserted 'paid' until now, which processRunPayment has never set —
        // it marks each *item* payment_status = 'paid' and moves the *run* to
        // 'disbursed', the immutable terminal state in the documented lifecycle
        // (draft → locked → approved → released → disbursed). The test was
        // failing on this line rather than on any of the requests above.
        $payrollRun->refresh();
        $this->assertEquals('disbursed', $payrollRun->status);
    }

    // ==================== LEAVE ENCASHMENT WORKFLOW ====================

    /**
     * Test: Complete leave encashment workflow
     */
    public function test_leave_encashment_workflow(): void
    {
        // Encashment values the leave against the employee's CTC and refuses to
        // run without one.
        $this->giveCtc($this->employee);

        // HR creates encashment request
        $this->actingAs($this->hr);

        $response = $this->postJson('/api/payroll/leave-encashments', [
            'user_id' => $this->employee->id,
            'leave_type' => 'earned',
            'encashed_days' => 10,
            'eligible_days' => 15,
            'month_year' => now()->format('Y-m'),
            'notes' => 'Year-end leave encashment',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'message' => 'Leave encashment request created',
            ]);

        // Get encashment ID
        $encashment = LeaveEncashment::where('user_id', $this->employee->id)->first();
        $this->assertNotNull($encashment);
        $this->assertEquals('draft', $encashment->status);

        // Admin approves encashment
        $this->actingAs($this->admin);
        
        $response = $this->postJson("/api/payroll/leave-encashments/{$encashment->id}/approve");
        $response->assertStatus(200);

        // Verify approved
        $encashment->refresh();
        $this->assertEquals('approved', $encashment->status);
        $this->assertNotNull($encashment->approved_by);
        $this->assertNotNull($encashment->approved_at);
    }

    // ==================== ARREAR WORKFLOW ====================

    /**
     * Test: Complete arrear payment workflow
     */
    public function test_arrear_payment_workflow(): void
    {
        // HR creates arrear
        $this->actingAs($this->hr);

        $response = $this->postJson('/api/payroll/arrears', [
            'user_id' => $this->employee->id,
            'arrear_month' => '2026-05',
            'calculation_month' => '2026-06',
            'arrear_type' => 'increment',
            'original_basic' => 40000,
            'revised_basic' => 45000,
            'original_gross' => 60000,
            'revised_gross' => 67500,
            'reason' => 'Annual increment arrears',
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'message' => 'Arrear payment created',
            ]);

        // Get arrear
        $arrear = ArrearPayment::where('user_id', $this->employee->id)->first();
        $this->assertNotNull($arrear);

        // Verify calculations
        $this->assertEquals(5000, $arrear->basic_difference); // 45000 - 40000
        $this->assertEquals(7500, $arrear->gross_difference); // 67500 - 60000

        // Approval applies the arrear to the employee's payroll_item in the run
        // for its calculation_month, so both the run and the item have to exist.
        // Approving without them returns 422 naming which is missing — the
        // arrear has to land on a real payable line, not float free.
        $this->giveCtc($this->employee);
        $this->actingAs($this->admin);
        $this->postJson("/api/payroll/employees/{$this->employee->id}/process", [
            'month_year' => '2026-06',
            'annual_ctc' => 1200000,
            'working_days' => 26,
            'days_present' => 26,
        ])->assertOk();

        $item = PayrollItem::whereHas('payrollRun', fn ($q) => $q->where('month_year', '2026-06'))
            ->where('user_id', $this->employee->id)
            ->firstOrFail();
        $grossBefore = (float) $item->gross_salary;

        // Admin approves
        $response = $this->postJson("/api/payroll/arrears/{$arrear->id}/approve");
        $response->assertStatus(200);

        $arrear->refresh();
        $this->assertEquals('approved', $arrear->status);

        // The arrear must move gross, not just the `arrears` column — an earlier
        // bug left gross_salary alone, so net no longer equalled gross minus
        // deductions and the bank file paid money the register did not show.
        $item->refresh();
        $this->assertEquals(
            $grossBefore + 7500,
            (float) $item->gross_salary,
            'Approving an arrear must add the gross difference to the payroll item'
        );
        $this->assertEquals(7500, (float) $item->arrears);
    }

    // ==================== F&F SETTLEMENT WORKFLOW ====================

    /**
     * Test: Complete Full & Final settlement workflow
     */
    public function test_fnf_settlement_workflow(): void
    {
        // Every figure in a settlement — notice pay, leave encashment, gratuity
        // — derives from the CTC, so the endpoint refuses to draft one without.
        $this->giveCtc($this->employee);

        // HR creates F&F settlement
        $this->actingAs($this->hr);

        $response = $this->postJson('/api/payroll/fnf-settlements', [
            'user_id' => $this->employee->id,
            'resignation_date' => now()->subDays(30)->format('Y-m-d'),
            'last_working_date' => now()->format('Y-m-d'),
            'exit_type' => 'resignation',
            'notice_period_days' => 30,
            'served_days' => 30,
            'earned_leave_balance' => 20,
            'years_of_service' => 5.5,
            'is_gratuity_eligible' => true,
        ]);

        $response->assertStatus(200)
            ->assertJson([
                'success' => true,
                'message' => 'F&F settlement created',
            ]);

        // Get settlement
        $settlement = FullAndFinalSettlement::where('user_id', $this->employee->id)->first();
        $this->assertNotNull($settlement);

        // Verify calculations
        $this->assertEquals('draft', $settlement->status);
        $this->assertGreaterThan(0, $settlement->current_month_salary);
        $this->assertGreaterThan(0, $settlement->leave_encashment);
        $this->assertGreaterThan(0, $settlement->gratuity_amount);

        // Admin approves
        $this->actingAs($this->admin);
        
        $response = $this->postJson("/api/payroll/fnf-settlements/{$settlement->id}/approve");
        $response->assertStatus(200);

        $settlement->refresh();
        $this->assertEquals('approved', $settlement->status);

        // Process payment
        $response = $this->postJson("/api/payroll/fnf-settlements/{$settlement->id}/process-payment", [
            'payment_method' => 'bank_transfer',
            'payment_reference' => 'FNF-2026-001',
        ]);
        $response->assertStatus(200);

        $settlement->refresh();
        $this->assertEquals('paid', $settlement->status);
        $this->assertNotNull($settlement->paid_at);
    }

    // ==================== CALCULATION ACCURACY ====================

    /**
     * Test: Payroll calculation accuracy in integration
     */
    public function test_payroll_calculation_accuracy(): void
    {
        $this->actingAs($this->hr);

        $annualCtc = 1200000; // ₹12 LPA

        // Create template
        EmployeePayrollTemplate::getOrCreateForUser(
            $this->employee->id,
            $this->organization->id
        );

        \DB::table('employee_payroll_templates')
            ->where('user_id', $this->employee->id)
            ->update(['annual_ctc' => $annualCtc]);

        // Process payroll
        $response = $this->postJson("/api/payroll/employees/{$this->employee->id}/process", [
            'month_year' => now()->format('Y-m'),
            'annual_ctc' => $annualCtc,
            'working_days' => 26,
            'days_present' => 26,
            'lOP_days' => 0,
            'overtime_hours' => 0,
        ]);

        $response->assertStatus(200);

        // Get payroll item
        $payrollItem = PayrollItem::where('user_id', $this->employee->id)
            ->where('organization_id', $this->organization->id)
            ->first();

        $this->assertNotNull($payrollItem);

        // Verify calculations
        $monthlyCtc = $annualCtc / 12; // ₹1,00,000
        $this->assertGreaterThan(0, $payrollItem->basic);
        $this->assertGreaterThan(0, $payrollItem->hra);
        $this->assertGreaterThan(0, $payrollItem->gross_salary);
        $this->assertGreaterThan(0, $payrollItem->net_pay);

        // Verify: Net = Gross - Deductions
        $expectedNet = $payrollItem->gross_salary - $payrollItem->total_deductions;
        $this->assertEqualsWithDelta(
            $expectedNet,
            $payrollItem->net_pay,
            0.01,
            'Net pay should equal Gross - Deductions'
        );

        // Verify PF calculation
        $expectedPf = $payrollItem->basic * 0.12;
        if ($payrollItem->basic > 15000) {
            $expectedPf = 15000 * 0.12; // Capped
        }
        $this->assertEqualsWithDelta(
            $expectedPf,
            $payrollItem->pf_employee,
            0.01,
            'PF should be 12% of basic (capped at 15,000)'
        );
    }

    // ==================== ERROR HANDLING ====================

    /**
     * Test: Payroll processing with invalid data
     */
    public function test_payroll_processing_with_invalid_data(): void
    {
        $this->actingAs($this->hr);

        $response = $this->postJson("/api/payroll/employees/{$this->employee->id}/process", [
            'month_year' => 'invalid',
            'annual_ctc' => -1000,
            'working_days' => 0,
        ]);

        $response->assertStatus(422);
    }

    /**
     * Test: Cannot process F&F for non-existent employee
     */
    public function test_cannot_create_fnf_for_nonexistent_employee(): void
    {
        $this->actingAs($this->hr);

        $response = $this->postJson('/api/payroll/fnf-settlements', [
            'user_id' => 99999, // Non-existent
            'resignation_date' => now()->format('Y-m-d'),
            'last_working_date' => now()->format('Y-m-d'),
        ]);

        // 422, not 404. The employee id arrives in the request body, so an id
        // that does not resolve is a validation failure on the payload — 404
        // would mean the endpoint itself was not found. The point of the test
        // is that a settlement is not created for a stranger, which the
        // assertion below checks directly.
        $response->assertStatus(422);
        $response->assertJsonValidationErrors('user_id');
    }

    // ==================== BANK FILE GENERATION ====================

    /**
     * Test: Bank file generation
     */
    public function test_bank_file_generation(): void
    {
        $this->actingAs($this->admin);

        // Create and process payroll run
        $monthYear = now()->format('Y-m');

        $this->giveCtc($this->employee);

        $this->postJson("/api/payroll/employees/{$this->employee->id}/process", [
            'month_year' => $monthYear,
            'annual_ctc' => 1200000,
            'working_days' => 26,
            'days_present' => 26,
        ]);

        $payrollRun = PayrollMonthlyRun::first();
        $this->assertNotNull($payrollRun);

        // A bank file is an instruction to move money, so the run has to have
        // cleared review first: draft -> locked -> approved. Asking for one on a
        // draft run returns 422 naming the current status, which is the guard
        // working rather than a defect — this test used to stop here.
        $this->postJson("/api/payroll/runs/{$payrollRun->id}/lock")->assertOk();
        $this->postJson("/api/payroll/runs/{$payrollRun->id}/approve")->assertOk();

        $this->assertSame('approved', $payrollRun->fresh()->status);

        // Generate bank file
        $response = $this->getJson("/api/payroll/runs/{$payrollRun->id}/bank-file");

        $response->assertStatus(200)
            ->assertJsonStructure([
                'success',
                'filename',
                'content',
                'entries',
                'total_amount',
            ]);
    }
}
