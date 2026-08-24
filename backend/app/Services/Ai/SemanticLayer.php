<?php

namespace App\Services\Ai;

use App\Models\Asset;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\PayrollItem;
use App\Models\Task;
use App\Models\User;

/**
 * What AI mode is allowed to be asked about, and what each number MEANS.
 *
 * The model picks a metric by name. It never decides how a number is computed,
 * because the obvious computation is measurably wrong more often than not:
 * AVG(net_pay) over every payroll item returns 76,313.27 where the right answer
 * is 91,575.93, and counting attendance lateness by `status` misses a third of
 * it. Those definitions live here, once, next to the reason.
 *
 * Adding a metric means adding a test that asserts its number against a known
 * fixture. Metrics are payroll code and get payroll care.
 */
final class SemanticLayer
{
    /** @return array<string, array<string, mixed>> */
    public static function entities(): array
    {
        return [
            'employees' => [
                'label' => 'Employees',
                'model' => User::class,
                'metrics' => [
                    'headcount' => [
                        'label' => 'Headcount',
                        'type' => 'number',
                        'aggregate' => 'count',
                        'column' => null,
                        // A no-op today (all 90 rows are 'active') but exit_date
                        // exists and leavers will arrive. A metric that is
                        // accidentally correct is not correct.
                        'where' => [['employee_work_infos.employment_status', '=', 'active']],
                        'note' => null,
                    ],
                ],
                'dimensions' => [
                    'department' => [
                        'label' => 'Department',
                        'join' => ['groups', 'groups.id', '=', 'employee_work_infos.report_group_id'],
                        'select' => 'groups.name',
                        'null_label' => '(unassigned)',
                    ],
                    'employment_type' => [
                        'label' => 'Employment type',
                        'join' => null,
                        'select' => 'employee_work_infos.employment_type',
                        'null_label' => '(not set)',
                    ],
                ],
            ],

            'payroll' => [
                'label' => 'Payroll',
                'model' => PayrollItem::class,
                'metrics' => [
                    'avg_net_pay' => [
                        'label' => 'Avg net pay',
                        'type' => 'money',
                        'aggregate' => 'avg',
                        'column' => 'net_pay',
                        'where' => [['net_pay', '>', 0]],
                        'note' => 'Excludes payroll items not yet processed (net pay 0).',
                    ],
                    'total_gross' => [
                        'label' => 'Total gross',
                        'type' => 'money',
                        'aggregate' => 'sum',
                        'column' => 'gross_salary',
                        'where' => [['net_pay', '>', 0]],
                        'note' => 'Excludes payroll items not yet processed (net pay 0).',
                    ],
                ],
                'dimensions' => [
                    'department' => [
                        'label' => 'Department',
                        'join' => ['groups', 'groups.id', '=', 'payroll_items.department_id'],
                        'select' => 'groups.name',
                        'null_label' => '(no department)',
                    ],
                    'month' => [
                        'label' => 'Month',
                        'join' => null,
                        // YYYY-MM string, not a date. Lexical comparison is safe
                        // for that format and is why range filters work at all.
                        'select' => 'payroll_items.month_year',
                        'null_label' => '(no month)',
                    ],
                ],
            ],

            'attendance' => [
                'label' => 'Attendance',
                'model' => AttendanceRecord::class,
                'metrics' => [
                    'absent_days' => [
                        'label' => 'Absent days',
                        'type' => 'number',
                        'aggregate' => 'count',
                        'column' => null,
                        'where' => [['status', '=', 'absent']],
                        'note' => null,
                    ],
                    'late_count' => [
                        'label' => 'Late arrivals',
                        'type' => 'number',
                        'aggregate' => 'count',
                        'column' => null,
                        // NOT status = 'late'. 405 rows have late_minutes > 0;
                        // only 271 carry the status. The rest are present or
                        // half_day AND late. status and late_minutes answer
                        // different questions.
                        'where' => [['late_minutes', '>', 0]],
                        'note' => 'Counts any record with recorded lateness, including half-days.',
                    ],
                ],
                'dimensions' => [
                    'status' => [
                        'label' => 'Status',
                        'join' => null,
                        'select' => 'attendance_records.status',
                        'null_label' => '(no status)',
                    ],
                    'date' => [
                        'label' => 'Date',
                        'join' => null,
                        'select' => 'attendance_records.attendance_date',
                        'null_label' => '(no date)',
                    ],
                ],
            ],

            'leave' => [
                'label' => 'Leave',
                'model' => LeaveRequest::class,
                'metrics' => [
                    'leave_requests' => [
                        'label' => 'Requests',
                        'type' => 'number',
                        'aggregate' => 'count',
                        'column' => null,
                        'where' => [],
                        'note' => null,
                    ],
                    'leave_days_taken' => [
                        'label' => 'Days taken',
                        'type' => 'number',
                        'aggregate' => 'sum',
                        'column' => null, // computed span; executor handles it
                        // auto_cancelled is 92 of 318 — almost as many as
                        // rejected. Counting every row overstates by ~3x.
                        'where' => [['status', '=', 'approved']],
                        'note' => 'Approved requests only.',
                    ],
                ],
                'dimensions' => [
                    'leave_type' => [
                        'label' => 'Leave type',
                        'join' => null,
                        'select' => 'leave_requests.leave_type',
                        'null_label' => '(not set)',
                    ],
                    'status' => [
                        'label' => 'Status',
                        'join' => null,
                        'select' => 'leave_requests.status',
                        'null_label' => '(no status)',
                    ],
                ],
            ],

            'assets' => [
                'label' => 'Assets',
                'model' => Asset::class,
                'metrics' => [
                    'asset_count' => [
                        'label' => 'Assets',
                        'type' => 'number',
                        'aggregate' => 'count',
                        'column' => null,
                        'where' => [],
                        'note' => null,
                    ],
                ],
                'dimensions' => [
                    'status' => [
                        'label' => 'Status',
                        'join' => null,
                        'select' => 'assets.status',
                        'null_label' => '(no status)',
                    ],
                ],
            ],

            'work' => [
                'label' => 'Tasks',
                'model' => Task::class,
                'metrics' => [
                    'task_count' => [
                        'label' => 'Tasks',
                        'type' => 'number',
                        'aggregate' => 'count',
                        'column' => null,
                        'where' => [],
                        'note' => null,
                    ],
                ],
                'dimensions' => [
                    'status' => [
                        'label' => 'Status',
                        'join' => null,
                        'select' => 'tasks.status',
                        'null_label' => '(no status)',
                    ],
                ],
            ],
        ];
    }

    public static function entity(string $key): ?array
    {
        return self::entities()[$key] ?? null;
    }

    public static function metric(string $entity, string $metric): ?array
    {
        return self::entity($entity)['metrics'][$metric] ?? null;
    }

    public static function dimension(string $entity, string $dimension): ?array
    {
        return self::entity($entity)['dimensions'][$dimension] ?? null;
    }

    /**
     * The catalogue the planner sees. Names and labels only — no rows, no
     * column values, nothing that could carry employee data to the model.
     */
    public static function promptCatalogue(): string
    {
        $lines = [];

        foreach (self::entities() as $key => $entity) {
            $metrics = [];
            foreach ($entity['metrics'] as $metricKey => $metric) {
                $metrics[] = $metricKey . ' (' . $metric['label'] . ')';
            }

            $lines[] = sprintf(
                "- %s: metrics = [%s]; group_by = [%s]",
                $key,
                implode(', ', $metrics),
                implode(', ', array_keys($entity['dimensions']))
            );
        }

        return implode("\n", $lines);
    }
}
