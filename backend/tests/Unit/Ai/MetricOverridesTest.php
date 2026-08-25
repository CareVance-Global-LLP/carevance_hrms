<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\MetricOverrides;
use Tests\TestCase;

/**
 * These assertions ARE the guard on the numbers.
 *
 * Coverage is derived; correctness is curated. Every entry here exists because
 * the derived definition was measurably wrong — so each one is asserted
 * literally, as a whole WHERE array, not smoke-tested for "contains something
 * about net pay". A curated override that quietly loses its exclusion is
 * indistinguishable from having no override at all, and it fails silently: the
 * query still runs and still returns a confident number.
 *
 * Literal assertSame on the whole `where` array is deliberate. assertContains
 * would pass while an extra clause narrowed the population further, which is
 * its own wrong answer.
 */
class MetricOverridesTest extends TestCase
{
    /**
     * Every row of the contract's §11 table, by key. Asserted as presence
     * rather than as an exact key set, because §11's maintenance model is that
     * "the curated set only grows" — a new override must not fail this test.
     */
    public function test_every_section_11_override_is_present(): void
    {
        $all = MetricOverrides::all();

        foreach ([
            'payroll.avg_net_pay',
            'payroll.total_gross',
            'attendance.late_count',
            'leave.leave_days_taken',
            'employees.department',
            'payroll.department',
        ] as $key) {
            $this->assertArrayHasKey($key, $all, "§11 override {$key} is missing");
        }
    }

    // ---------------------------------------------------------------- metrics

    public function test_avg_net_pay_excludes_unprocessed_items(): void
    {
        // Derived is a plain AVG(net_pay) over every row, including items that
        // have been created but not yet processed and still carry net_pay 0.
        // Measured on timetrackpro 24 Aug 2026: including the zeros gives
        // 74,209.09, excluding them 86,577.27. The gap is the whole point of
        // the override — a zero is "not computed yet", not "earned nothing".
        $override = MetricOverrides::all()['payroll.avg_net_pay'];

        $this->assertSame([['payroll_items.net_pay', '>', 0]], $override['where']);
        $this->assertSame('avg', $override['aggregate']);
        $this->assertSame('net_pay', $override['column']);
        $this->assertSame('money', $override['type']);
    }

    public function test_total_gross_excludes_the_same_rows_as_avg_net_pay(): void
    {
        // Gross is filtered on NET pay on purpose. An unprocessed item can
        // carry a real gross_salary with net_pay still 0 — row 7 in the live
        // table does exactly that. Filtering gross > 0 instead would include
        // it, so total_gross and avg_net_pay would describe two different
        // populations and their per-head arithmetic would not reconcile.
        $all = MetricOverrides::all();

        $this->assertSame([['payroll_items.net_pay', '>', 0]], $all['payroll.total_gross']['where']);
        $this->assertSame(
            $all['payroll.avg_net_pay']['where'],
            $all['payroll.total_gross']['where'],
            'gross and net must describe the same population'
        );
        $this->assertSame('sum', $all['payroll.total_gross']['aggregate']);
        $this->assertSame('gross_salary', $all['payroll.total_gross']['column']);
    }

    public function test_late_count_filters_late_minutes_and_never_status(): void
    {
        // Verified 24 Aug 2026: 405 attendance_records have late_minutes > 0,
        // only 271 carry status = 'late'. The other 134 are present or half_day
        // AND late — status and late_minutes answer different questions, and
        // the status one undercounts lateness by a third.
        $override = MetricOverrides::all()['attendance.late_count'];

        $this->assertSame([['attendance_records.late_minutes', '>', 0]], $override['where']);
        $this->assertSame('count', $override['aggregate']);

        foreach ($override['where'] as $clause) {
            $this->assertStringNotContainsString(
                'status',
                $clause[0],
                'late_count must never be defined by status'
            );
        }
    }

    public function test_leave_days_taken_is_approved_only(): void
    {
        // Verified 24 Aug 2026: approved 117, rejected 97, auto_cancelled 92,
        // pending 12 — 318 rows against 117 real ones. Counting every row
        // overstates leave taken by nearly 3x, and auto_cancelled alone is
        // almost as large as rejected.
        $override = MetricOverrides::all()['leave.leave_days_taken'];

        $this->assertSame([['leave_requests.status', '=', 'approved']], $override['where']);

        foreach (['rejected', 'pending', 'auto_cancelled'] as $excluded) {
            $this->assertStringNotContainsString(
                $excluded,
                json_encode($override['where']),
                "leave_days_taken must not admit {$excluded}"
            );
        }
    }

    // ------------------------------------------------------------- dimensions

