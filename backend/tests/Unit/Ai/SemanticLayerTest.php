<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\SemanticLayer;
use Tests\TestCase;

/**
 * The metric definitions ARE the product. A wrong one produces a confident
 * wrong number, which is the single failure mode this design exists to
 * prevent — so they are asserted literally, not smoke-tested.
 */
class SemanticLayerTest extends TestCase
{
    public function test_avg_net_pay_excludes_unprocessed_items(): void
    {
        $metric = SemanticLayer::metric('payroll', 'avg_net_pay');

        $this->assertSame('avg', $metric['aggregate']);
        $this->assertSame('net_pay', $metric['column']);
        $this->assertContains(['net_pay', '>', 0], $metric['where']);
        $this->assertNotNull($metric['note']);
    }

    public function test_late_count_uses_late_minutes_not_status(): void
    {
        // 405 attendance_records have late_minutes > 0 but only 271 carry
        // status = 'late'. Defining lateness by status undercounts by 33%.
        $metric = SemanticLayer::metric('attendance', 'late_count');

        $this->assertContains(['late_minutes', '>', 0], $metric['where']);

        foreach ($metric['where'] as $clause) {
            $this->assertNotSame('status', $clause[0], 'late_count must not filter on status');
        }
    }

    public function test_leave_days_taken_counts_only_approved(): void
    {
        // approved 117 / rejected 97 / auto_cancelled 92 / pending 12 —
        // counting every row overstates leave taken by nearly 3x.
        $metric = SemanticLayer::metric('leave', 'leave_days_taken');

        $this->assertContains(['status', '=', 'approved'], $metric['where']);
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

    public function test_prompt_catalogue_lists_every_entity_and_metric(): void
    {
        $catalogue = SemanticLayer::promptCatalogue();

        foreach (SemanticLayer::entities() as $key => $entity) {
            $this->assertStringContainsString($key, $catalogue);

            foreach (array_keys($entity['metrics']) as $metric) {
                $this->assertStringContainsString($metric, $catalogue);
            }
        }
    }

    public function test_no_entity_exposes_a_statutory_identifier_or_secret(): void
    {
        // The planner prompt is built from these strings and goes to a cloaked
        // pre-release model. Nothing identifying may be reachable through them.
        $forbidden = ['password', 'pan', 'uan', 'esi', 'account_number', 'ifsc'];

        foreach (SemanticLayer::entities() as $entityKey => $entity) {
            foreach ($entity['dimensions'] as $dimensionKey => $dimension) {
                foreach ($forbidden as $needle) {
                    $this->assertStringNotContainsString(
                        $needle,
                        strtolower($dimension['select']),
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
                $this->assertContains($metric['aggregate'], ['avg', 'sum', 'count'], $where);
                $this->assertIsArray($metric['where'], $where);

                // A sum or avg with no column is a query the executor cannot build.
                if (in_array($metric['aggregate'], ['avg', 'sum'], true) && $metricKey !== 'leave_days_taken') {
                    $this->assertNotNull($metric['column'], "{$where} aggregates but names no column");
                }
            }
        }
    }
}
