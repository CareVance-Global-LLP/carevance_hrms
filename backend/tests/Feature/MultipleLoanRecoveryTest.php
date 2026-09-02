<?php

namespace Tests\Feature;

use App\Jobs\ProcessPayrollRunEmployees;
use App\Models\AttendanceRecord;
use App\Models\EmployeeLoan;
use App\Models\PayrollItem;
use App\Models\PayrollLoanRecovery;
use App\Models\PayrollMonthlyRun;
use App\Support\MonthYear;
use Carbon\CarbonPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * Every approved recovery, not just the first one found.
 *
 * `processEmployeePayroll` located the employee's active loan with
 * `EmployeeLoan::where(...)->first()`, so somebody carrying a loan AND a salary
 * advance had exactly one of them recovered. The other was never deducted, its
 * balance never moved, and nothing anywhere said so — the company simply did
 * not get its money back, month after month, and the employee's advance stayed
 * outstanding for ever.
 *
 * Found by running the seeded scenario: "Lata TwoLoans" had an 8,000 EMI taken
 * and a 6,000 advance ignored, with zero recovery rows against it.
 *
 * Net pay is deliberately NOT clamped when the recoveries exceed it — see
 * CLAUDE.md. Payroll validation is what should stop such a run, and it can only
 * do that if it can see the real number.
 */
class MultipleLoanRecoveryTest extends TestCase
{
    use RefreshDatabase, BuildsPayrollFixture;

    private string $monthYear = '2026-06';

    protected function setUp(): void
    {
        parent::setUp();

        $this->buildPayrollFixture();
        $this->giveCtc($this->employee, 1200000);

        foreach (CarbonPeriod::create(MonthYear::start($this->monthYear), MonthYear::end($this->monthYear)) as $date) {
            if ($date->isWeekend()) {
                continue;
            }

            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $this->employee->id,
                'attendance_date' => $date->toDateString(),
                'status' => 'present',
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
            ]);
        }
    }

    private function giveLoan(string $type, float $amount, float $emi): EmployeeLoan
    {
        return EmployeeLoan::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'loan_type' => $type,
            'amount' => $amount,
            'emi_amount' => $emi,
            'total_installments' => (int) ceil($amount / $emi),
            'paid_installments' => 0,
            'remaining_amount' => $amount,
            'status' => 'approved',
            'approved_at' => now(),
            'disbursed_at' => now(),
        ]);
    }

    private function process(): PayrollItem
    {
        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => $this->monthYear,
            'status' => 'draft',
        ]);

        (new ProcessPayrollRunEmployees($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(\App\Http\Controllers\Api\PayrollDepartmentController::class));

        return PayrollItem::where('payroll_run_id', $run->id)
            ->where('user_id', $this->employee->id)
            ->firstOrFail();
    }

    public function test_both_an_active_loan_and_an_active_advance_are_recovered(): void
    {
        $loan = $this->giveLoan('loan', 100000, 8000);
        $advance = $this->giveLoan('advance', 24000, 6000);

        $this->process();

        $this->assertSame(
            1,
            PayrollLoanRecovery::where('employee_loan_id', $loan->id)->count(),
            'the loan must be recovered'
        );

        $this->assertSame(
            1,
            PayrollLoanRecovery::where('employee_loan_id', $advance->id)->count(),
            'the advance must be recovered too — it is a separate approved commitment'
        );
    }

    public function test_each_balance_moves_by_its_own_emi(): void
    {
        $loan = $this->giveLoan('loan', 100000, 8000);
        $advance = $this->giveLoan('advance', 24000, 6000);

        $this->process();

        $this->assertSame(92000.0, (float) $loan->fresh()->remaining_amount);
        $this->assertSame(18000.0, (float) $advance->fresh()->remaining_amount);
    }

    public function test_reprocessing_the_same_run_does_not_recover_either_twice(): void
    {
        $loan = $this->giveLoan('loan', 100000, 8000);
        $advance = $this->giveLoan('advance', 24000, 6000);

        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => $this->monthYear,
            'status' => 'draft',
        ]);

        foreach (range(1, 2) as $ignored) {
            (new ProcessPayrollRunEmployees($run->id, $this->organization->id, $this->admin->id))
                ->handle(app(\App\Http\Controllers\Api\PayrollDepartmentController::class));
        }

        $this->assertSame(1, PayrollLoanRecovery::where('employee_loan_id', $loan->id)->count());
        $this->assertSame(1, PayrollLoanRecovery::where('employee_loan_id', $advance->id)->count());
        $this->assertSame(92000.0, (float) $loan->fresh()->remaining_amount);
        $this->assertSame(18000.0, (float) $advance->fresh()->remaining_amount);
    }

    public function test_a_final_instalment_closes_only_the_loan_it_belongs_to(): void
    {
        $finishing = $this->giveLoan('loan', 5000, 5000);
        $continuing = $this->giveLoan('advance', 24000, 6000);

        $this->process();

        $this->assertSame('closed', $finishing->fresh()->status);
        $this->assertSame(0.0, (float) $finishing->fresh()->remaining_amount);
        $this->assertSame('approved', $continuing->fresh()->status);
    }
}
