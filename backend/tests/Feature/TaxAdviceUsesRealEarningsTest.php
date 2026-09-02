<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Tax advice computed from zero is not advice.
 *
 * `taxSavingsRecommendation` reads the approved declaration's projected annual
 * gross, and falls back to the employee's CTC when there is none. The fallback
 * never ran, for two independent reasons:
 *
 *   $annualGross = (float) (...);
 *   if ($annualGross === 0) {                      // 0.0 === 0 is FALSE in PHP
 *       $emp = \App\Models\Employee::...           // and this model does not exist
 *   }
 *
 * The strict comparison of a float against an int is never true, so the branch
 * was unreachable — which is the only reason nobody hit the fatal error waiting
 * inside it. Every employee without an approved declaration was told their
 * marginal rate was zero and that no deduction could save them anything.
 *
 * Most employees do not have an approved declaration for most of the year, so
 * this was the normal case, not the edge.
 */
class TaxAdviceUsesRealEarningsTest extends TestCase
{
    use RefreshDatabase;

    private function employeeEarning(float $annualCtc): User
    {
        $organization = Organization::factory()->create();

        $employee = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::getOrCreateForUser($employee->id, $organization->id);

        \DB::table('employee_payroll_templates')
            ->where('user_id', $employee->id)
            ->update(['annual_ctc' => $annualCtc, 'is_active' => true]);

        return $employee;
    }

    public function test_advice_falls_back_to_the_employees_ctc_when_no_declaration_is_approved(): void
    {
        // Well into the taxable range, and no declaration at all.
        $employee = $this->employeeEarning(1800000);

        $response = $this->actingAs($employee)
            ->getJson('/api/payroll/tax-savings/recommendation')
            ->assertOk();

        $savings = collect($response->json('recommendations') ?? $response->json('data.recommendations') ?? [])
            ->pluck('potential_saving')
            ->map(fn ($v) => (float) $v);

        $this->assertGreaterThan(
            0.0,
            $savings->max() ?? 0.0,
            'an employee earning 18 lakh has a non-zero marginal rate, so 80C must be worth something'
        );
    }

    public function test_the_fallback_does_not_reference_a_model_that_does_not_exist(): void
    {
        // Reaching the fallback at all used to fatal on App\Models\Employee.
        // A 200 is the assertion: the branch now runs and survives.
        $employee = $this->employeeEarning(1800000);

        $this->actingAs($employee)
            ->getJson('/api/payroll/tax-savings/recommendation')
            ->assertOk();
    }

    public function test_an_employee_with_no_earnings_on_record_still_gets_a_clean_answer(): void
    {
        $organization = Organization::factory()->create();
        $employee = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'employee',
        ]);

        // No template, no declaration. Zero is the honest answer here, and it
        // must not be an error.
        $this->actingAs($employee)
            ->getJson('/api/payroll/tax-savings/recommendation')
            ->assertOk();
    }
}
