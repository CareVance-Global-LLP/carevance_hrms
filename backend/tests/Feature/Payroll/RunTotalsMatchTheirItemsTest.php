<?php

namespace Tests\Feature\Payroll;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\User;
use App\Services\PayrollAutoProcessService;
use Carbon\CarbonPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * A RUN HEADER MUST DESCRIBE ITS OWN LINE ITEMS.
 *
 * `payroll_items` carries two grosses on purpose — `gross_salary`, the wage
 * actually earned after loss of pay, and `gross_full_month`, the contracted
 * rate kept alongside so a payslip can show both and arrears have something to
 * work from. The run header accumulated the wrong one:
 *
 *     $totals['total_gross']      += $gross;            // the CONTRACTED month
 *     $totals['total_deductions'] += $totalDeductions;  // actual
 *     $totals['total_net_pay']    += $netPay;           // actual
 *
 * so one header mixed two scales. Measured on production 2 Sep 2026 with six
 * employees: header gross 763,630.83 against line items summing 221,685.87,
 * while deductions and net matched their items to the paisa. The header gross
 * equalled SUM(gross_full_month) exactly — difference 0.00 — which is what
 * identified the line.
 *
 * The cost is not cosmetic. Anyone reading the dashboard subtracts the two
 * numbers in front of them, and 763,630.83 - 8,704.00 is 754,926.83 against a
 * stated net of 212,981.87: out by 541,944.96, on the first screen of the
 * product. It is also why a month could show deductions exceeding gross.
 */
class RunTotalsMatchTheirItemsTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-06-30');

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_the_header_gross_is_the_sum_of_what_was_actually_earned(): void
    {
        // One person present all month, one absent half of it. The gap between
        // the two grosses only opens when somebody loses pay, so a fixture
        // where everybody is fully present cannot see this bug at all.
        $present = $this->paidEmployee();
        $partial = $this->paidEmployee();
        $this->markPresent($present, 30);
        $this->markPresent($partial, 10);

        $run = $this->process();

        $itemsGross = (float) PayrollItem::where('payroll_run_id', $run->id)->sum('gross_salary');

        $this->assertEqualsWithDelta(
            $itemsGross,
            (float) $run->total_gross,
            0.01,
            'the header gross must sum gross_salary, not gross_full_month'
        );
    }

    public function test_gross_minus_deductions_equals_net_on_the_header(): void
    {
        $present = $this->paidEmployee();
        $partial = $this->paidEmployee();
        $this->markPresent($present, 30);
        $this->markPresent($partial, 10);

        $run = $this->process();

        // Exactly the subtraction a person does on the dashboard.
        $this->assertEqualsWithDelta(
            (float) $run->total_net_pay,
            (float) $run->total_gross - (float) $run->total_deductions,
            0.01,
            'gross - deductions must equal net, or the dashboard contradicts itself'
        );
    }

    public function test_deductions_can_never_exceed_the_gross_they_came_from(): void
    {
        $partial = $this->paidEmployee();
        $this->markPresent($partial, 4);

        $run = $this->process();

        $this->assertLessThanOrEqual(
            (float) $run->total_gross,
            (float) $run->total_deductions,
            'a deduction total above gross is the mixed-scale bug resurfacing'
        );
    }

    public function test_the_contracted_month_is_still_recorded_on_each_item(): void
    {
        $partial = $this->paidEmployee();
        $this->markPresent($partial, 10);

        $run = $this->process();
        $item = PayrollItem::where('payroll_run_id', $run->id)->firstOrFail();

        // The fix must not reach for the nearer number by deleting the other
        // one: arrears and the payslip both need the contracted rate, and it
        // should still be the LARGER of the two for somebody who lost pay.
        $this->assertGreaterThan(
            (float) $item->gross_salary,
            (float) $item->gross_full_month,
            'gross_full_month must survive as the contracted rate'
        );
    }

    private function process()
    {
        $this->actingAs($this->admin);

        return app(PayrollAutoProcessService::class)
            ->quickProcess($this->organization->id, '2026-06', $this->admin->id);
    }

    private function paidEmployee(): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'annual_ctc' => 1200000.0,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'medical_allowance' => 0,
            'is_metro_city' => true,
            'is_active' => true,
            'pf_enabled' => true,
            'esi_enabled' => false,
            'pt_enabled' => false,
            'tds_enabled' => false,
            'lwf_enabled' => false,
        ]);

        return $user;
    }

    private function markPresent(User $user, int $days): void
    {
        $marked = 0;

        foreach (CarbonPeriod::create('2026-06-01', '2026-06-30') as $date) {
            if ($marked >= $days) {
                break;
            }

            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'attendance_date' => $date->toDateString(),
                'check_in_at' => $date->copy()->setTime(9, 0),
                'check_out_at' => $date->copy()->setTime(18, 0),
                'worked_seconds' => 32400,
            ]);

            $marked++;
        }
    }
}
