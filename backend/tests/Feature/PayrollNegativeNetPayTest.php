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
 * Net pay is stored signed.
 *
 * Clamping a negative net to zero with max(0, ...) hides the one case that most
 * needs to stop a run — deductions overrunning gross, from a large recovery or
 * a full month of unpaid leave. Payroll validation and the disbursement
 * exclusion check can only see the problem if the real number survives, and a
 * silent 0 reads as "owed nothing" rather than "this figure is wrong".
 */
class PayrollNegativeNetPayTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;
    private string $monthYear = '2026-06';

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

    /** Present every working day, so LOP plays no part in what follows. */
    private function markPresentAllMonth(): void
    {
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $date->copy()->endOfMonth();

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
        }
    }

    private function processWithDeduction(float $amount): PayrollItem
    {
        $this->markPresentAllMonth();

        $this->postJson('/api/payroll/employees/'.$this->employee->id.'/process', [
            'month_year' => $this->monthYear,
            'annual_ctc' => 600000,
            'custom_deductions' => [
                ['name' => 'Equipment recovery', 'type' => 'fixed', 'value' => $amount],
            ],
        ], $this->apiHeadersFor($this->admin))->assertOk();

        return PayrollItem::where('user_id', $this->employee->id)->firstOrFail();
    }

    public function test_deductions_exceeding_gross_are_stored_as_a_negative_net(): void
    {
        // Gross is ~47,238; recover far more than that.
        $item = $this->processWithDeduction(80000);

        $this->assertLessThan(
            0,
            (float) $item->net_pay,
            'Net pay must stay signed so validation can see deductions overran gross.'
        );
    }

    public function test_negative_net_is_not_silently_zeroed(): void
    {
        $item = $this->processWithDeduction(80000);

        $this->assertNotSame(
            0.0,
            (float) $item->net_pay,
            'A clamped 0 is indistinguishable from "owed nothing" and hides the error.'
        );
    }

    public function test_net_pay_equals_gross_minus_total_deductions(): void
    {
        $item = $this->processWithDeduction(80000);

        $this->assertEqualsWithDelta(
            (float) $item->gross_salary - (float) $item->total_deductions,
            (float) $item->net_pay,
            0.01,
            'Net must remain a plain gross - deductions, with no floor applied.'
        );
    }

    public function test_ordinary_payroll_still_produces_a_positive_net(): void
    {
        $item = $this->processWithDeduction(1000);

        $this->assertGreaterThan(0, (float) $item->net_pay);
    }
}
