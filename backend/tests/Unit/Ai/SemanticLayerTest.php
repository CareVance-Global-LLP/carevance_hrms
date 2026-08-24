<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\SemanticLayer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The metric definitions ARE the product. A wrong one produces a confident
 * wrong number, which is the single failure mode this design exists to
 * prevent — so they are asserted literally, not smoke-tested.
 *
 * RefreshDatabase: entities() now derives from the real schema.
 */
class SemanticLayerTest extends TestCase
{
    use RefreshDatabase;

    public function test_avg_net_pay_excludes_unprocessed_items(): void
    {
        $metric = SemanticLayer::metric('payroll', 'avg_net_pay');

        $this->assertSame('avg', $metric['aggregate']);
        $this->assertSame('net_pay', $metric['column']);
        // Table-qualified: MetricOverrides supersedes the entity's own
        // unqualified where clause now that derivation can join other
        // tables onto the same query, where a bare `net_pay` would be
        // ambiguous.
        $this->assertContains(['payroll_items.net_pay', '>', 0], $metric['where']);
        $this->assertNotNull($metric['note']);
    }

    public function test_late_count_uses_late_minutes_not_status(): void
    {
        // 405 attendance_records have late_minutes > 0 but only 271 carry
        // status = 'late'. Defining lateness by status undercounts by 33%.
        $metric = SemanticLayer::metric('attendance', 'late_count');

        $this->assertContains(['attendance_records.late_minutes', '>', 0], $metric['where']);

        foreach ($metric['where'] as $clause) {
            $this->assertNotSame('status', $clause[0], 'late_count must not filter on status');
        }
    }

    public function test_leave_days_taken_counts_only_approved(): void
    {
        // approved 117 / rejected 97 / auto_cancelled 92 / pending 12 —
        // counting every row overstates leave taken by nearly 3x.
        $metric = SemanticLayer::metric('leave', 'leave_days_taken');

        $this->assertContains(['leave_requests.status', '=', 'approved'], $metric['where']);
    }

    public function test_department_dimension_joins_groups_not_a_departments_table(): void
    {
        // There is no departments table and no employee_work_infos.department
        // column. Departments ARE the groups table.
        $dimension = SemanticLayer::dimension('payroll', 'department');

        $this->assertSame(['groups', 'groups.id', '=', 'payroll_items.department_id'], $dimension['join']);
        $this->assertSame('groups.name', $dimension['select']);
    }

    public function test_people_reach_their_department_through_report_group_id(): void
    {
        // group_user is a separate many-to-many access grouping and must never
        // be used to answer "which department is X in".
        $dimension = SemanticLayer::dimension('employees', 'department');

        $this->assertSame(
            ['groups', 'groups.id', '=', 'employee_work_infos.report_group_id'],
            $dimension['join']
        );
        $this->assertStringNotContainsString('group_user', json_encode($dimension));
    }

    public function test_unknown_entity_returns_null(): void
    {
        $this->assertNull(SemanticLayer::entity('nationality'));
        $this->assertNull(SemanticLayer::metric('payroll', 'avg_bonus_percentage'));
        $this->assertNull(SemanticLayer::dimension('employees', 'blood_group'));
    }

    public function test_prompt_catalogue_lists_every_entity_and_names_every_curated_metric(): void
    {
        // Curated metrics are listed by NAME — a planner has to pick one by
        // name, and their definitions are hand-verified rather than obvious
        // from the column. Derived metrics are compressed to a pattern
        // instead of enumerated (SemanticLayerDerivationTest pins the budget
        // that compression exists to protect), so a derived metric's own
        // compound key is deliberately NOT required here.
        $catalogue = SemanticLayer::promptCatalogue();

        foreach (SemanticLayer::entities() as $key => $entity) {
            $this->assertStringContainsString($key, $catalogue);

            foreach ($entity['metrics'] as $metric => $definition) {
                if (($definition['origin'] ?? null) !== 'curated') {
                    continue;
                }

                $this->assertStringContainsString($metric, $catalogue, "{$key}.{$metric} is curated and must be named");
            }
        }
    }

    public function test_no_entity_exposes_a_statutory_identifier_or_secret(): void
    {
        // The planner prompt is built from these strings and goes to a cloaked
        // pre-release model. Nothing identifying may be reachable through them.
        //
        // Matched on word boundaries, not substring: "designation" contains
        // "esi" and is a job title, not an identifier — the ~80 derived
        // entities now genuinely expose columns like it, so a plain substring
        // scan flags real, harmless columns. SchemaIntrospector::isExcludedColumn()
        // already proves the same guarantee by word; this asserts it from the
        // consumer side, the same way SchemaIntrospectorTest does.
        $forbidden = ['password', 'pan', 'uan', 'esi', 'account', 'ifsc'];

        foreach (SemanticLayer::entities() as $entityKey => $entity) {
            foreach ($entity['dimensions'] as $dimensionKey => $dimension) {
                $tokens = preg_split('/[^a-z0-9]+/', strtolower($dimension['select']), -1, PREG_SPLIT_NO_EMPTY);

                foreach ($forbidden as $needle) {
                    $this->assertNotContains(
                        $needle,
                        $tokens,
                        "{$entityKey}.{$dimensionKey} exposes {$needle}"
                    );
                }
            }
        }
    }

    public function test_every_metric_declares_the_shape_the_executor_relies_on(): void
    {
        foreach (SemanticLayer::entities() as $entityKey => $entity) {
            foreach ($entity['metrics'] as $metricKey => $metric) {
                $where = "{$entityKey}.{$metricKey}";

                $this->assertArrayHasKey('label', $metric, $where);
                $this->assertContains($metric['type'], ['money', 'number'], $where);
                // min/max join derivation's own allowed set (SchemaIntrospectorTest)
                // now that entities() carries the ~80 derived tables alongside
                // the curated ones.
                $this->assertContains($metric['aggregate'], ['avg', 'sum', 'count', 'min', 'max'], $where);
                $this->assertIsArray($metric['where'], $where);

                // A sum/avg/min/max with no column is a query the executor cannot build.
                if (in_array($metric['aggregate'], ['avg', 'sum', 'min', 'max'], true) && $metricKey !== 'leave_days_taken') {
                    $this->assertNotNull($metric['column'], "{$where} aggregates but names no column");
                }
            }
        }
    }
}
