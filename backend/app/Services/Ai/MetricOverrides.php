<?php

namespace App\Services\Ai;

/**
 * Hand-written definitions that BEAT derivation.
 *
 * §9 derives the whole semantic layer from the schema, which is the only way
 * to cover 221 tables and 2,612 columns. Derivation is naive by construction:
 * it sees a numeric column called `net_pay` and offers AVG(net_pay). That is a
 * real query returning a real number, and it is wrong — it averages in payroll
 * items that exist but have not been processed yet and still carry 0. A zero
 * there means "not computed", not "earned nothing", and averaging it in drags
 * the answer down by thousands of rupees per head.
 *
 * So: coverage is derived, correctness is curated. This class is the curated
 * half. Every entry exists because a specific wrong answer was found and
 * measured, and each carries the note that goes into the response so a reader
 * can see which definition produced the number in front of them (§12).
 *
 * THE MAINTENANCE MODEL IS THAT THIS SET ONLY GROWS. An override is added
 * whenever a wrong answer is found; nothing is ever removed to make a test
 * pass. Removing one does not fail loudly — the derived definition silently
 * takes over and the query keeps returning a confident, wrong number.
 *
 * Two shapes live here, told apart by `kind`:
 *   - `metric`    — label, type, aggregate, column, where[], note
 *   - `dimension` — label, join, select, type, null_label, note
 * Both carry `origin => 'curated'`, which is what stops §12 attaching the
 * "no exclusions" caveat to a number that in fact has one.
 *
 * WHERE COLUMNS ARE ALWAYS TABLE-QUALIFIED. Derivation builds joins from real
 * foreign keys, so a bare `status` is ambiguous the moment an entity is joined
 * to another table that also has one. Postgres refuses it outright; a dialect
 * that resolves it silently picks a column nobody chose.
 */