    public function test_department_dimensions_join_groups(): void
    {
        // There is no departments table. Departments ARE groups, reached by a
        // different FK on each side, which is exactly why derivation gets this
        // wrong: it would render a bare integer id as the department name.
        $all = MetricOverrides::all();

        $this->assertSame(
            ['groups', 'groups.id', '=', 'employee_work_infos.report_group_id'],
            $all['employees.department']['join']
        );
        $this->assertSame(
            ['groups', 'groups.id', '=', 'payroll_items.department_id'],
            $all['payroll.department']['join']
        );

        foreach (['employees.department', 'payroll.department'] as $key) {
            $this->assertSame('groups.name', $all[$key]['select'], "{$key} must select the group name, not an id");
            $this->assertSame('dimension', $all[$key]['kind']);
            $this->assertNotEmpty($all[$key]['null_label'], "{$key} needs a null_label — a hidden group stops a total adding up");
        }
    }

    public function test_department_never_resolves_through_group_user(): void
    {
        // group_user is a separate many-to-many ACCESS grouping. Using it to
        // answer "which department is X in" returns a person once per group
        // they can see, which double-counts headcount and splits payroll.
        foreach (['employees.department', 'payroll.department'] as $key) {
            $this->assertStringNotContainsString(
                'group_user',
                json_encode(MetricOverrides::all()[$key]),
                "{$key} must not resolve a department through the access grouping"
            );
        }
    }

    // ------------------------------------------------------------- invariants

    public function test_every_override_is_marked_curated(): void
    {
        // §12: a derived metric is naive by construction and the answer must
        // say so. An override that reported itself as 'derived' would attach
        // the "no exclusions" caveat to a number that in fact has one.
        foreach (MetricOverrides::all() as $key => $override) {
            $this->assertSame('curated', $override['origin'] ?? null, "{$key} must declare origin curated");
        }
    }

    public function test_every_override_explains_itself(): void
    {
        // The note is surfaced in notes[] so the reader can see what was
        // actually computed. An override with no note is a silent redefinition.
        foreach (MetricOverrides::all() as $key => $override) {
            $this->assertNotEmpty($override['note'] ?? null, "{$key} must carry a note");
            $this->assertIsString($override['note'], "{$key} note must be a string");
        }
    }

    public function test_every_key_is_entity_dot_name(): void
    {
        foreach (MetricOverrides::all() as $key => $override) {
            $this->assertMatchesRegularExpression('/^[a-z_]+\.[a-z_]+$/', $key, "{$key} is not entity.name");
            [$entity, $name] = explode('.', $key, 2);

            $this->assertSame($entity, $override['entity'], "{$key} disagrees with its own entity");
            $this->assertSame($name, $override['name'], "{$key} disagrees with its own name");
        }
    }

    public function test_every_override_declares_which_shape_it_is(): void
    {
        foreach (MetricOverrides::all() as $key => $override) {
            $this->assertContains($override['kind'] ?? null, ['metric', 'dimension'], "{$key} must declare a kind");

            if ($override['kind'] === 'metric') {
                // The shape QueryPlanExecutor consumes. A metric missing any of
                // these merges into the layer and fails at query build time.
                foreach (['label', 'type', 'aggregate', 'column', 'where', 'note'] as $field) {
                    $this->assertArrayHasKey($field, $override, "metric {$key} is missing {$field}");
                }
                $this->assertContains($override['aggregate'], ['avg', 'sum', 'count'], $key);
                $this->assertContains($override['type'], ['money', 'number'], $key);
                $this->assertIsArray($override['where'], $key);
            } else {
                foreach (['label', 'join', 'select', 'type', 'null_label'] as $field) {
                    $this->assertArrayHasKey($field, $override, "dimension {$key} is missing {$field}");
                }
            }
        }
    }

    public function test_every_where_column_is_table_qualified(): void
    {
        // Derivation joins on real foreign keys, so an unqualified `status` is
        // ambiguous the moment an entity is joined to another table carrying
        // one. Postgres raises "column reference is ambiguous"; worse, a
        // dialect that resolves it silently picks a column nobody chose.
        foreach (MetricOverrides::all() as $key => $override) {
            if (($override['kind'] ?? null) !== 'metric') {
                continue;
            }

            foreach ($override['where'] as $clause) {
                $this->assertStringContainsString(
                    '.',
                    $clause[0],
                    "{$key} filters on an unqualified column '{$clause[0]}'"
                );
            }
        }
    }

    public function test_every_where_clause_is_a_column_operator_value_triple(): void
    {
        foreach (MetricOverrides::all() as $key => $override) {
            if (($override['kind'] ?? null) !== 'metric') {
                continue;
            }

            foreach ($override['where'] as $clause) {
                $this->assertIsArray($clause, $key);
                $this->assertCount(3, $clause, "{$key} has a where clause that is not [column, op, value]");
                $this->assertIsString($clause[0], $key);
                $this->assertContains($clause[1], ['=', '!=', '>', '>=', '<', '<=', 'in', 'not in'], $key);
            }
        }
    }

