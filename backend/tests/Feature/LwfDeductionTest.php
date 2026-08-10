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
 * Labour Welfare Fund must actually be withheld.
 *
 * The run generated an LWF return while neither live engine deducted a rupee,
 * so the filing reported contributions that had been taken from nobody.
 */
class LwfDeductionTest extends TestCase
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

    private function employee(string $email, string $state, bool $lwfEnabled): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'email' => $email,
        ]);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'annual_ctc' => 600000,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'pf_enabled' => false,
            'esi_enabled' => false,
            'pt_enabled' => false,
            'tds_enabled' => false,
            'lwf_enabled' => $lwfEnabled,
            'tax_regime' => 'new',
            'pt_state' => $state,
        ]);

        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $date->copy()->endOfMonth();
        for (; $date->lessThanOrEqualTo($end); $date->addDay()) {
            if ($date->isWeekend()) {
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

        return $user;
    }

    private function process(User $user): PayrollItem
    {
        $this->postJson('/api/payroll/employees/'.$user->id.'/process', [
            'month_year' => $this->monthYear,
            'annual_ctc' => 600000,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        return PayrollItem::where('user_id', $user->id)->firstOrFail();
    }

    public function test_lwf_is_withheld_in_a_state_that_levies_it(): void
    {
        $item = $this->process($this->employee('mh@example.com', 'maharashtra', true));

        $this->assertSame(50.0, (float) $item->lwf, 'Maharashtra levies ₹50 a month.');
    }

    public function test_lwf_reaches_the_deduction_total(): void
    {
        $item = $this->process($this->employee('mh2@example.com', 'maharashtra', true));

        $this->assertEqualsWithDelta(
            (float) $item->gross_salary - (float) $item->total_deductions,
            (float) $item->net_pay,
            0.01,
            'A deduction that is not in the total is not really withheld.'
        );
        $this->assertGreaterThanOrEqual(50.0, (float) $item->total_deductions);
    }

    public function test_no_lwf_in_a_state_without_an_act(): void
    {
        // Uttar Pradesh has no Labour Welfare Fund Act.
        $item = $this->process($this->employee('up@example.com', 'uttar_pradesh', true));

        $this->assertSame(0.0, (float) $item->lwf);
    }

    public function test_no_lwf_when_the_state_is_unset(): void
    {
        $item = $this->process($this->employee('none@example.com', '', true));

        $this->assertSame(0.0, (float) $item->lwf, 'An unconfigured state must never be defaulted to one that levies.');
    }

    public function test_no_lwf_when_disabled_on_the_template(): void
    {
        $item = $this->process($this->employee('off@example.com', 'maharashtra', false));

        $this->assertSame(0.0, (float) $item->lwf);
    }
}
