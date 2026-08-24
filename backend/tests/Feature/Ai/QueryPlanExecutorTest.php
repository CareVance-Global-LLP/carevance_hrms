<?php

namespace Tests\Feature\Ai;

use App\Models\Group;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Ai\QueryPlanExecutor;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The executor is the only place a query is built, which makes it the only
 * place tenancy can leak. Both are asserted here.
 */
class QueryPlanExecutorTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;
    private Organization $otherOrg;
    private User $admin;
    private Group $engineering;
    private QueryPlanExecutor $executor;

    /** @var array<string, PayrollMonthlyRun> one run per organization-month */
    private array $runs = [];

    private int $employeeSequence = 0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = Organization::create(['name' => 'Org A', 'slug' => 'org-a']);
        $this->otherOrg = Organization::create(['name' => 'Org B', 'slug' => 'org-b']);

        $this->admin = User::create([
            'name' => 'Admin', 'email' => 'admin-exec@org.test',
            'password' => Hash::make('password123'), 'role' => 'admin',
            'organization_id' => $this->org->id,
        ]);

        $this->engineering = Group::create([
            'organization_id' => $this->org->id, 'name' => 'Engineering', 'slug' => 'engineering',
        ]);

        Auth::setUser($this->admin);
        $this->executor = app(QueryPlanExecutor::class);
    }

    /**
     * payroll_monthly_runs is unique on (organization_id, month_year) and
     * payroll_items on (payroll_run_id, user_id). So a month has exactly ONE
     * run per organization, and each item on it belongs to a different
     * employee — which is what the schema means, not a testing convenience.
     */
    private function payrollItem(int $orgId, ?int $groupId, string $month, string $net): void
    {
        $run = $this->runs[$orgId.'|'.$month] ??= PayrollMonthlyRun::create([
            'organization_id' => $orgId, 'month_year' => $month, 'status' => 'draft',
        ]);

        $this->employeeSequence++;

        $employee = User::create([
            'name' => "Employee {$this->employeeSequence}",
            'email' => "employee-{$this->employeeSequence}-exec@org.test",
            'password' => Hash::make('password123'), 'role' => 'employee',
            'organization_id' => $orgId,
        ]);

        PayrollItem::create([
            'payroll_run_id' => $run->id, 'organization_id' => $orgId,
            'user_id' => $employee->id, 'department_id' => $groupId,
            'month_year' => $month, 'gross_salary' => '100000.00',
            'net_pay' => $net, 'payment_status' => 'pending',
        ]);
    }

    public function test_avg_net_pay_excludes_the_zero_row(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-08', '0.00');

        $result = $this->executor->execute([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'group_by' => 'department', 'filters' => [], 'sort' => null, 'limit' => 20,
        ]);

        $this->assertCount(1, $result['rows']);
        // 90000, not 45000 — the unprocessed row is not averaged in.
        $this->assertEquals(90000.0, (float) $result['rows'][0]['avg_net_pay']);
        $this->assertSame('Engineering', $result['rows'][0]['department']);
    }

    public function test_it_never_returns_another_organizations_rows(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->otherOrg->id, null, '2026-07', '5000000.00');

        $result = $this->executor->execute([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'group_by' => null, 'filters' => [], 'sort' => null, 'limit' => 20,
        ]);

        $this->assertEquals(90000.0, (float) $result['rows'][0]['avg_net_pay']);
    }

    public function test_it_surfaces_the_metric_note_as_a_footnote(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');

        $result = $this->executor->execute([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'group_by' => null, 'filters' => [], 'sort' => null, 'limit' => 20,
        ]);

        $this->assertNotEmpty($result['notes']);
        $this->assertStringContainsString('not yet processed', $result['notes'][0]);
    }

    public function test_an_empty_result_is_empty_rows_not_a_zero_row(): void
    {
        // "Your balance is 0" and "no data exists" are different facts.
        $result = $this->executor->execute([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'group_by' => 'department', 'filters' => [], 'sort' => null, 'limit' => 20,
        ]);

        $this->assertSame([], $result['rows']);
    }

    public function test_columns_carry_the_type_the_ui_formats_by(): void
    {
        $result = $this->executor->execute([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'group_by' => 'department', 'filters' => [], 'sort' => null, 'limit' => 20,
        ]);

        $types = collect($result['columns'])->pluck('type', 'key')->all();
        $this->assertSame('text', $types['department']);
        $this->assertSame('money', $types['avg_net_pay']);
    }

    public function test_truncated_is_reported_rather_than_silently_cutting(): void
    {
        foreach (range(1, 3) as $i) {
            $group = Group::create([
                'organization_id' => $this->org->id, 'name' => "Dept {$i}", 'slug' => "dept-{$i}",
            ]);
            $this->payrollItem($this->org->id, $group->id, '2026-07', '1000.00');
        }

        $result = $this->executor->execute([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'group_by' => 'department', 'filters' => [], 'sort' => null, 'limit' => 2,
        ]);

        $this->assertCount(2, $result['rows']);
        $this->assertTrue($result['truncated']);
    }
}
