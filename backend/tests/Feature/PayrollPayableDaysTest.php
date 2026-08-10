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
 * Payable days must be derived from the calendar the employee actually worked.
 *
 * "Process & Pay" used to inject a flat working_days = 26 for the whole
 * organization while days_present came from the real ~21-23 day calendar, so
 * LOP was computed as 26 - present and every employee with perfect attendance
 * was docked 3-5 days of pay on every run.
 */
class PayrollPayableDaysTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;
    private string $monthYear = '2026-06';

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create([
            'settings' => ['payroll' => ['pfEnabled' => true, 'esiEnabled' => true, 'ptEnabled' => true]],
        ]);

        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

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

    /** Every working day of the month gets a present record. */
    private function markPresentAllMonth(): int
    {
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $date->copy()->endOfMonth();
        $count = 0;

        for (; $date->lessThanOrEqualTo($end); $date->addDay()) {
            if ($date->isWeekend()) {
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
            $count++;
        }

        return $count;
    }

    public function test_perfect_attendance_through_process_and_pay_has_no_lop(): void
    {
        $workingDays = $this->markPresentAllMonth();

        $this->postJson('/api/payroll/process-and-pay', [
            'month_year' => $this->monthYear,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $item = PayrollItem::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame(
            0.0,
            (float) $item->lOP_days,
            'An employee present every working day must not be docked any LOP.'
        );
        $this->assertSame(
            (float) $workingDays,
            (float) $item->total_working_days,
            'Working days must come from the real calendar, not a flat 26.'
        );
    }

    public function test_perfect_attendance_is_paid_the_full_monthly_gross(): void
    {
        $this->markPresentAllMonth();

        $this->postJson('/api/payroll/process-and-pay', [
            'month_year' => $this->monthYear,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $item = PayrollItem::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame(0.0, (float) $item->lOP_deduction, 'No LOP means no LOP deduction.');

        /*
         * 6,00,000 annual CTC => 50,000 monthly cost to company. Gross is what
         * reaches the payslip, so the employer-side components come out of it:
         *   basic          = 40% of 50,000            = 20,000
         *   employer PF    = 12% of min(basic, 15000) =  1,800
         *   gratuity prov. = 4.81% of basic           =    962
         *   gross          = 50,000 - 1,800 - 962     = 47,238
         * The number that matters here is that it is the *full* month with no
         * pro-ration applied.
         */
        $this->assertEqualsWithDelta(47238.0, (float) $item->gross_salary, 1.0);
    }

    public function test_explicit_working_days_override_is_still_honoured(): void
    {
        // A caller that deliberately states attendance keeps control — the fix
        // removes the *implicit* injection, not the manual override.
        $this->markPresentAllMonth();

        $this->postJson('/api/payroll/employees/'.$this->employee->id.'/process', [
            'month_year' => $this->monthYear,
            'annual_ctc' => 600000,
            'working_days' => 26,
            'days_present' => 20,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $item = PayrollItem::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertSame(6.0, (float) $item->lOP_days, 'An explicit 26/20 override must still yield 6 LOP days.');
    }
}
