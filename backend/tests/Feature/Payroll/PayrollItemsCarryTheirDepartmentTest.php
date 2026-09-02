<?php

namespace Tests\Feature\Payroll;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\Group;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\User;
use App\Services\PayrollAutoProcessService;
use Carbon\CarbonPeriod;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * A PAYROLL ITEM HAS TO KNOW WHOSE DEPARTMENT IT IS.
 *
 * quickProcess resolved the department like this:
 *
 *     'department_id' => $template->user->employeeWorkInfo->department_id
 *                        ?? $template->user->group_id,
 *
 * Neither column exists. `employee_work_infos` has no `department_id` and
 * `users` has no `group_id` — departments are the `groups` table, joined
 * through the `group_user` pivot. So both sides resolved to null and EVERY
 * payroll item ever written this way carried department_id = NULL.
 *
 * Nothing failed. The run was right, the payslips were right, and the money was
 * right. What broke was every screen that groups payroll BY department:
 * PayrollDepartmentController filters `whereIn('department_id', $groupIds)`,
 * matched nothing, and Payroll → Overview reported "TOTAL PAYROLL Rs 0",
 * "0 employees processed" and "0 / 6" over a locked September run holding six
 * items worth 2,21,685.87 — while the dashboard, which reads the run rather
 * than the items, showed the real figure on the same day.
 */
class PayrollItemsCarryTheirDepartmentTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private Group $recruitment;

    protected function setUp(): void
    {
        parent::setUp();

        Carbon::setTestNow('2026-06-30');

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->recruitment = Group::create([
            'organization_id' => $this->organization->id,
            'name' => 'Recruitment',
        ]);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    public function test_the_item_records_the_department_the_person_belongs_to(): void
    {
        $user = $this->paidEmployee();
        $user->groups()->attach($this->recruitment->id);

        $run = $this->process();
        $item = PayrollItem::where('payroll_run_id', $run->id)->where('user_id', $user->id)->firstOrFail();

        $this->assertSame(
            $this->recruitment->id,
            (int) $item->department_id,
            'the department comes from the group_user pivot, which is where it actually lives'
        );
    }

    public function test_somebody_in_no_department_is_still_paid(): void
    {
        // Akash on production: an admin belonging to no group at all. A null
        // department must stay null rather than block the item being written.
        $user = $this->paidEmployee();

        $run = $this->process();
        $item = PayrollItem::where('payroll_run_id', $run->id)->where('user_id', $user->id)->firstOrFail();

        $this->assertNull($item->department_id);
        $this->assertGreaterThan(0, (float) $item->net_pay);
    }

    public function test_payroll_can_be_grouped_by_department(): void
    {
        $a = $this->paidEmployee();
        $b = $this->paidEmployee();
        $a->groups()->attach($this->recruitment->id);
        $b->groups()->attach($this->recruitment->id);

        $run = $this->process();

        // Exactly the shape PayrollDepartmentController uses, and what returned
        // nothing for every organisation.
        $found = PayrollItem::where('organization_id', $this->organization->id)
            ->whereIn('department_id', [$this->recruitment->id])
            ->count();

        $this->assertSame(2, $found, 'a department filter must reach the items written for it');
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

        foreach (CarbonPeriod::create('2026-06-01', '2026-06-30') as $date) {
            if ($date->isSunday()) {
                continue;
            }

            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'attendance_date' => $date->toDateString(),
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
                'worked_seconds' => 32400,
            ]);
        }

        return $user;
    }
}
