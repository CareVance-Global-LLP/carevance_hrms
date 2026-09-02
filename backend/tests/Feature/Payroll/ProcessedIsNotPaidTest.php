<?php

namespace Tests\Feature\Payroll;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayGroup;
use App\Models\PayGroupAssignment;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * PROCESSED AND PAID ARE DIFFERENT QUESTIONS.
 *
 * Two endpoints used the same word for two different things:
 *
 *   PayrollDepartmentController   COUNT(*)                                — an item exists
 *   PayrollFilingController       where('payment_status','!=','pending')  — money has moved
 *
 * The pay-group summary took the second, so Payroll → Run Payroll showed
 * "Processing Progress 0/5" and "5 PENDING" over a LOCKED September run that
 * held a computed payslip for every one of those five people. Nothing was
 * wrong with the payroll; the screen was answering "how many have been paid?"
 * under a heading that asked "how many have been processed?".
 *
 * Processed means the payslip has been calculated. Paid means the money has
 * gone. A run is normally locked and approved for days while every row is
 * processed and none is paid, and that is precisely the window in which
 * somebody looks at this screen.
 */
class ProcessedIsNotPaidTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private PayGroup $group;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->group = PayGroup::create([
            'organization_id' => $this->organization->id,
            'name' => 'Team',
            'code' => 'team',
            'pay_frequency' => 'monthly',
            'is_active' => true,
        ]);
    }

    public function test_a_calculated_payslip_counts_as_processed_before_it_is_paid(): void
    {
        $this->memberWithItem('pending');
        $this->memberWithItem('pending');

        $row = $this->payGroupRow();

        $this->assertSame(2, $row['processed_count'], 'a calculated payslip has been processed');
        $this->assertSame(0, $row['paid_count'], 'and none of it has been paid');
    }

    public function test_paid_is_counted_separately(): void
    {
        $this->memberWithItem('paid');
        $this->memberWithItem('pending');

        $row = $this->payGroupRow();

        $this->assertSame(2, $row['processed_count']);
        $this->assertSame(1, $row['paid_count']);
    }

    public function test_somebody_with_no_payslip_is_not_processed(): void
    {
        $this->memberWithItem('pending');
        $this->member();

        $row = $this->payGroupRow();

        $this->assertSame(2, $row['employee_count']);
        $this->assertSame(1, $row['processed_count'], 'no payslip means not processed');
    }

    public function test_the_net_pay_shown_is_what_was_calculated(): void
    {
        $this->memberWithItem('pending', 40000);
        $this->memberWithItem('pending', 35000);

        $row = $this->payGroupRow();

        // Summing only paid rows meant a locked run worth lakhs displayed Rs 0
        // against a progress bar that also read zero — two tiles agreeing on a
        // number that was never true of the payroll.
        $this->assertEqualsWithDelta(75000.0, $row['total_net_pay'], 0.01);
    }

    private function payGroupRow(): array
    {
        $body = $this->actingAs($this->admin)
            ->getJson('/api/payroll/pay-groups?month_year=2026-06')
            ->assertOk()
            ->json();

        return collect($body['pay_groups'])->firstWhere('id', $this->group->id);
    }

    private function payrollRun(): PayrollMonthlyRun
    {
        return PayrollMonthlyRun::firstOrCreate(
            ['organization_id' => $this->organization->id, 'month_year' => '2026-06'],
            ['status' => 'draft']
        );
    }

    private function member(): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'annual_ctc' => 600000,
            'is_active' => true,
        ]);

        PayGroupAssignment::create([
            'organization_id' => $this->organization->id,
            'pay_group_id' => $this->group->id,
            'user_id' => $user->id,
            'effective_from' => '2026-06-01',
            'is_active' => true,
        ]);

        return $user;
    }

    private function memberWithItem(string $status, float $net = 50000): User
    {
        $user = $this->member();

        PayrollItem::create([
            'organization_id' => $this->organization->id,
            'payroll_run_id' => $this->payrollRun()->id,
            'user_id' => $user->id,
            'month_year' => '2026-06',
            'gross_salary' => $net + 5000,
            'total_deductions' => 5000,
            'net_pay' => $net,
            'payment_status' => $status,
        ]);

        return $user;
    }
}
