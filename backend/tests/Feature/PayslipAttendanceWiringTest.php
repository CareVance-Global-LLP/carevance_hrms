<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use App\Services\Payroll\SalaryCalculationService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Payslip generation must read the same attendance everything else does.
 *
 * getAttendance() was a placeholder returning present = every calendar day and
 * paid_leave = 0, which forced lopDays to 0. Those values were persisted as
 * real Payslip rows, so a payslip could never show loss of pay no matter what
 * the employee's attendance said.
 */
class PayslipAttendanceWiringTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private int $payMonth = 6;
    private int $payYear = 2026;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'annual_ctc' => 600000,
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
    }

    /** @param array<int,string> $absentDates */
    private function markPresent(array $absentDates = []): int
    {
        $date = Carbon::create($this->payYear, $this->payMonth, 1)->startOfDay();
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
                'user_id' => $this->employee->id,
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
        $date = Carbon::create($this->payYear, $this->payMonth, 1)->startOfDay();
        while ($date->isWeekend()) {
            $date->addDay();
        }

        return $date;
    }

    private function calculate(): array
    {
        return app(SalaryCalculationService::class)
            ->calculateSalary($this->employee->id, $this->payMonth, $this->payYear);
    }

    public function test_payslip_reflects_an_unpaid_absence(): void
    {
        $this->markPresent([$this->firstWeekday()->toDateString()]);

        $result = $this->calculate();

        $this->assertSame(1.0, (float) $result['attendance']['lop_days'], 'A missed working day must reach the payslip.');
        $this->assertGreaterThan(0, (float) $result['deductions']['lop'], 'It must also be withheld.');
    }

    public function test_full_attendance_produces_no_lop_on_the_payslip(): void
    {
        $this->markPresent();

        $result = $this->calculate();

        $this->assertSame(0.0, (float) $result['attendance']['lop_days']);
        $this->assertSame(0.0, (float) $result['deductions']['lop']);
    }

    public function test_approved_paid_leave_is_not_deducted_on_the_payslip(): void
    {
        $leaveDay = $this->firstWeekday();
        LeaveRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'start_date' => $leaveDay->toDateString(),
            'end_date' => $leaveDay->toDateString(),
            'leave_type' => 'full_day',
            'leave_category' => 'paid',
            'reason' => 'test',
            'status' => 'approved',
        ]);
        $this->markPresent([$leaveDay->toDateString()]);

        $result = $this->calculate();

        $this->assertSame(0.0, (float) $result['attendance']['lop_days'], 'Paid leave is not loss of pay.');
        $this->assertSame(0.0, (float) $result['deductions']['lop']);
    }

    public function test_lop_is_charged_exactly_once(): void
    {
        $this->markPresent([$this->firstWeekday()->toDateString()]);

        $result = $this->calculate();

        // June 2026 has 30 calendar days. The divisor is the wage period, not
        // the working-day count — s.9(2) caps a day's deduction at 1/30.
        $this->assertEqualsWithDelta(
            (float) $result['total_earnings'] / 30,
            (float) $result['deductions']['lop'],
            0.02,
            'One LOP day costs one calendar day of earnings — not pro-rated and deducted twice.'
        );
    }

    public function test_payslip_arithmetic_reconciles(): void
    {
        $this->markPresent([$this->firstWeekday()->toDateString()]);

        $result = $this->calculate();

        $this->assertEqualsWithDelta(
            (float) $result['total_earnings'] - (float) $result['total_deductions'],
            (float) $result['net_payable'],
            0.01
        );
    }
}
