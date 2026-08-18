<?php

namespace Tests\Feature;

use App\Models\EmployeeBankAccount;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Payroll\PayrollComparisonService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * The detective controls: what changed between two runs, and what looks wrong
 * inside one.
 *
 * These reports have to work on months that can no longer be edited — that is
 * the whole point of them — so every method here is read-only and every test
 * runs against closed runs where it can.
 */
class PayrollComparisonTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private PayrollComparisonService $comparison;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->comparison = app(PayrollComparisonService::class);
    }

    private function payrollRun(string $monthYear, string $status = 'draft'): PayrollMonthlyRun
    {
        return PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => $monthYear,
            'status' => $status,
        ]);
    }

    private function employee(string $name): User
    {
        return User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'name' => $name,
        ]);
    }

    private function item(PayrollMonthlyRun $run, User $user, array $money = []): PayrollItem
    {
        return PayrollItem::create(array_merge([
            'payroll_run_id' => $run->id,
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'month_year' => $run->month_year,
            'basic' => 40000,
            'gross_salary' => 100000,
            'total_deductions' => 12000,
            'net_pay' => 88000,
        ], $money));
    }

    // ------------------------------------------------------------- Differences

    #[Test]
    public function an_unchanged_employee_produces_no_rows(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');
        $alice = $this->employee('Alice');

        $this->item($may, $alice);
        $this->item($june, $alice);

        $result = $this->comparison->compare($may, $june);

        $this->assertSame([], $result['continuing'], 'A month with no change must be silent, or nobody reads the report.');
        $this->assertSame([], $result['totals']);
    }

    #[Test]
    public function a_changed_component_is_reported_with_both_values(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');
        $alice = $this->employee('Alice');

        $this->item($may, $alice, ['net_pay' => 88000]);
        $this->item($june, $alice, ['net_pay' => 91000]);

        $changes = $this->comparison->compare($may, $june)['continuing'][0]['changes'];

        $this->assertSame(88000.0, $changes['net_pay']['from']);
        $this->assertSame(91000.0, $changes['net_pay']['to']);
        $this->assertSame(3000.0, $changes['net_pay']['delta']);
    }

    /**
     * A joiner is not a 100% pay rise and a leaver is not a 100% cut. Reporting
     * them as deltas is how a differences report fills with noise and stops
     * being read — which is the only way it can fail.
     */
    #[Test]
    public function joiners_and_leavers_are_classified_rather_than_shown_as_deltas(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');

        $staying = $this->employee('Staying');
        $leaving = $this->employee('Leaving');
        $joining = $this->employee('Joining');

        $this->item($may, $staying);
        $this->item($may, $leaving);
        $this->item($june, $staying);
        $this->item($june, $joining);

        $result = $this->comparison->compare($may, $june);

        $this->assertSame([], $result['continuing'], 'The one continuing employee did not change.');
        $this->assertCount(1, $result['joiners']);
        $this->assertCount(1, $result['leavers']);
        $this->assertSame('Joining', $result['joiners'][0]['name']);
        $this->assertSame('Leaving', $result['leavers'][0]['name']);
    }

    /**
     * A component that starts at zero has no meaningful percentage. Reporting
     * one would be a division by zero dressed up as information.
     */
    #[Test]
    public function a_component_appearing_from_zero_reports_no_percentage(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');
        $alice = $this->employee('Alice');

        $this->item($may, $alice, ['arrears' => 0]);
        $this->item($june, $alice, ['arrears' => 5000]);

        $changes = $this->comparison->compare($may, $june)['continuing'][0]['changes'];

        $this->assertSame(5000.0, $changes['arrears']['delta']);
        $this->assertNull($changes['arrears']['pct']);
    }

    #[Test]
    public function rounding_dust_is_not_reported_as_a_change(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');
        $alice = $this->employee('Alice');

        $this->item($may, $alice, ['net_pay' => 88000.00]);
        $this->item($june, $alice, ['net_pay' => 88000.004]);

        $this->assertSame([], $this->comparison->compare($may, $june)['continuing']);
    }

    // ---------------------------------------------------------- Presentations

    #[Test]
    public function employee_wise_ranks_by_the_size_of_the_move(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');

        $small = $this->employee('Small');
        $large = $this->employee('Large');

        $this->item($may, $small, ['net_pay' => 88000]);
        $this->item($june, $small, ['net_pay' => 88500]);
        $this->item($may, $large, ['net_pay' => 88000]);
        // A fall, to prove the ranking is on magnitude rather than direction.
        $this->item($june, $large, ['net_pay' => 40000]);

        $ranked = $this->comparison->employeeWise($may, $june);

        $this->assertSame('Large', $ranked[0]['name']);
        $this->assertSame('Small', $ranked[1]['name']);
    }

    #[Test]
    public function consolidated_sums_each_component_across_the_run(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');

        foreach (['A', 'B'] as $name) {
            $employee = $this->employee($name);
            $this->item($may, $employee, ['net_pay' => 88000]);
            $this->item($june, $employee, ['net_pay' => 90000]);
        }

        $rows = collect($this->comparison->consolidated($may, $june))->keyBy('component');

        $this->assertSame(4000.0, $rows['net_pay']['delta'], 'Two employees up 2,000 each.');
    }

    #[Test]
    public function item_wise_returns_one_row_per_changed_component(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');
        $alice = $this->employee('Alice');

        $this->item($may, $alice, ['basic' => 40000, 'net_pay' => 88000]);
        $this->item($june, $alice, ['basic' => 45000, 'net_pay' => 91000]);

        $components = array_column($this->comparison->itemWise($may, $june), 'component');

        $this->assertContains('basic', $components);
        $this->assertContains('net_pay', $components);
    }

    // ----------------------------------------------------------- Negative cost

    /**
     * Net pay is stored signed on purpose — validation stops the run, not a
     * clamp. This report is what makes that policy safe: the negative has to
     * be visible before payday, not discovered in the bank file.
     */
    #[Test]
    public function a_negative_net_pay_is_surfaced_for_review(): void
    {
        $june = $this->payrollRun('2026-06');
        $this->item($june, $this->employee('Overdeducted'), ['net_pay' => -500]);

        $findings = $this->comparison->negativeCost($june);

        $this->assertCount(1, $findings);
        $this->assertSame('net_pay', $findings[0]['component']);
        $this->assertSame('review', $findings[0]['severity']);
    }

    #[Test]
    public function a_negative_earning_is_a_defect_not_a_review_item(): void
    {
        $june = $this->payrollRun('2026-06');
        $this->item($june, $this->employee('Broken'), ['basic' => -100]);

        $findings = collect($this->comparison->negativeCost($june))->keyBy('component');

        $this->assertSame('defect', $findings['basic']['severity']);
    }

    #[Test]
    public function a_healthy_run_reports_no_negative_cost(): void
    {
        $june = $this->payrollRun('2026-06');
        $this->item($june, $this->employee('Fine'));

        $this->assertSame([], $this->comparison->negativeCost($june));
    }

    // ------------------------------------------------------------- Duplicates

    /**
     * The expensive one. Two employee records sharing a bank account pay one
     * human twice, and it looks entirely normal on a headcount report — it only
     * surfaces in the bank file, by which point the transfer has left.
     */
    #[Test]
    public function two_employees_paid_to_the_same_account_are_flagged(): void
    {
        $june = $this->payrollRun('2026-06');

        foreach (['First', 'Second'] as $name) {
            $employee = $this->employee($name);
            $this->item($june, $employee);

            EmployeeBankAccount::create([
                'organization_id' => $this->organization->id,
                'user_id' => $employee->id,
                'account_holder_name' => $name,
                'account_number' => '9999999999',
                'ifsc_swift' => 'HDFC0001234',
                'bank_name' => 'HDFC',
                'is_default' => true,
            ]);
        }

        $findings = collect($this->comparison->duplicates($june))
            ->firstWhere('kind', 'shared_bank_account');

        $this->assertNotNull($findings, 'A shared account must be reported before the bank file is written.');
        $this->assertCount(2, $findings['user_ids']);
    }

    #[Test]
    public function distinct_accounts_are_not_flagged(): void
    {
        $june = $this->payrollRun('2026-06');

        foreach (['First' => '1111111111', 'Second' => '2222222222'] as $name => $account) {
            $employee = $this->employee($name);
            $this->item($june, $employee);

            EmployeeBankAccount::create([
                'organization_id' => $this->organization->id,
                'user_id' => $employee->id,
                'account_holder_name' => $name,
                'account_number' => $account,
                'ifsc_swift' => 'HDFC0001234',
                'bank_name' => 'HDFC',
                'is_default' => true,
            ]);
        }

        $this->assertSame([], $this->comparison->duplicates($june));
    }

    // --------------------------------------------------------- Reconciliation

    #[Test]
    public function headcount_balances_when_joiners_and_leavers_explain_the_change(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');

        $staying = $this->employee('Staying');
        $leaving = $this->employee('Leaving');
        $joining = $this->employee('Joining');

        $this->item($may, $staying);
        $this->item($may, $leaving);
        $this->item($june, $staying);
        $this->item($june, $joining);

        $reconciliation = $this->comparison->reconciliation($may, $june);

        $this->assertSame(2, $reconciliation['headcount_from']);
        $this->assertSame(2, $reconciliation['headcount_to']);
        $this->assertSame(1, $reconciliation['joiners']);
        $this->assertSame(1, $reconciliation['leavers']);
        $this->assertTrue($reconciliation['balances']);
    }

    // ------------------------------------------------------ Works when closed

    /**
     * The reports must work on exactly the months that can no longer be
     * changed. A detective control that only runs on drafts is useless.
     */
    #[Test]
    public function every_report_runs_against_a_disbursed_run(): void
    {
        $may = $this->payrollRun('2026-05');
        $june = $this->payrollRun('2026-06');
        $alice = $this->employee('Alice');

        $this->item($may, $alice, ['net_pay' => 88000]);
        $this->item($june, $alice, ['net_pay' => 91000]);

        $may->update(['status' => 'disbursed']);
        $june->update(['status' => 'disbursed']);

        $this->assertCount(1, $this->comparison->compare($may, $june)['continuing']);
        $this->assertSame([], $this->comparison->negativeCost($june));
        $this->assertSame([], $this->comparison->duplicates($june));
        $this->assertTrue($this->comparison->reconciliation($may, $june)['balances']);
    }
}
