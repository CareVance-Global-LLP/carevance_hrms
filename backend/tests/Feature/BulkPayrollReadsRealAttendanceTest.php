<?php

namespace Tests\Feature;

use App\Jobs\ProcessPayrollRunEmployees;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Support\MonthYear;
use Carbon\CarbonPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * A bulk run must read attendance, not assert it.
 *
 * ProcessPayrollRunEmployees built each sub-request with a literal
 * `'working_days' => 26`, under a comment claiming the value would be
 * "re-derived from attendance inside processEmployeePayroll when not
 * overridden, so 26 is a safe placeholder rather than a figure anyone is paid
 * against."
 *
 * Passing the key IS the override — `$request->filled('working_days')` is true
 * for 26. So the controller took 26, took days_present from the real summary,
 * and derived `LOP = 26 - present_days`. A fully-present employee in a
 * 21-working-day month was docked five days by a placeholder.
 *
 * The second error compounds it. `present_days` deliberately EXCLUDES paid
 * leave and half days — the summary's own total is
 * `present_days + paid_leave_days + half_day_present`. Subtracting present_days
 * alone therefore charges approved paid leave as loss of pay as well.
 *
 * Both are asserted here against the real summary rather than against a fixed
 * number, so the tests stay true in any month.
 */
class BulkPayrollReadsRealAttendanceTest extends TestCase
{
    use RefreshDatabase, BuildsPayrollFixture;

    /** A settled month, so "today" can never be inside it. */
    private string $monthYear = '2026-06';

    protected function setUp(): void
    {
        parent::setUp();

        $this->buildPayrollFixture();
        $this->giveCtc($this->employee);
    }

    /** Every working day of the month, as the summary counts them. */
    private function workingDates(): array
    {
        $dates = [];

        foreach (CarbonPeriod::create(MonthYear::start($this->monthYear), MonthYear::end($this->monthYear)) as $date) {
            if (! $date->isWeekend()) {
                $dates[] = $date->copy();
            }
        }

        return $dates;
    }

    private function markPresent(User $user, array $dates): void
    {
        foreach ($dates as $date) {
            AttendanceRecord::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'attendance_date' => $date->toDateString(),
                'status' => 'present',
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
            ]);
        }
    }

    private function processedItem(): PayrollItem
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

    private function summary(): array
    {
        return app(\App\Services\Attendance\AttendanceService::class)
            ->monthlyAttendanceSummary($this->employee->fresh(), $this->monthYear);
    }

    public function test_a_fully_present_employee_is_not_docked_a_single_day(): void
    {
        $this->markPresent($this->employee, $this->workingDates());

        $item = $this->processedItem();

        $this->assertSame(
            0.0,
            (float) $item->lOP_days,
            'somebody who worked every working day of the month owes no loss of pay'
        );
    }

    public function test_the_working_day_count_comes_from_the_calendar_not_a_literal(): void
    {
        $this->markPresent($this->employee, $this->workingDates());

        $item = $this->processedItem();
        $summary = $this->summary();

        $this->assertSame(
            (float) $summary['working_days'],
            (float) $item->total_working_days,
            'the run must record the month it actually paid, not a placeholder 26'
        );
    }

    public function test_approved_paid_leave_is_not_charged_as_loss_of_pay(): void
    {
        $dates = $this->workingDates();
        $leaveDates = array_slice($dates, 0, 4);
        $workedDates = array_slice($dates, 4);

        $this->markPresent($this->employee, $workedDates);

        LeaveRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'start_date' => $leaveDates[0]->toDateString(),
            'end_date' => $leaveDates[3]->toDateString(),
            'status' => 'approved',
            'leave_type' => 'full_day',
            'leave_category' => 'paid',
            'reason' => 'Approved paid leave',
        ]);

        $item = $this->processedItem();
        $summary = $this->summary();

        $this->assertGreaterThan(0.0, (float) $summary['paid_leave_days'], 'fixture guard: the leave must register as paid');

        $this->assertSame(
            (float) $summary['total_lop_days'],
            (float) $item->lOP_days,
            'loss of pay must be the summary figure, which already excludes paid leave'
        );
    }

    /**
     * Contributory days are what EPFO and ESI are told.
     *
     * `PayrollFilingService::contributoryDays()` reads
     * `days_present + days_leave` off the item. processEmployeePayroll wrote
     * `days_present` and never `days_leave`, so an employee with four days of
     * approved paid leave was PAID for the full month and REPORTED to the
     * statutory returns as having worked four days fewer. The pay was right and
     * the filing was wrong, which is the harder of the two to notice.
     */
    public function test_paid_leave_reaches_the_item_so_contributory_days_are_right(): void
    {
        $dates = $this->workingDates();
        $leaveDates = array_slice($dates, 0, 4);
        $this->markPresent($this->employee, array_slice($dates, 4));

        LeaveRequest::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'start_date' => $leaveDates[0]->toDateString(),
            'end_date' => $leaveDates[3]->toDateString(),
            'status' => 'approved',
            'leave_type' => 'full_day',
            'leave_category' => 'paid',
            'reason' => 'Approved paid leave',
        ]);

        $item = $this->processedItem();
        $summary = $this->summary();

        $this->assertSame(
            (float) $summary['paid_leave_days'],
            (float) $item->days_leave,
            'paid leave must be recorded on the item, not only netted out of LOP'
        );

        $this->assertSame(
            (float) $summary['total_payable_days'],
            (float) $item->days_present + (float) $item->days_leave,
            'present + leave is what the statutory returns report as contributory days'
        );
    }
}
