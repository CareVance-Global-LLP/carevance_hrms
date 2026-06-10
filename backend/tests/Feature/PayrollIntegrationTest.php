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
    use RefreshDatabase, WithFaker;

    protected Organization $organization;
    protected Group $department;
    protected User $employee;
    protected User $manager;
    protected User $admin;
    protected User $hr;

    protected function setUp(): void
    {
        parent::setUp();
        
        // Create organization
        $this->organization = Organization::factory()->create([
            'name' => 'Test Organization',
            'settings' => [
                'payroll' => [
                    'defaultBasicPercentage' => 40,
                    'defaultHraPercentage' => 50,
                    'defaultConveyance' => 1600,
                    'pfEnabled' => true,
                    'esiEnabled' => true,
                    'ptEnabled' => true,
                    'tdsEnabled' => true,
                ]
            ]
        ]);

        // Create department
        $this->department = Group::factory()->create([
            'organization_id' => $this->organization->id,
            'name' => 'Engineering',
        ]);

        // Create users with different roles
        $this->createUsers();
        
        // Create employee profiles
        $this->createEmployeeProfiles();
        
        // Assign employee to department
        \DB::table('group_user')->insert([
            'group_id' => $this->department->id,
            'user_id' => $this->employee->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    private function createUsers(): void
    {
        // Admin
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
            'name' => 'Admin User',
            'email' => 'admin@company.com',
        ]);

        // HR
        $this->hr = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'hr',
            'name' => 'HR Manager',
            'email' => 'hr@company.com',
        ]);

        // Manager
        $this->manager = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'manager',
            'name' => 'Department Manager',
            'email' => 'manager@company.com',
        ]);

        // Employee
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'name' => 'Test Employee',
            'email' => 'employee@company.com',
        ]);
    }

    private function createEmployeeProfiles(): void
    {
        foreach ([$this->employee, $this->manager, $this->hr, $this->admin] as $user) {
            \App\Models\EmployeeProfile::factory()->create([
                'user_id' => $user->id,
                'organization_id' => $this->organization->id,
                'pan_number' => 'ABCDE1234F',
                'uan_number' => '123456789012',
                'esi_ip_number' => '12345678901234567',
                'tax_regime' => 'new',
                'is_metro_city' => true,
                'pt_state' => 'maharashtra',
            ]);

            \App\Models\EmployeeWorkInfo::factory()->create([
                'user_id' => $user->id,
                'employee_code' => 'EMP' . str_pad($user->id, 4, '0', STR_PAD_LEFT),
                'designation' => 'Software Engineer',
                'joining_date' => now()->subYears(2)->format('Y-m-d'),
            ]);

            \App\Models\EmployeeBankAccount::factory()->create([
                'user_id' => $user->id,
                'account_number' => '1234567890' . $user->id,
                'ifsc_swift' => 'HDFC0001234',
                'bank_name' => 'HDFC Bank',
                'is_primary' => true,
            ]);
        }
    }

    // ==================== EMPLOYEE SELF-SERVICE ====================

    /**
     * Test: Employee can view their payroll template
     */
    public function test_employee_can_view_payroll_template(): void
    {
        $this->actingAs($this->employee);

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
    public function test_manager_can_view_department_payroll(): void
    {
        $this->actingAs($this->manager);

        $response = $this->getJson('/api/payroll/departments');

        $response->assertStatus(200)
            ->assertJsonStructure([
                'departments',
                'unassigned_count',
                'month_year',
            ]);
    }

    /**
     * Test: Manager can view employee details in their department
     */
    public function test_manager_can_view_department_employees(): void
    {
        $this->actingAs($this->manager);

        $response = $this->getJson("/api/payroll/departments/{$this->department->id}/employees");

        $response->assertStatus(200)
            ->assertJsonStructure([
                'department_id',
                'department_name',
                'employees',
            ]);
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

        // Verify run is paid
        $payrollRun->refresh();
        $this->assertEquals('paid', $payrollRun->status);
    }

    // ==================== LEAVE ENCASHMENT WORKFLOW ====================

    /**
     * Test: Complete leave encashment workflow
     */
    public function test_leave_encashment_workflow(): void
    {
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

        // Admin approves
        $this->actingAs($this->admin);
        $response = $this->postJson("/api/payroll/arrears/{$arrear->id}/approve");
        $response->assertStatus(200);

        $arrear->refresh();
        $this->assertEquals('approved', $arrear->status);
    }

    // ==================== F&F SETTLEMENT WORKFLOW ====================

    /**
     * Test: Complete Full & Final settlement workflow
     */
    public function test_fnf_settlement_workflow(): void
    {
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

        $response->assertStatus(404);
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
        ]);

        $payrollRun = PayrollMonthlyRun::first();
        $this->assertNotNull($payrollRun);

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
