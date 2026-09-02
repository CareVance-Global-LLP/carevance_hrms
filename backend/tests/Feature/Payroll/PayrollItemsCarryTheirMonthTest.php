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
 * A PAYROLL ITEM HAS TO SAY WHICH MONTH IT IS FOR.
 *
 * `payroll_items.month_year` is denormalised from the run, and quickProcess
 * never wrote it — every row created that way carried NULL. The run itself was
 * correct, so anything reading through the run looked right, and anything
 * reading the items by month found nothing at all.
 *
 * On production, 2 Sep 2026: a locked September run holding six items worth
 * 2,21,685.87 gross, while Payroll → Overview reported "TOTAL PAYROLL Rs 0",
 * "0 employees processed" and "0 / 6". That screen sums processed_count and
 * total_net_pay from /payroll/pay-groups, which filters items by month_year —
 * so the whole month was invisible to it while the dashboard, reading the run,
 * showed the real figure. Two screens, the same month, different answers.
 */
class PayrollItemsCarryTheirMonthTest extends TestCase
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

    public function test_every_item_records_the_month_it_belongs_to(): void
    {
        $this->paidEmployee();
        $this->paidEmployee();

        $run = $this->process('2026-06');

        $items = PayrollItem::where('payroll_run_id', $run->id)->get();

        $this->assertCount(2, $items);

        foreach ($items as $item) {
            $this->assertSame(
                '2026-06',
                $item->month_year,
                'an item with no month is invisible to every screen that filters by it'
            );
        }
    }

    public function test_the_item_month_agrees_with_its_run(): void
    {
        $this->paidEmployee();

        $run = $this->process('2026-06');
        $item = PayrollItem::where('payroll_run_id', $run->id)->firstOrFail();

        // Denormalised, so the only thing that makes it safe is that it cannot
        // disagree with the row it was copied from.
        $this->assertSame($run->month_year, $item->month_year);
    }

    public function test_querying_items_by_month_finds_the_run(): void
    {
        $this->paidEmployee();
        $this->paidEmployee();

        $this->process('2026-06');

        // Exactly what /payroll/pay-groups does, and what returned nothing.
        $found = PayrollItem::where('organization_id', $this->organization->id)
            ->where('month_year', '2026-06')
            ->count();

        $this->assertSame(2, $found, 'the month filter must reach the items it was written for');
    }

    private function process(string $monthYear)
    {
        $this->actingAs($this->admin);

        return app(PayrollAutoProcessService::class)
            ->quickProcess($this->organization->id, $monthYear, $this->admin->id);
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
