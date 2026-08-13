<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Authorization around the employee-facing payroll surface.
 *
 * Two opposite defects lived here. Endpoints an employee is *meant* to use —
 * their own payslip, a loan request, tax advice — sat behind role:admin,manager
 * and 403'd the only people who reach them. Meanwhile the whole billing surface
 * had no role gate at all, so any authenticated employee could cancel the
 * organisation's plan.
 */
class PayrollSelfServiceAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;
    private User $otherEmployee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
        $this->otherEmployee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
    }

    // ── Billing must be admin-only ────────────────────────────────────────

    public function test_employee_cannot_cancel_the_organisations_plan(): void
    {
        $this->postJson('/api/billing/cancel-plan', [], $this->apiHeadersFor($this->employee))
            ->assertForbidden();
    }

    public function test_employee_cannot_reduce_seats(): void
    {
        $this->postJson('/api/billing/reduce-seats', ['seats' => 1], $this->apiHeadersFor($this->employee))
            ->assertForbidden();
    }

    public function test_employee_cannot_upgrade_the_plan(): void
    {
        $this->postJson('/api/billing/upgrade', ['plan_code' => 'pro'], $this->apiHeadersFor($this->employee))
            ->assertForbidden();
    }

    public function test_manager_cannot_cancel_the_organisations_plan(): void
    {
        $manager = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'manager',
        ]);

        $this->postJson('/api/billing/cancel-plan', [], $this->apiHeadersFor($manager))
            ->assertForbidden();
    }

    public function test_admin_still_reaches_billing(): void
    {
        // Any status other than 403 proves the gate lets an admin through; the
        // endpoint's own behaviour is covered elsewhere.
        $this->getJson('/api/billing/current', $this->apiHeadersFor($this->admin))
            ->assertOk();
    }

    // ── Employee self-service must not 403 ────────────────────────────────

    public function test_employee_can_request_a_loan(): void
    {
        $this->postJson('/api/payroll/loans/request', [
            'loan_type' => 'advance',
            'amount' => 10000,
            'emi_amount' => 2000,
            'total_installments' => 5,
        ], $this->apiHeadersFor($this->employee))->assertOk();
    }

    /**
     * The borrower is the caller, whatever user_id an employee sends.
     *
     * Without this, letting admins pass user_id would have handed every
     * employee a way to raise a loan in a colleague's name.
     */
    public function test_employee_cannot_raise_a_loan_in_someone_elses_name(): void
    {
        $this->postJson('/api/payroll/loans/request', [
            'loan_type' => 'advance',
            'amount' => 10000,
            'emi_amount' => 2000,
            'total_installments' => 5,
            'user_id' => $this->otherEmployee->id,
        ], $this->apiHeadersFor($this->employee))->assertOk();

        $this->assertDatabaseHas('employee_loans', [
            'user_id' => $this->employee->id,
            'amount' => 10000,
        ]);
        $this->assertDatabaseMissing('employee_loans', [
            'user_id' => $this->otherEmployee->id,
        ]);
    }

    public function test_admin_can_raise_a_loan_on_behalf_of_an_employee(): void
    {
        $this->postJson('/api/payroll/loans/request', [
            'loan_type' => 'loan',
            'amount' => 50000,
            'emi_amount' => 5000,
            'total_installments' => 10,
            'user_id' => $this->otherEmployee->id,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $this->assertDatabaseHas('employee_loans', [
            'user_id' => $this->otherEmployee->id,
            'organization_id' => $this->organization->id,
            'amount' => 50000,
        ]);
    }

    public function test_admin_cannot_raise_a_loan_for_another_organisations_employee(): void
    {
        $otherOrg = Organization::factory()->create();
        $outsider = User::factory()->create([
            'organization_id' => $otherOrg->id,
            'role' => 'employee',
        ]);

        $this->postJson('/api/payroll/loans/request', [
            'loan_type' => 'loan',
            'amount' => 50000,
            'emi_amount' => 5000,
            'total_installments' => 10,
            'user_id' => $outsider->id,
        ], $this->apiHeadersFor($this->admin))->assertNotFound();

        $this->assertDatabaseMissing('employee_loans', [
            'user_id' => $outsider->id,
        ]);
    }

    public function test_employee_can_get_tax_savings_advice(): void
    {
        $this->getJson('/api/payroll/tax-savings/recommendation', $this->apiHeadersFor($this->employee))
            ->assertOk();
    }

    public function test_employee_can_run_hra_optimisation(): void
    {
        $this->postJson('/api/payroll/hra-optimization', [
            'basic_salary' => 20000,
            'hra_received' => 10000,
            'rent_paid' => 12000,
        ], $this->apiHeadersFor($this->employee))->assertOk();
    }

    // ── ...but self-service must stay self-scoped ─────────────────────────

    public function test_employee_cannot_download_a_colleagues_payslip(): void
    {
        $this->getJson(
            '/api/payroll/payslip/'.$this->otherEmployee->id.'/2026-06/download',
            $this->apiHeadersFor($this->employee)
        )->assertForbidden();
    }

    public function test_employee_cannot_view_a_colleagues_payslip(): void
    {
        $this->getJson(
            '/api/payroll/payslip/'.$this->otherEmployee->id.'/2026-06/view',
            $this->apiHeadersFor($this->employee)
        )->assertForbidden();
    }

    public function test_employee_reaching_their_own_payslip_is_not_forbidden(): void
    {
        // 404 (no payslip for that month) is the correct answer here; 403 is not.
        $this->getJson(
            '/api/payroll/payslip/'.$this->employee->id.'/2026-06/download',
            $this->apiHeadersFor($this->employee)
        )->assertNotFound();
    }

    public function test_admin_can_still_reach_any_employees_payslip(): void
    {
        $this->getJson(
            '/api/payroll/payslip/'.$this->employee->id.'/2026-06/download',
            $this->apiHeadersFor($this->admin)
        )->assertNotFound();
    }
}