    public function test_no_override_reaches_an_excluded_column(): void
    {
        // §10's exclusion list is global and structural. A curated override is
        // hand-written, which is precisely where it could be forgotten.
        //
        // This matches COLUMN REFERENCES, not the serialised definition. A
        // substring scan over the whole blob reads key names and prose too, so
        // it fails on `span` (contains "pan") and would fail on any note
        // mentioning `designation` (contains "esi") — false alarms that get
        // "fixed" by renaming an innocent field, which teaches the next reader
        // to route around this test rather than trust it. Only `where`,
        // `select`, `join` and `span` become SQL, so only they can leak.
        $exact = ['password', 'remember_token', 'pan', 'uan', 'esi', 'aadhaar',
            'pf_number', 'account_number', 'ifsc', 'api_key', 'google_id'];

        foreach (MetricOverrides::all() as $key => $override) {
            foreach ($this->columnReferences($override) as $reference) {
                // Compare the bare column, so `groups.name` is judged on `name`.
                $column = strtolower(substr(strrchr($reference, '.') ?: ('.' . $reference), 1));

                foreach ($exact as $needle) {
                    $this->assertNotSame($needle, $column, "{$key} reaches excluded column {$reference}");
                }

                $this->assertDoesNotMatchRegularExpression(
                    '/(_token|_secret)$/',
                    $column,
                    "{$key} reaches excluded column {$reference}"
                );
                $this->assertStringStartsNotWith(
                    'bank_account',
                    $column,
                    "{$key} reaches excluded column {$reference}"
                );
            }
        }
    }

    /**
     * Every column an override actually puts into SQL.
     *
     * @return list<string>
     */
    private function columnReferences(array $override): array
    {
        $references = [];

        foreach ($override['where'] ?? [] as $clause) {
            $references[] = $clause[0];
        }

        if (! empty($override['select'])) {
            $references[] = $override['select'];
        }

        if (! empty($override['join'])) {
            // [table, first, operator, second] — both sides are columns.
            $references[] = $override['join'][1];
            $references[] = $override['join'][3];
        }

        foreach ($override['span'] ?? [] as $boundary) {
            $references[] = $boundary;
        }

        // `column` is the aggregate's target and is bare by construction.
        if (! empty($override['column'])) {
            $references[] = $override['column'];
        }

        return $references;
    }

    // ---------------------------------------------------------------- lookups

    public function test_for_entity_returns_metrics_and_dimensions_ready_to_merge(): void
    {
        $payroll = MetricOverrides::forEntity('payroll');

        $this->assertArrayHasKey('avg_net_pay', $payroll['metrics']);
        $this->assertArrayHasKey('total_gross', $payroll['metrics']);
        $this->assertArrayHasKey('department', $payroll['dimensions']);

        // Keyed by bare name, so it array_merges straight over a derived entity.
        $this->assertSame(
            [['payroll_items.net_pay', '>', 0]],
            $payroll['metrics']['avg_net_pay']['where']
        );

        // A dimension must never arrive in the metrics bucket — merged there it
        // would be offered as something measurable and fail at aggregate time.
        $this->assertArrayNotHasKey('department', $payroll['metrics']);
        $this->assertArrayNotHasKey('avg_net_pay', $payroll['dimensions']);
    }

    public function test_for_entity_separates_the_entities(): void
    {
        $this->assertArrayHasKey('late_count', MetricOverrides::forEntity('attendance')['metrics']);
        $this->assertArrayNotHasKey('late_count', MetricOverrides::forEntity('payroll')['metrics']);

        $this->assertArrayHasKey('department', MetricOverrides::forEntity('employees')['dimensions']);
        $this->assertSame(
            ['groups', 'groups.id', '=', 'employee_work_infos.report_group_id'],
            MetricOverrides::forEntity('employees')['dimensions']['department']['join']
        );
    }

    public function test_for_entity_of_an_unknown_entity_returns_both_buckets_empty(): void
    {
        // Never null. The merge site does array_merge on both keys
        // unconditionally, and 80 derived entities have no override at all —
        // making the common case the one that needs a null check is how a
        // derivation pass dies on entity 81.
        $unknown = MetricOverrides::forEntity('nationality');

        $this->assertSame(['metrics' => [], 'dimensions' => []], $unknown);
    }

    public function test_all_is_stable_across_calls(): void
    {
        // Pure data. If this ever stops holding, something has made the
        // catalogue depend on request state, and a cached layer would then
        // serve one tenant's shape to another.
        $this->assertSame(MetricOverrides::all(), MetricOverrides::all());
    }
}
