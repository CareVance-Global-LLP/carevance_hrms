<?php

namespace Tests\Feature\Ai;

use App\Models\AttendanceRecord;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Ai\PlanValidator;
use App\Services\Ai\QueryPlanExecutor;
use App\Services\Ai\UnsupportedQuestionException;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The executor is the only place a query is built, which makes it the only
 * place tenancy can leak and the only place a wrong number can be produced
 * from a right plan. Both are asserted here.
 *
 * EVERY plan below is put through `PlanValidator` first, deliberately. The
 * executor's contract is the validator's canonical §1 output — mode,
 * `metrics[]`, `columns[]`, `group_by[]`, operator `filters[]`, `having[]`,
 * `sort{by,dir}` — and a test that hand-builds a plan shape the validator
 * never emits is a test of a contract nobody has.
 *
 * @see docs/superpowers/specs/2026-08-24-ai-mode-grammar-v2.md §6
 */
class QueryPlanExecutorTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;
    private Organization $otherOrg;
    private User $admin;
    private Group $engineering;
    private Group $marketing;
    private QueryPlanExecutor $executor;
    private PlanValidator $validator;

    /** @var array<string, PayrollMonthlyRun> one run per organization-month */
    private array $runs = [];

    private int $sequence = 0;

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
        $this->marketing = Group::create([
            'organization_id' => $this->org->id, 'name' => 'Marketing', 'slug' => 'marketing',
        ]);

        Auth::setUser($this->admin);

        $this->executor = app(QueryPlanExecutor::class);
        $this->validator = app(PlanValidator::class);
    }

    // ------------------------------------------------------------- fixtures

    private function person(int $orgId, string $name, array $work = []): User
    {
        $this->sequence++;

        $user = User::create([
            'name' => $name,
            'email' => "person-{$this->sequence}-exec@org.test",
            'password' => Hash::make('password123'), 'role' => 'employee',
            'organization_id' => $orgId,
        ]);

        EmployeeWorkInfo::create(array_merge([
            'organization_id' => $orgId,
            'user_id' => $user->id,
            'employment_status' => 'active',
        ], $work));

        return $user;
    }

    /**
     * payroll_monthly_runs is unique on (organization_id, month_year) and
     * payroll_items on (payroll_run_id, user_id). So a month has exactly ONE
     * run per organization, and each item on it belongs to a different
     * employee — which is what the schema means, not a testing convenience.
     */
    private function payrollItem(
        int $orgId,
        ?int $groupId,
        string $month,
        string $net,
        string $gross = '100000.00'
    ): void {
        $run = $this->runs[$orgId.'|'.$month] ??= PayrollMonthlyRun::create([
            'organization_id' => $orgId, 'month_year' => $month, 'status' => 'draft',
        ]);

        $employee = $this->person($orgId, "Payroll person {$this->sequence}");

        PayrollItem::create([
            'payroll_run_id' => $run->id, 'organization_id' => $orgId,
            'user_id' => $employee->id, 'department_id' => $groupId,
            'month_year' => $month, 'gross_salary' => $gross,
            'net_pay' => $net, 'payment_status' => 'pending',
        ]);
    }

    private function attendance(User $person, string $date, string $status, int $lateMinutes = 0): void
    {
        AttendanceRecord::create([
            'organization_id' => $person->organization_id,
            'user_id' => $person->id,
            'attendance_date' => $date,
            'status' => $status,
            'late_minutes' => $lateMinutes,
        ]);
    }

    /** @param array<string, mixed> $raw */
    private function answer(array $raw): array
    {
        return $this->executor->execute($this->validator->validate($raw));
    }

    /** @return list<mixed> the values of one column, in row order */
    private function column(array $result, string $key): array
    {
        return array_map(fn (array $row) => $row[$key], $result['rows']);
    }

    private function assertNoteContaining(array $result, string $needle): void
    {
        foreach ($result['notes'] as $note) {
            if (str_contains($note, $needle)) {
                $this->assertTrue(true);

                return;
            }
        }

        $this->fail("No note contained '{$needle}'. Notes: ".json_encode($result['notes']));
    }

    // --------------------------------------------------------------- numbers

    public function test_avg_net_pay_excludes_the_zero_row(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-08', '0.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['department'],
        ]);

        $this->assertCount(1, $result['rows']);
        // 90000, not 45000 — the unprocessed row is not averaged in.
        $this->assertEquals(90000.0, (float) $result['rows'][0]['avg_net_pay']);
        $this->assertSame('Engineering', $result['rows'][0]['department']);
    }

    /**
     * The exclusion belongs to the METRIC, not to the query. Two metrics with
     * different exclusions in one plan have to keep them apart, or asking for
     * both silently changes one of them.
     */
    public function test_each_metric_keeps_its_own_exclusion(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-08', '0.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['count', 'avg_net_pay'], 'group_by' => ['department'],
        ]);

        $this->assertCount(1, $result['rows']);
        // count sees both rows; avg_net_pay sees only the processed one.
        $this->assertEquals(2, (int) $result['rows'][0]['count']);
        $this->assertEquals(90000.0, (float) $result['rows'][0]['avg_net_pay']);
    }

    /**
     * A department whose payroll is all unprocessed is a department that
     * exists. Dropping it makes the breakdown stop adding up; showing it as
     * ₹0 says everyone there earned nothing. Neither is true — nothing was
     * measured, and null is how a table says that.
     */
    public function test_a_group_with_nothing_to_measure_is_null_not_zero(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, $this->marketing->id, '2026-07', '0.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['department'],
            'sort' => ['by' => 'department', 'dir' => 'asc'],
        ]);

        $this->assertSame(['Engineering', 'Marketing'], $this->column($result, 'department'));
        $this->assertEquals(90000.0, (float) $result['rows'][0]['avg_net_pay']);
        $this->assertNull($result['rows'][1]['avg_net_pay']);
    }

    public function test_leave_days_taken_sums_the_span_and_only_the_approved(): void
    {
        $person = $this->person($this->org->id, 'Leave taker');

        LeaveRequest::create([
            'organization_id' => $this->org->id, 'user_id' => $person->id,
            'start_date' => '2026-07-01', 'end_date' => '2026-07-05',
            'status' => 'approved', 'leave_type' => 'casual',
        ]);
        LeaveRequest::create([
            'organization_id' => $this->org->id, 'user_id' => $person->id,
            'start_date' => '2026-07-10', 'end_date' => '2026-07-19',
            'status' => 'auto_cancelled', 'leave_type' => 'casual',
        ]);

        $result = $this->answer([
            'entity' => 'leave', 'metrics' => ['leave_days_taken'], 'group_by' => ['leave_type'],
        ]);

        // Five days, not one row and not fifteen days.
        $this->assertEquals(5, (int) $result['rows'][0]['leave_days_taken']);
    }

    // -------------------------------------------------------------- tenancy

    public function test_a_plan_run_as_one_organization_returns_no_row_from_another(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->otherOrg->id, null, '2026-07', '5000000.00');

        $result = $this->answer(['entity' => 'payroll', 'metrics' => ['avg_net_pay']]);

        $this->assertCount(1, $result['rows']);
        $this->assertEquals(90000.0, (float) $result['rows'][0]['avg_net_pay']);
    }

    /**
     * `employees` is the entity whose declared model is `User`, and `User`
     * deliberately carries no `BelongsToOrganization` — the scope resolves the
     * acting user through Auth instead. Basing the query on it would read
     * every tenant's people through a question anyone can ask in English, so
     * the base has to be the scoped table underneath.
     */
    public function test_listing_employees_never_reaches_another_organization(): void
    {
        $this->person($this->org->id, 'Ours', ['joining_date' => '2026-03-01']);
        $this->person($this->otherOrg->id, 'Theirs', ['joining_date' => '2026-03-01']);

        $result = $this->answer([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
        ]);

        $this->assertSame(['Ours'], $this->column($result, 'name'));
    }

    public function test_counting_employees_never_counts_another_organization(): void
    {
        $this->person($this->org->id, 'Ours');
        $this->person($this->otherOrg->id, 'Theirs');
        $this->person($this->otherOrg->id, 'Theirs too');

        $result = $this->answer(['entity' => 'employees', 'metrics' => ['headcount']]);

        $this->assertEquals(1, (int) $result['rows'][0]['headcount']);
    }

    // ------------------------------------------- "no records" is not "zero"

    public function test_an_empty_aggregate_is_empty_rows_not_a_zero_row(): void
    {
        // "Your headcount is 0" and "no data exists" are different facts, and
        // only one of them is ever true. This is the shape of the defect that
        // answered "list employees who joined this year" with `count: 0`.
        $result = $this->answer(['entity' => 'employees', 'metrics' => ['headcount']]);

        $this->assertSame([], $result['rows']);
    }

    public function test_an_empty_grouped_aggregate_is_empty_rows(): void
    {
        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['department'],
        ]);

        $this->assertSame([], $result['rows']);
    }

    public function test_an_empty_row_listing_is_empty_rows(): void
    {
        $result = $this->answer([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
        ]);

        $this->assertSame([], $result['rows']);
    }

    /**
     * The defect itself, end to end at this layer: the true answer is a list
     * of people, and the wrong answer it produced was a single row saying 0.
     */
    public function test_listing_employees_who_joined_this_year_lists_them(): void
    {
        $thisYear = CarbonImmutable::now()->startOfYear()->addMonth();
        $lastYear = CarbonImmutable::now()->startOfYear()->subMonth();

        $this->person($this->org->id, 'Joined recently', ['joining_date' => $thisYear->toDateString()]);
        $this->person($this->org->id, 'Also joined recently', ['joining_date' => $thisYear->addDay()->toDateString()]);
        $this->person($this->org->id, 'Joined before', ['joining_date' => $lastYear->toDateString()]);

        $result = $this->answer([
            'entity' => 'employees', 'mode' => 'list',
            'columns' => ['name', 'joining_date'],
            'filters' => [['field' => 'joining_date', 'op' => 'period', 'value' => 'this_year']],
            'sort' => ['by' => 'name', 'dir' => 'asc'],
        ]);

        $this->assertSame(
            ['Also joined recently', 'Joined recently'],
            $this->column($result, 'name')
        );
    }

    // ------------------------------------------------------------- §2 operators

    public function test_contains_escapes_the_like_wildcards(): void
    {
        $this->person($this->org->id, 'Anita Sharma');
        $this->person($this->org->id, 'Ravi Kumar');

        $matches = $this->answer([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'filters' => [['field' => 'name', 'op' => 'contains', 'value' => 'sharma']],
        ]);
        $this->assertSame(['Anita Sharma'], $this->column($matches, 'name'));

        // A bare '%' is a wildcard until it is escaped, and an unescaped one
        // returns the whole table — the search-box table dump, arriving
        // through a question instead.
        $wildcard = $this->answer([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'filters' => [['field' => 'name', 'op' => 'contains', 'value' => '%']],
        ]);
        $this->assertSame([], $wildcard['rows']);

        $underscore = $this->answer([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'filters' => [['field' => 'name', 'op' => 'contains', 'value' => 'a_i']],
        ]);
        $this->assertSame([], $underscore['rows']);
    }

    public function test_eq_and_neq(): void
    {
        $person = $this->person($this->org->id, 'Attendee');
        $this->attendance($person, '2026-07-01', 'absent');
        $this->attendance($person, '2026-07-02', 'present');

        $equal = $this->answer([
            'entity' => 'attendance', 'metrics' => ['count'],
            'filters' => [['field' => 'status', 'op' => 'eq', 'value' => 'absent']],
        ]);
        $this->assertEquals(1, (int) $equal['rows'][0]['count']);

        $notEqual = $this->answer([
            'entity' => 'attendance', 'metrics' => ['count'],
            'filters' => [['field' => 'status', 'op' => 'neq', 'value' => 'absent']],
        ]);
        $this->assertEquals(1, (int) $notEqual['rows'][0]['count']);
    }

    public function test_the_numeric_comparisons_and_between(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '40000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-08', '60000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-09', '90000.00');

        $cases = [
            ['gt', 60000, 1],
            ['gte', 60000, 2],
            ['lt', 60000, 1],
            ['lte', 60000, 2],
        ];

        foreach ($cases as [$op, $value, $expected]) {
            $result = $this->answer([
                'entity' => 'payroll', 'metrics' => ['count'],
                'filters' => [['field' => 'net_pay', 'op' => $op, 'value' => $value]],
            ]);

            $this->assertEquals($expected, (int) $result['rows'][0]['count'], $op);
        }

        $between = $this->answer([
            'entity' => 'payroll', 'metrics' => ['count'],
            'filters' => [['field' => 'net_pay', 'op' => 'between', 'value' => [50000, 90000]]],
        ]);
        $this->assertEquals(2, (int) $between['rows'][0]['count']);
    }

    public function test_in_and_not_in(): void
    {
        $person = $this->person($this->org->id, 'Attendee');
        $this->attendance($person, '2026-07-01', 'absent');
        $this->attendance($person, '2026-07-02', 'half_day');
        $this->attendance($person, '2026-07-03', 'present');

        $in = $this->answer([
            'entity' => 'attendance', 'metrics' => ['count'],
            'filters' => [['field' => 'status', 'op' => 'in', 'value' => ['absent', 'half_day']]],
        ]);
        $this->assertEquals(2, (int) $in['rows'][0]['count']);

        $notIn = $this->answer([
            'entity' => 'attendance', 'metrics' => ['count'],
            'filters' => [['field' => 'status', 'op' => 'not_in', 'value' => ['absent', 'half_day']]],
        ]);
        $this->assertEquals(1, (int) $notIn['rows'][0]['count']);
    }

    public function test_is_null_and_is_not_null(): void
    {
        $this->person($this->org->id, 'Dated', ['joining_date' => '2026-03-01']);
        $this->person($this->org->id, 'Undated');

        $missing = $this->answer([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'filters' => [['field' => 'joining_date', 'op' => 'is_null']],
        ]);
        $this->assertSame(['Undated'], $this->column($missing, 'name'));

        $present = $this->answer([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'filters' => [['field' => 'joining_date', 'op' => 'is_not_null']],
        ]);
        $this->assertSame(['Dated'], $this->column($present, 'name'));
    }

    // ----------------------------------------------------------- §3 periods

    /**
     * `payroll_items.month_year` is a `YYYY-MM` STRING. A `Y-m-d` bound
     * against it matches nothing at all — `'2026-07' >= '2026-07-01'` is false
     * — so the naive comparison does not return the wrong rows, it returns an
     * empty table and calls it an answer.
     */
    public function test_a_period_on_a_month_column_compares_in_the_columns_own_format(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-08', '70000.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['total_gross'], 'group_by' => ['month'],
            'filters' => [['field' => 'month', 'op' => 'period', 'value' => '2026-07']],
        ]);

        $this->assertSame(['2026-07'], $this->column($result, 'month'));
    }

    /**
     * A window that straddles two months still covers both of them once it is
     * expressed in a month column's granularity.
     */
    public function test_a_period_spanning_two_months_keeps_both(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-06', '10000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '20000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-08', '30000.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['count'], 'group_by' => ['month'],
            'filters' => [[
                'field' => 'month', 'op' => 'period', 'value' => '2026-07-15..2026-08-10',
            ]],
            'sort' => ['by' => 'month', 'dir' => 'asc'],
        ]);

        $this->assertSame(['2026-07', '2026-08'], $this->column($result, 'month'));
    }

    public function test_a_period_on_a_date_column_covers_whole_days(): void
    {
        $person = $this->person($this->org->id, 'Attendee');
        $this->attendance($person, '2026-06-30', 'absent');
        $this->attendance($person, '2026-07-01', 'absent');
        $this->attendance($person, '2026-07-31', 'absent');
        $this->attendance($person, '2026-08-01', 'absent');

        $result = $this->answer([
            'entity' => 'attendance', 'metrics' => ['absent_days'],
            'filters' => [['field' => 'date', 'op' => 'period', 'value' => '2026-07']],
        ]);

        // Both boundary days are inside the period, neither neighbour is.
        $this->assertEquals(2, (int) $result['rows'][0]['absent_days']);
    }

    public function test_the_resolved_period_is_reported_so_the_reader_sees_it(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['total_gross'],
            'filters' => [['field' => 'month', 'op' => 'period', 'value' => '2026-07']],
        ]);

        $this->assertNoteContaining($result, 'July 2026');
    }

    /**
     * §3's refusal, at this layer. `payment_status` is text; a date range
     * compared against 'pending' matches nothing, and an empty table beside a
     * plan that says "this year" is a confident wrong answer.
     */
    public function test_a_period_on_a_field_that_is_not_a_date_is_refused_by_name(): void
    {
        $this->expectException(UnsupportedQuestionException::class);
        $this->expectExceptionMessageMatches('/payment_status/');

        $this->answer([
            'entity' => 'payroll', 'metrics' => ['count'],
            'filters' => [['field' => 'payment_status', 'op' => 'period', 'value' => 'this_year']],
        ]);
    }

    // ------------------------------------------------------------- §1 having

    public function test_having_keeps_only_the_groups_above_the_threshold(): void
    {
        $often = $this->person($this->org->id, 'Often absent');
        $rarely = $this->person($this->org->id, 'Rarely absent');

        foreach (['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-06'] as $date) {
            $this->attendance($often, $date, 'absent');
        }
        foreach (['2026-07-01', '2026-07-02'] as $date) {
            $this->attendance($rarely, $date, 'absent');
        }

        $result = $this->answer([
            'entity' => 'attendance', 'metrics' => ['absent_days'], 'group_by' => ['employee'],
            'filters' => [['field' => 'date', 'op' => 'period', 'value' => '2026-07']],
            'having' => [['metric' => 'absent_days', 'op' => 'gt', 'value' => 3]],
            'sort' => ['by' => 'absent_days', 'dir' => 'desc'],
        ]);

        $this->assertSame(['Often absent'], $this->column($result, 'employee'));
        $this->assertEquals(4, (int) $result['rows'][0]['absent_days']);
    }

    public function test_having_applies_to_the_aggregate_the_plan_computed(): void
    {
        // The exclusion inside avg_net_pay has to be inside the HAVING too, or
        // the threshold is applied to a different number than the one shown.
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-08', '0.00');
        $this->payrollItem($this->org->id, $this->marketing->id, '2026-07', '20000.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['department'],
            'having' => [['metric' => 'avg_net_pay', 'op' => 'gte', 'value' => 50000]],
        ]);

        $this->assertSame(['Engineering'], $this->column($result, 'department'));
    }

    // ------------------------------------------------------- §6 presentation

    public function test_a_null_dimension_value_gets_its_own_labelled_row(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, null, '2026-07', '10000.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['count'], 'group_by' => ['department'],
            'sort' => ['by' => 'department', 'dir' => 'asc'],
        ]);

        // A hidden group is how a total stops adding up.
        $this->assertSame(['(no department)', 'Engineering'], $this->column($result, 'department'));
        $this->assertEquals(1, (int) $result['rows'][0]['count']);
    }

    public function test_two_group_by_dimensions_produce_a_row_per_pair(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-08', '80000.00');
        $this->payrollItem($this->org->id, $this->marketing->id, '2026-07', '60000.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['department', 'month'],
            'sort' => ['by' => 'department', 'dir' => 'asc'],
        ]);

        $this->assertCount(3, $result['rows']);
        $this->assertSame(
            ['department', 'month', 'avg_net_pay'],
            array_column($result['columns'], 'key')
        );
    }

    public function test_columns_carry_the_type_the_ui_formats_by(): void
    {
        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay', 'count'], 'group_by' => ['department'],
        ]);

        $types = collect($result['columns'])->pluck('type', 'key')->all();
        $this->assertSame('text', $types['department']);
        $this->assertSame('money', $types['avg_net_pay']);
        $this->assertSame('number', $types['count']);
    }

    public function test_a_row_listing_shows_the_named_columns_and_no_others(): void
    {
        $this->person($this->org->id, 'Listed', [
            'joining_date' => '2026-03-01', 'report_group_id' => $this->engineering->id,
        ]);

        $result = $this->answer([
            'entity' => 'employees', 'mode' => 'list',
            'columns' => ['name', 'department', 'joining_date'],
        ]);

        $this->assertSame(
            ['name', 'department', 'joining_date'],
            array_column($result['columns'], 'key')
        );
        $this->assertSame(['name', 'department', 'joining_date'], array_keys($result['rows'][0]));
        $this->assertSame('Listed', $result['rows'][0]['name']);
        $this->assertSame('Engineering', $result['rows'][0]['department']);
    }

    public function test_sort_and_limit_keep_the_top_of_the_order(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, $this->marketing->id, '2026-07', '60000.00');

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['department'],
            'sort' => ['by' => 'avg_net_pay', 'dir' => 'desc'], 'limit' => 1,
        ]);

        $this->assertSame(['Engineering'], $this->column($result, 'department'));
        $this->assertTrue($result['truncated']);
    }

    public function test_truncated_is_reported_rather_than_silently_cutting(): void
    {
        foreach (range(1, 3) as $i) {
            $group = Group::create([
                'organization_id' => $this->org->id, 'name' => "Dept {$i}", 'slug' => "dept-{$i}",
            ]);
            $this->payrollItem($this->org->id, $group->id, '2026-07', '1000.00');
        }

        $result = $this->answer([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['department'], 'limit' => 2,
        ]);

        $this->assertCount(2, $result['rows']);
        $this->assertTrue($result['truncated']);
    }

    public function test_a_listing_inside_the_limit_is_not_reported_truncated(): void
    {
        $this->person($this->org->id, 'Only one');

        $result = $this->answer([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'], 'limit' => 5,
        ]);

        $this->assertCount(1, $result['rows']);
        $this->assertFalse($result['truncated']);
    }

    // ------------------------------------------------------------- §12 notes

    public function test_the_note_says_which_definition_produced_the_number(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');

        $result = $this->answer(['entity' => 'payroll', 'metrics' => ['avg_net_pay']]);

        $this->assertNotEmpty($result['notes']);
        $this->assertStringContainsString('not yet processed', $result['notes'][0]);
    }

    public function test_a_curated_metric_without_a_note_still_states_its_definition(): void
    {
        $person = $this->person($this->org->id, 'Attendee');
        $this->attendance($person, '2026-07-01', 'absent');

        $result = $this->answer(['entity' => 'attendance', 'metrics' => ['absent_days']]);

        $this->assertNoteContaining($result, 'absent_days');
    }

    /**
     * §12: a derived aggregate excludes nothing by construction, so when its
     * input holds zeros the answer has to say how many it counted. That is the
     * ₹76,313 failure caught at read time instead of shipped.
     */
    public function test_a_derived_aggregate_reports_the_zero_inputs_it_included(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-08', '0.00');

        $result = $this->answer(['entity' => 'payroll', 'metrics' => ['sum_net_pay']]);

        $this->assertEquals(90000.0, (float) $result['rows'][0]['sum_net_pay']);
        $this->assertNoteContaining($result, 'no exclusions');
        $this->assertNoteContaining($result, 'sum_net_pay included');
    }

    public function test_a_derived_aggregate_over_clean_input_carries_no_zero_note(): void
    {
        $this->payrollItem($this->org->id, $this->engineering->id, '2026-07', '90000.00');

        $result = $this->answer(['entity' => 'payroll', 'metrics' => ['sum_net_pay']]);

        foreach ($result['notes'] as $note) {
            $this->assertStringNotContainsString('included', $note);
        }
    }

    /**
     * Measured on timetrackpro, 24 Aug 2026: 31 APPROVED leave requests end
     * before they start, and `leave_days_taken` faithfully summed them to
     * MINUS 234 days. The definition is right and the rows are wrong, and a
     * bare "-234" tells the reader neither.
     */
    public function test_a_span_metric_says_how_many_rows_run_backwards(): void
    {
        $person = $this->person($this->org->id, 'Leave taker');

        LeaveRequest::create([
            'organization_id' => $this->org->id, 'user_id' => $person->id,
            'start_date' => '2026-07-01', 'end_date' => '2026-07-05',
            'status' => 'approved', 'leave_type' => 'casual',
        ]);
        LeaveRequest::create([
            'organization_id' => $this->org->id, 'user_id' => $person->id,
            'start_date' => '2026-07-10', 'end_date' => '2026-06-27',
            'status' => 'approved', 'leave_type' => 'casual',
        ]);
        // Not approved, so it is not part of the number and not part of the
        // census either — a caveat about rows the metric never saw is noise.
        LeaveRequest::create([
            'organization_id' => $this->org->id, 'user_id' => $person->id,
            'start_date' => '2026-07-20', 'end_date' => '2026-06-01',
            'status' => 'rejected', 'leave_type' => 'casual',
        ]);

        $result = $this->answer(['entity' => 'leave', 'metrics' => ['leave_days_taken']]);

        $this->assertNoteContaining($result, 'leave_days_taken counted 1 of 2 rows');
    }

    public function test_a_span_metric_over_sane_rows_carries_no_caveat(): void
    {
        $person = $this->person($this->org->id, 'Leave taker');

        LeaveRequest::create([
            'organization_id' => $this->org->id, 'user_id' => $person->id,
            'start_date' => '2026-07-01', 'end_date' => '2026-07-05',
            'status' => 'approved', 'leave_type' => 'casual',
        ]);

        $result = $this->answer(['entity' => 'leave', 'metrics' => ['leave_days_taken']]);

        foreach ($result['notes'] as $note) {
            $this->assertStringNotContainsString('before its start date', $note);
        }
    }

    public function test_the_plan_is_not_mutated_by_execution(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['department'],
        ]);
        $before = json_encode($plan);

        $this->executor->execute($plan);

        $this->assertSame($before, json_encode($plan));
    }
}
