<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Saving an employee payroll card.
 *
 * The update built its payload with array_filter(..., !is_null), so any field
 * sent as null was silently dropped: blanking Annual CTC, or picking "— None —"
 * for the salary template, returned 200 with the old value still in place. The
 * Employee Cards screen then re-rendered the unchanged figure, which read as
 * "the CTC I typed did not save".
 */
class EmployeePayrollCardUpdateTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;

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
    }

    private function updateCard(array $payload)
    {
        return $this->putJson(
            "/api/payroll/employee-cards/{$this->employee->id}",
            $payload,
            $this->apiHeadersFor($this->admin),
        );
    }

    public function test_it_stores_the_annual_ctc(): void
    {
        $this->updateCard(['annual_ctc' => 150500])->assertOk();

        $this->assertSame(
            150500.0,
            (float) EmployeePayrollTemplate::where('user_id', $this->employee->id)->value('annual_ctc'),
        );
    }

    public function test_a_changed_ctc_is_returned_by_the_list_the_screen_reads(): void
    {
        $this->updateCard(['annual_ctc' => 150500])->assertOk();
        $this->updateCard(['annual_ctc' => 154000])->assertOk();

        $response = $this->getJson('/api/payroll/employee-cards', $this->apiHeadersFor($this->admin))
            ->assertOk();

        $row = collect($response->json('employees'))
            ->firstWhere('id', $this->employee->id);

        $this->assertSame(154000.0, (float) $row['annual_ctc']);
    }

    public function test_a_null_annual_ctc_clears_the_stored_value(): void
    {
        $this->updateCard(['annual_ctc' => 600000])->assertOk();

        $this->updateCard(['annual_ctc' => null])->assertOk();

        $this->assertNull(
            EmployeePayrollTemplate::where('user_id', $this->employee->id)->value('annual_ctc'),
        );
    }

    public function test_a_null_salary_template_unassigns_it(): void
    {
        $template = \App\Models\SalaryTemplate::create([
            'organization_id' => $this->organization->id,
            'name' => 'Executive',
            'basic_percentage' => 40,
            'hra_percentage' => 50,
        ]);

        $this->updateCard(['salary_template_id' => $template->id])->assertOk();
        $this->assertSame(
            $template->id,
            EmployeePayrollTemplate::where('user_id', $this->employee->id)->value('salary_template_id'),
        );

        $this->updateCard(['salary_template_id' => null])->assertOk();
        $this->assertNull(
            EmployeePayrollTemplate::where('user_id', $this->employee->id)->value('salary_template_id'),
        );
    }

    public function test_fields_the_request_omits_are_left_alone(): void
    {
        $this->updateCard(['annual_ctc' => 600000, 'pt_state' => 'karnataka'])->assertOk();

        $this->updateCard(['pt_state' => 'delhi'])->assertOk();

        $stored = EmployeePayrollTemplate::where('user_id', $this->employee->id)->first();
        $this->assertSame('delhi', $stored->pt_state);
        $this->assertSame(600000.0, (float) $stored->annual_ctc);
    }
}
