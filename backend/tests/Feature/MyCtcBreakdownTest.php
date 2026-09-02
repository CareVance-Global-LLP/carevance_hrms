<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * An employee's own salary structure, and only their own.
 *
 * The HR route `/payroll/employees/{id}/ctc-breakdown` takes a user id, so
 * pointing the mobile app at it would leave the client choosing whose CTC to
 * read. `/payroll/my/ctc-breakdown` derives the id from the token instead —
 * there is no id to tamper with. That is the whole reason the `payroll/my/*`
 * group exists, and this holds the new endpoint to it.
 */
class MyCtcBreakdownTest extends TestCase
{
    use RefreshDatabase;

    private function employeeEarning(Organization $org, float $annualCtc): User
    {
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::getOrCreateForUser($user->id, $org->id);
        \DB::table('employee_payroll_templates')
            ->where('user_id', $user->id)
            ->update(['annual_ctc' => $annualCtc, 'is_active' => true]);

        return $user;
    }

    public function test_an_employee_sees_their_own_structure(): void
    {
        $org = Organization::factory()->create();
        $employee = $this->employeeEarning($org, 1200000);

        $response = $this->actingAs($employee)
            ->getJson('/api/payroll/my/ctc-breakdown')
            ->assertOk();

        $this->assertSame(1200000.0, (float) $response->json('ctc_breakdown.annual_ctc'));
        $this->assertSame(100000.0, (float) $response->json('ctc_breakdown.monthly_ctc'));
        $this->assertSame($employee->id, $response->json('employee.id'));
    }

    public function test_the_response_carries_the_components_a_breakup_needs(): void
    {
        $org = Organization::factory()->create();
        $employee = $this->employeeEarning($org, 900000);

        $response = $this->actingAs($employee)
            ->getJson('/api/payroll/my/ctc-breakdown')
            ->assertOk();

        foreach (['monthly_details', 'annual_details', 'components'] as $key) {
            $this->assertNotNull(
                $response->json("ctc_breakdown.{$key}"),
                "a CTC breakup without {$key} is a single number, not a breakup"
            );
        }
    }

    public function test_it_cannot_be_pointed_at_a_colleague(): void
    {
        $org = Organization::factory()->create();
        $employee = $this->employeeEarning($org, 600000);
        $colleague = $this->employeeEarning($org, 5000000);

        // The endpoint takes no id at all, so the only thing a caller can
        // influence is which token they present.
        $response = $this->actingAs($employee)
            ->getJson('/api/payroll/my/ctc-breakdown?user_id='.$colleague->id)
            ->assertOk();

        $this->assertSame($employee->id, $response->json('employee.id'));
        $this->assertSame(600000.0, (float) $response->json('ctc_breakdown.annual_ctc'));
    }

    public function test_an_employee_with_no_ctc_configured_is_told_so(): void
    {
        $org = Organization::factory()->create();
        $user = User::factory()->create(['organization_id' => $org->id, 'role' => 'employee']);
        EmployeePayrollTemplate::getOrCreateForUser($user->id, $org->id);

        $this->actingAs($user)
            ->getJson('/api/payroll/my/ctc-breakdown')
            ->assertStatus(400)
            ->assertJsonPath('success', false);
    }
}