final class MetricOverrides
{
    /**
     * Every override, keyed `entity.name`.
     *
     * @return array<string, array<string, mixed>>
     */
    public static function all(): array
    {
        return [
            /*
             * Measured on timetrackpro, 24 Aug 2026: AVG over every payroll
             * item is 74,209.09; excluding the unprocessed rows it is
             * 86,577.27. The exact figures move as payroll is run — what does
             * not move is the direction, and the reason. An item with net_pay 0
             * has not been computed yet.
             */
            'payroll.avg_net_pay' => [
                'kind' => 'metric',
                'entity' => 'payroll',
                'name' => 'avg_net_pay',
                'label' => 'Avg net pay',
                'type' => 'money',
                'aggregate' => 'avg',
                'column' => 'net_pay',
                'where' => [['payroll_items.net_pay', '>', 0]],
                'origin' => 'curated',
                'note' => 'Excludes payroll items not yet processed (net pay 0).',
            ],

            /*
             * Filtered on NET pay, not on gross. That looks like a copy-paste
             * error and is not: an unprocessed item carries a real
             * gross_salary while net_pay is still 0, so filtering `gross > 0`
             * would keep it. Then total_gross and avg_net_pay would describe
             * two different populations, and dividing one by headcount would
             * not reconcile against the other. The same exclusion on both is
             * what makes the two numbers comparable.
             */
            'payroll.total_gross' => [
                'kind' => 'metric',
                'entity' => 'payroll',
                'name' => 'total_gross',
                'label' => 'Total gross',
                'type' => 'money',
                'aggregate' => 'sum',
                'column' => 'gross_salary',
                'where' => [['payroll_items.net_pay', '>', 0]],
                'origin' => 'curated',
                'note' => 'Excludes payroll items not yet processed (net pay 0) — the same rows as average net pay, so the two reconcile.',
            ],

            /*
             * NOT status = 'late'. Verified 24 Aug 2026: 405 attendance_records
             * have late_minutes > 0 and only 271 carry the status. The other
             * 134 are present or half_day AND late — `status` records what kind
             * of day it was, `late_minutes` records whether the person arrived
             * late, and they are different questions. Defining lateness by
             * status quietly drops a third of it.
             */
            'attendance.late_count' => [
                'kind' => 'metric',
                'entity' => 'attendance',
                'name' => 'late_count',
                'label' => 'Late arrivals',
                'type' => 'number',
                'aggregate' => 'count',
                'column' => null,
                'where' => [['attendance_records.late_minutes', '>', 0]],
                'origin' => 'curated',
                'note' => 'Counts every record with recorded lateness, including half-days — not only those marked late.',
            ],

            /*
             * Verified 24 Aug 2026: approved 117, rejected 97, auto_cancelled
             * 92, pending 12 — 318 rows for 117 real absences. Counting every
             * row overstates leave taken by nearly 3x, and auto_cancelled alone
             * is almost as large as rejected, so this is not a rounding error.
             *
             * The aggregate is a SUM over a span, not a row count: a single
             * five-day request is five days taken, not one. `column` is null on
             * purpose — the span is (end_date - start_date + 1), and the two
             * dialects spell that differently (Postgres subtracts dates
             * directly, SQLite needs julianday), so the executor owns it. The
             * `span` key below names the columns without committing to either
             * dialect; a consumer that does not understand it ignores it.
             */
            'leave.leave_days_taken' => [
                'kind' => 'metric',
                'entity' => 'leave',
                'name' => 'leave_days_taken',
                'label' => 'Days taken',
                'type' => 'number',
                'aggregate' => 'sum',
                'column' => null,
                'span' => ['start' => 'leave_requests.start_date', 'end' => 'leave_requests.end_date'],
                'where' => [['leave_requests.status', '=', 'approved']],
                'origin' => 'curated',
                'note' => 'Approved requests only — excludes rejected, pending and auto-cancelled.',
            ],

            /*
             * There is no departments table. Departments ARE the `groups`
             * table, reached by a different foreign key on each side, which is
             * exactly why derivation cannot get this right: it sees an integer
             * column and offers to group by the raw id, so the answer comes
             * back as "4" instead of a department name.
             *
             * People reach their department through report_group_id.
             * group_user is a separate many-to-many ACCESS grouping and must
             * never be used for this — a person in three groups would be
             * counted three times, so headcount by department would not sum to
             * headcount.
             */
            'employees.department' => [
                'kind' => 'dimension',
                'entity' => 'employees',
                'name' => 'department',
                'label' => 'Department',
                'join' => ['groups', 'groups.id', '=', 'employee_work_infos.report_group_id'],
                'select' => 'groups.name',
                'type' => 'text',
                // Its own row, never hidden. A dropped null group is how a
                // breakdown stops adding up to the total above it.
                'null_label' => '(unassigned)',
                'origin' => 'curated',
                'note' => 'Department is the reporting group; people with no group are shown as (unassigned).',
            ],

            /*
             * Payroll carries its own department stamp rather than reading the
             * employee's current one, so a run keeps the structure it was
             * computed under even after somebody transfers.
             */
            'payroll.department' => [
                'kind' => 'dimension',
                'entity' => 'payroll',
                'name' => 'department',
                'label' => 'Department',
                'join' => ['groups', 'groups.id', '=', 'payroll_items.department_id'],
                'select' => 'groups.name',
                'type' => 'text',
                'null_label' => '(no department)',
                'origin' => 'curated',
                'note' => 'Department as stamped on the payroll item, not the employee current group.',
            ],
        ];
    }

    /**
     * One entity's overrides, split into the two buckets a derived entity
     * merges them into and keyed by bare name:
     *
     *     $entity['metrics']    = array_merge($entity['metrics'], $o['metrics']);
     *     $entity['dimensions'] = array_merge($entity['dimensions'], $o['dimensions']);
     *
     * Both keys are ALWAYS present, even for an entity with no overrides at
     * all. Around 80 derived entities have none, so the no-override case is the
     * common one — returning null there would put the burden of a null check on
     * every merge site and fail on whichever entity someone forgot.
     *
     * @return array{metrics: array<string, array<string, mixed>>, dimensions: array<string, array<string, mixed>>}
     */
    public static function forEntity(string $entity): array
    {
        $buckets = ['metrics' => [], 'dimensions' => []];

        foreach (self::all() as $override) {
            if ($override['entity'] !== $entity) {
                continue;
            }

            $bucket = $override['kind'] === 'metric' ? 'metrics' : 'dimensions';
            $buckets[$bucket][$override['name']] = $override;
        }

        return $buckets;
    }
}
