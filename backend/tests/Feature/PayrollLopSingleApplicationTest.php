<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Loss of pay must be applied exactly once.
 *
 * The auto-process engine pro-rated the monthly gross by
 * (totalDays - lopDays)/totalDays AND then subtracted a separate lopDeduction
 * computed off that already-reduced gross, so a single LOP day was charged
 * twice. Gross is now the full month and LOP appears once, as an explicit
 * deduction line the payslip can show.
 */
class PayrollLopSingleApplicationTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private string $monthYear = '2026-06';

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
    }

    private function employeeWithCtc(string $email, float $annualCtc = 600000): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'email' => $email,
        ]);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'annual_ctc' => $annualCtc,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'pf_enabled' => true,
            'esi_enabled' => false,
            'pt_enabled' => false,
            'tds_enabled' => false,
            'tax_regime' => 'new',
            'pt_state' => '',
        ]);

        return $user;
    }

    /**
     * @param array<int,string> $absentDates dates deliberately left without a record
     */
    private function markPresent(User $user, array $absentDates = []): int
    {
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $date->copy()->endOfMonth();
        $working = 0;

        for (; $date->lessThanOrEqualTo($end); $date->addDay()) {
            if ($date->isWeekend()) {
                continue;
            }
            $working++;
            if (in_array($date->toDateString(), $absentDates, true)) {
                continue;
            }
            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'attendance_date' => $date->toDateString(),
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
                'worked_seconds' => 8 * 3600,
                'late_minutes' => 0,
                'status' => 'present',
            ]);
        }

        return $working;
    }

    private function firstWeekday(): Carbon
    {
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        while ($date->isWeekend()) {
            $date->addDay();
        }

        return $date;
    }

    private function runAutoProcess(): void
    {
        $this->postJson('/api/payroll/auto/quick-process', [
            'month_year' => $this->monthYear,
        ], $this->apiHeadersFor($this->admin))->assertOk();
    }

    public function test_gross_is_the_full_month_regardless_of_lop(): void
    {
        $present = $this->employeeWithCtc('present@example.com');
        $absent = $this->employeeWithCtc('absent@example.com');

        $this->markPresent($present);
        $this->markPresent($absent, [$this->firstWeekday()->toDateString()]);

        $this->runAutoProcess();

        $presentItem = PayrollItem::where('user_id', $present->id)->firstOrFail();
        $absentItem = PayrollItem::where('user_id', $absent->id)->firstOrFail();

        $this->assertSame(1.0, (float) $absentItem->lOP_days, 'One missed working day is one LOP day.');
        $this->assertEqualsWithDelta(
            (float) $presentItem->gross_salary,
            (float) $absentItem->gross_salary,
            0.01,
            'Gross is the full month for both; LOP is a deduction, not a pro-ration of gross.'
        );
    }

    public function test_lop_deduction_is_exactly_one_days_gross(): void
    {
        $employee = $this->employeeWithCtc('lop@example.com');
        $workingDays = $this->markPresent($employee, [$this->firstWeekday()->toDateString()]);

        $this->runAutoProcess();

        $item = PayrollItem::where('user_id', $employee->id)->firstOrFail();

        $this->assertEqualsWithDelta(
            (float) $item->gross_salary / $workingDays,
            (float) $item->lOP_deduction,
            0.02,
            'One LOP day costs exactly one day of gross — charged once, not twice.'
        );
    }

    public function test_net_pay_reconciles_to_gross_minus_deductions(): void
    {
        $employee = $this->employeeWithCtc('recon@example.com');
        $this->markPresent($employee, [$this->firstWeekday()->toDateString()]);

        $this->runAutoProcess();

        $item = PayrollItem::where('user_id', $employee->id)->firstOrFail();

        $this->assertEqualsWithDelta(
            (float) $item->gross_salary - (float) $item->total_deductions,
            (float) $item->net_pay,
            0.01,
            'The payslip has to add up.'
        );
    }

    public function test_pf_is_computed_on_payable_basic_not_full_basic(): void
    {
        // 3,00,000 CTC => 25,000/month => basic 10,000, which sits below the
        // 15,000 PF ceiling. At 6,00,000 the basic exceeds the ceiling and the
        // cap would mask any LOP effect on PF entirely.
        $present = $this->employeeWithCtc('pf-full@example.com', 300000);
        $absent = $this->employeeWithCtc('pf-lop@example.com', 300000);

        $this->markPresent($present);
        $this->markPresent($absent, [$this->firstWeekday()->toDateString()]);

        $this->runAutoProcess();

        $presentItem = PayrollItem::where('user_id', $present->id)->firstOrFail();
        $absentItem = PayrollItem::where('user_id', $absent->id)->firstOrFail();

        $this->assertLessThan(
            (float) $presentItem->pf_employee,
            (float) $absentItem->pf_employee,
            'PF applies to wages actually earned, so a LOP day must reduce it.'
        );
    }
}
