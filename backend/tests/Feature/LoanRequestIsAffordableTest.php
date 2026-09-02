<?php

namespace Tests\Feature;

use App\Jobs\ProcessPayrollRunEmployees;
use App\Models\AttendanceRecord;
use App\Models\EmployeeLoan;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollLoanRecovery;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Support\MonthYear;
use Carbon\CarbonPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The loan path end to end: nothing unlawful gets in, nothing over-recovers.
 */
class LoanRequestIsAffordableTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    protected function setUp(): void
    {
        parent::setUp();
        $this->org = Organization::factory()->create();
    }

    private function earner(float $annualCtc, string $role = 'employee'): User
    {
        $user = User::factory()->create(['organization_id' => $this->org->id, 'role' => $role]);

        EmployeePayrollTemplate::getOrCreateForUser($user->id, $this->org->id);
        \DB::table('employee_payroll_templates')
            ->where('user_id', $user->id)
            ->update(['annual_ctc' => $annualCtc, 'is_active' => true]);

        return $user;
    }

    public function test_an_unaffordable_instalment_is_refused_at_request(): void
    {
        // The real case: ₹98,000 a year cannot carry ₹15,000 a month.
        $employee = $this->earner(98000);

        $response = $this->actingAs($employee)->postJson('/api/payroll/loans/request', [
            'loan_type' => 'loan',
            'amount' => 60000,
            'emi_amount' => 15000,
            'total_installments' => 4,
        ]);

        $response->assertStatus(422);
        $this->assertStringContainsString('Code on Wages', $response->json('message'));
        $this->assertSame(0, EmployeeLoan::count(), 'an unlawful schedule must not be stored at all');
    }

    public function test_an_affordable_instalment_is_accepted(): void
    {
        $employee = $this->earner(1200000);

        $this->actingAs($employee)->postJson('/api/payroll/loans/request', [
            'loan_type' => 'loan',
            'amount' => 40000,
            'emi_amount' => 6000,
            'total_installments' => 4,
        ])->assertOk();

        $this->assertSame(1, EmployeeLoan::count());
    }

    public function test_the_stored_instalment_count_is_derived_not_trusted(): void
    {
        $employee = $this->earner(1200000);

        // The client claims four instalments; ₹40,000 at ₹6,000 is seven.
        $this->actingAs($employee)->postJson('/api/payroll/loans/request', [
            'loan_type' => 'loan',
            'amount' => 40000,
            'emi_amount' => 6000,
            'total_installments' => 4,
        ])->assertOk();

        $this->assertSame(
            7,
            (int) EmployeeLoan::first()->total_installments,
            'four instalments of ₹6,000 would leave ₹16,000 uncollected'
        );
    }

    public function test_the_eligibility_endpoint_reports_the_headroom(): void
    {
        $employee = $this->earner(1200000);

        $response = $this->actingAs($employee)
            ->getJson('/api/payroll/my/loan-eligibility')
            ->assertOk();

        $this->assertTrue($response->json('eligibility.has_salary'));
        $this->assertGreaterThan(0, $response->json('eligibility.max_emi'));
        $this->assertSame(
            round($response->json('eligibility.monthly_gross') * 0.5, 2),
            round($response->json('eligibility.ceiling'), 2)
        );
    }

    public function test_a_final_instalment_never_takes_more_than_is_left(): void
    {
        $employee = $this->earner(1200000);
        $monthYear = '2026-06';

        foreach (CarbonPeriod::create(MonthYear::start($monthYear), MonthYear::end($monthYear)) as $date) {
            if ($date->isWeekend()) {
                continue;
            }
            AttendanceRecord::create([
                'organization_id' => $this->org->id,
                'user_id' => $employee->id,
                'attendance_date' => $date->toDateString(),
                'status' => 'present',
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
            ]);
        }

        // ₹4,000 outstanding against a ₹6,000 instalment.
        $loan = EmployeeLoan::create([
            'organization_id' => $this->org->id,
            'user_id' => $employee->id,
            'loan_type' => 'loan',
            'amount' => 40000,
            'emi_amount' => 6000,
            'total_installments' => 7,
            'paid_installments' => 6,
            'remaining_amount' => 4000,
            'status' => 'approved',
        ]);

        $admin = $this->earner(600000, 'admin');
        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->org->id,
            'month_year' => $monthYear,
            'status' => 'draft',
        ]);

        (new ProcessPayrollRunEmployees($run->id, $this->org->id, $admin->id))
            ->handle(app(\App\Http\Controllers\Api\PayrollDepartmentController::class));

        $recovered = (float) PayrollLoanRecovery::where('employee_loan_id', $loan->id)->sum('amount');

        $this->assertSame(
            4000.0,
            $recovered,
            'the last payment is what is outstanding, not a full instalment'
        );
        $this->assertSame('closed', $loan->fresh()->status);
        $this->assertSame(0.0, (float) $loan->fresh()->remaining_amount);
    }
}
