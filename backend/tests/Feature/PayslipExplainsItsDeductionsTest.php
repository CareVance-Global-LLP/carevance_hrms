<?php

namespace Tests\Feature;

use App\Jobs\ProcessPayrollRunEmployees;
use App\Models\AttendanceRecord;
use App\Models\EmployeeLoan;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Support\MonthYear;
use Carbon\CarbonPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * A deduction an employee cannot account for is a support ticket.
 *
 * `custom_deductions` stored one number. Somebody carrying a loan and a salary
 * advance had 14,000 taken and no way to learn from their payslip that it was
 * 8,000 of one and 6,000 of the other — and because wizard-entered deductions
 * land in the same total, it could not be decomposed after the fact either.
 *
 * The breakdown existed in the process response and was discarded when the
 * request ended. It is now stored on the row, so the payslip can answer the
 * question months later.
 */
class PayslipExplainsItsDeductionsTest extends TestCase
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

    public function test_each_recovery_is_stored_as_its_own_named_line(): void
    {
        $this->giveLoan('loan', 100000, 8000);
        $this->giveLoan('advance', 24000, 6000);

        $lines = collect($this->process()->deduction_lines ?? []);

        $this->assertCount(2, $lines, 'a loan and an advance are two deductions, not one');

        $this->assertEqualsCanonicalizing(
            ['Loan EMI', 'Advance EMI'],
            $lines->pluck('label')->all(),
            'each line must say which commitment it belongs to'
        );

        $this->assertEqualsCanonicalizing(
            [8000.0, 6000.0],
            $lines->pluck('amount')->map(fn ($a) => (float) $a)->all()
        );
    }

    public function test_the_lines_add_up_to_the_stored_total(): void
    {
        $this->giveLoan('loan', 100000, 8000);
        $this->giveLoan('advance', 24000, 6000);

        $item = $this->process();

        $this->assertSame(
            (float) $item->custom_deductions,
            (float) collect($item->deduction_lines ?? [])->sum('amount'),
            'a breakdown that does not reconcile to the total is worse than none'
        );
    }

    public function test_a_line_carries_the_balance_left_so_the_employee_can_see_the_end(): void
    {
        $this->giveLoan('loan', 100000, 8000);

        $line = collect($this->process()->deduction_lines ?? [])->firstWhere('label', 'Loan EMI');

        $this->assertNotNull($line);
        $this->assertSame(92000.0, (float) $line['remaining']);
    }

    public function test_an_employee_with_no_recoveries_stores_no_lines(): void
    {
        $item = $this->process();

        $this->assertEmpty(
            $item->deduction_lines ?? [],
            'an empty breakdown is right when there is nothing to break down'
        );
    }
}
