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
 *
 * A metric may also carry, all optional and all honoured by
 * `QueryPlanExecutor`: `span` (a day count instead of a column), `cap` (clip
 * each row's value before aggregating, matching a read-time normalisation the
 * screens already apply), `scale` (a divisor, seconds to hours), `round` (the
 * decimal places the answer is stated to), and — for `aggregate => 'rate'` —
 * `numerator`, the extra clauses that narrow `where` into the top half of a
 * percentage. A key this class does not know is ignored, so `where`, `select`,
 * `join`, `span`, `numerator`, `cap` and `scale` are the only ones that become
 * SQL.
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

            /*
             * ------------------------------------------------------------
             * PRODUCTIVITY LIVES ON `activities`, NOT ON `payroll_items`.
             * ------------------------------------------------------------
             *
             * `payroll_items` is the only table with a column literally called
             * `productivity_score`, so derivation offered AVG over it and the
             * retriever handed the planner payroll for every productivity
             * question. That column is a PAYROLL SNAPSHOT, stamped when a run
             * is processed; on a tenant that has never run payroll the table is
             * empty and the honest answer to "which department is most
             * productive" came back as "no records". The measured data — 10,548
             * classified rows on the reporting tenant — was in `activities` the
             * whole time.
             *
             * THE ARITHMETIC IS THE MONITORING SCREEN'S, NOT A NEW ONE.
             * Monitoring → Usage Analytics ("Departments · efficiency",
             * ReportController::employeeInsights) computes
             *
             *     productive / (productive + unproductive + neutral + context_dependent)
             *
             * with idle rows removed BEFORE the split. Three formulas for
             * productivity already exist in this codebase and they disagree —
             * TimeBreakdownService divides working by tracked and never reads a
             * classification at all, and PayrollDepartmentController (the one
             * that writes payroll_items.productivity_score) puts idle in the
             * denominator and throws neutral and context_dependent away. A
             * fourth definition here would mean the product states two
             * different productivity numbers for the same department, so these
             * metrics reproduce the screen's and say so in their notes.
             *
             * FOUR EXCLUSIONS, EACH FOR A REASON:
             *
             *  - `type != 'idle'`. ProductivityClassifier hard-codes idle to
             *    neutral with the reason "Idle time is never marked
             *    productive", and every screen strips it before computing a
             *    share. Leaving it in silently reproduces the payroll formula.
             *  - `duration >= 1`. UsageProcessingService drops rows under
             *    `noise_threshold_seconds` at read time; keeping them here
             *    would change the denominator against the screen.
             *  - `users.deactivated_at is null`. There is no `users.is_active`
             *    column — it is an accessor over `deactivated_at`. A leaver's
             *    historic activity would keep inflating a department they have
             *    left, which is the exact presence SCIM deactivation exists to
             *    end.
             *  - `cap => 14400`. UsageProcessingService clips every row to
             *    `max_log_duration_seconds` at read time, and non-idle rows are
             *    NOT bounded at write time (ActivityController::
             *    boundedActivityDuration returns early for anything but idle).
             *    A raw SUM would report 8.3h for a row the screen reports as 4h.
             *
             * Unclassified rows are NOT silently dropped: `classification` is
             * nullable, they are excluded from the rate the way the screen
             * excludes them, and `unclassified_hours` exists so a reader can
             * see how much was left out rather than having to trust that it was
             * nothing.
             */
            'activities.productive_hours' => [
                'kind' => 'metric',
                'entity' => 'activities',
                'name' => 'productive_hours',
                'label' => 'Productive hours',
                'type' => 'number',
                'aggregate' => 'sum',
                'column' => 'duration',
                'cap' => 14400,
                'scale' => 3600,
                'round' => 2,
                'where' => [
                    ['activities.classification', '=', 'productive'],
                    ['activities.type', '!=', 'idle'],
                    ['activities.duration', '>=', 1],
                    ['users.deactivated_at', 'is null', null],
                ],
                'origin' => 'curated',
                'note' => 'Productive hours are tracked activity classified productive, matching Monitoring → Usage Analytics: idle rows excluded, rows under a second dropped, each row capped at 4 hours, and deactivated people left out.',
            ],

            'activities.unproductive_hours' => [
                'kind' => 'metric',
                'entity' => 'activities',
                'name' => 'unproductive_hours',
                'label' => 'Unproductive hours',
                'type' => 'number',
                'aggregate' => 'sum',
                'column' => 'duration',
                'cap' => 14400,
                'scale' => 3600,
                'round' => 2,
                'where' => [
                    ['activities.classification', '=', 'unproductive'],
                    ['activities.type', '!=', 'idle'],
                    ['activities.duration', '>=', 1],
                    ['users.deactivated_at', 'is null', null],
                ],
                'origin' => 'curated',
                'note' => 'Unproductive hours use the same population as productive hours, so the two are comparable and both sit inside tracked hours.',
            ],

            /*
             * The denominator, named so it can be asked for on its own. It is
             * every classified non-idle row, which is exactly the four buckets
             * the screen sums — `classification` only ever holds productive,
             * unproductive, neutral or context_dependent.
             *
             * context_dependent stays IN the denominator and out of the
             * numerator, which is the only defensible treatment: it means
             * genuinely unknown (YouTube, WhatsApp, Telegram, Discord, and a
             * browser with no resolvable domain). Folding it into productive
             * would reward it; excluding it altogether would let somebody who
             * spent the day on WhatsApp score 100%.
             */
            'activities.tracked_hours' => [
                'kind' => 'metric',
                'entity' => 'activities',
                'name' => 'tracked_hours',
                'label' => 'Tracked hours',
                'type' => 'number',
                'aggregate' => 'sum',
                'column' => 'duration',
                'cap' => 14400,
                'scale' => 3600,
                'round' => 2,
                'where' => [
                    ['activities.classification', 'not null', null],
                    ['activities.type', '!=', 'idle'],
                    ['activities.duration', '>=', 1],
                    ['users.deactivated_at', 'is null', null],
                ],
                'origin' => 'curated',
                'note' => 'Tracked hours are all classified non-idle activity — productive, unproductive, neutral and context-dependent together. Anything the tracker has not classified is reported separately as unclassified hours.',
            ],

            /*
             * Its own bucket rather than a silent exclusion. Production is
             * fully classified today; the column is nullable, a new tenant's
             * backlog is not, and dropping those rows without saying so shrinks
             * the denominator and inflates every department's rate.
             */
            'activities.unclassified_hours' => [
                'kind' => 'metric',
                'entity' => 'activities',
                'name' => 'unclassified_hours',
                'label' => 'Unclassified hours',
                'type' => 'number',
                'aggregate' => 'sum',
                'column' => 'duration',
                'cap' => 14400,
                'scale' => 3600,
                'round' => 2,
                'where' => [
                    ['activities.classification', 'is null', null],
                    ['activities.type', '!=', 'idle'],
                    ['activities.duration', '>=', 1],
                    ['users.deactivated_at', 'is null', null],
                ],
                'origin' => 'curated',
                'note' => 'Activity the tracker has not classified yet. It is outside tracked hours and outside the productivity rate — if this is large, the rate describes only part of the day.',
            ],

            /*
             * Idle is measured, never mixed in. It is the one activity type
             * bounded at write time (to the owning time entry's own span), and
             * it is deliberately absent from every bucket above.
             */
            'activities.idle_hours' => [
                'kind' => 'metric',
                'entity' => 'activities',
                'name' => 'idle_hours',
                'label' => 'Idle hours',
                'type' => 'number',
                'aggregate' => 'sum',
                'column' => 'duration',
                'cap' => 14400,
                'scale' => 3600,
                'round' => 2,
                'where' => [
                    ['activities.type', '=', 'idle'],
                    ['activities.duration', '>=', 1],
                    ['users.deactivated_at', 'is null', null],
                ],
                'origin' => 'curated',
                'note' => 'Idle time, kept out of every productivity bucket — the classifier never marks idle productive, and the Monitoring screens strip it before computing a share.',
            ],

            /*
             * The rate the question actually asks for. `where` is the
             * DENOMINATOR population and `numerator` narrows it, so both halves
             * are provably drawn from the same rows — computing them as two
             * independent metrics is how a percentage ends up over 100.
             *
             * A department with no tracked time yields NULL, never 0.0: "we
             * measured nothing here" and "they were 0% productive" are
             * different facts and only one of them is ever true.
             */
            'activities.productivity_rate' => [
                'kind' => 'metric',
                'entity' => 'activities',
                'name' => 'productivity_rate',
                'label' => 'Productivity rate (%)',
                'type' => 'number',
                'aggregate' => 'rate',
                'column' => 'duration',
                'cap' => 14400,
                'round' => 2,
                'where' => [
                    ['activities.classification', 'not null', null],
                    ['activities.type', '!=', 'idle'],
                    ['activities.duration', '>=', 1],
                    ['users.deactivated_at', 'is null', null],
                ],
                'numerator' => [
                    ['activities.classification', '=', 'productive'],
                ],
                'origin' => 'curated',
                'note' => 'Productivity rate is productive hours as a percentage of tracked hours — the same arithmetic as the "Departments · efficiency" panel in Monitoring → Usage Analytics. Idle is excluded; neutral and context-dependent time counts against the rate without ever counting for it. No tracked time reads as blank, not as 0%.',
            ],

            /*
             * The two-hop department, and the reason `activities` needs curated
             * entity joins at all: an activity knows its user, and only the
             * user's work info knows their reporting group.
             *
             * report_group_id, never group_user — the same rule
             * `employees.department` follows. group_user is a many-to-many
             * ACCESS grouping; 72 of ~90 people on this database sit in more
             * than one group, so a group_user breakdown counts their hours into
             * several departments and stops summing to the organisation total.
             *
             * KNOWN DIVERGENCE, stated rather than discovered: the Monitoring
             * screen resolves department membership through
             * ReportGroup::users(), which IS group_user, so its department
             * totals double-count those people. This dimension is right and the
             * screen's grouping is not; the rate arithmetic is identical.
             */
            'activities.department' => [
                'kind' => 'dimension',
                'entity' => 'activities',
                'name' => 'department',
                'label' => 'Department',
                'join' => ['groups', 'groups.id', '=', 'employee_work_infos.report_group_id'],
                'select' => 'groups.name',
                'type' => 'text',
                'null_label' => '(unassigned)',
                'origin' => 'curated',
                'note' => 'Department is the person reporting group as recorded — groups are never merged, so "HR" and "Human Resources" stay two rows if the organisation has both. Activity from somebody with no group is shown as (unassigned).',
            ],

            /*
             * ------------------------------------------------------------
             * The payroll snapshot KEPT, and made to say what it is.
             * ------------------------------------------------------------
             *
             * These two columns are not deleted, for the same reason nothing
             * else here is: the curated set only grows, and once payroll HAS
             * run they are the correct answer to "what productivity was this
             * payroll computed against". What was wrong was answering a live
             * monitoring question from them, which is now fixed in retrieval.
             *
             * The exclusion is the `avg_net_pay` defect exactly: an unprocessed
             * item carries 0 in every computed column, and averaging those in
             * drags the score toward zero. Filtered on net_pay for the same
             * reason total_gross is — so this population is the one the rest of
             * the payroll metrics describe.
             */
            'payroll.avg_productivity_score' => [
                'kind' => 'metric',
                'entity' => 'payroll',
                'name' => 'avg_productivity_score',
                'label' => 'Avg productivity score (payroll snapshot)',
                'type' => 'number',
                'aggregate' => 'avg',
                'column' => 'productivity_score',
                'round' => 2,
                'where' => [['payroll_items.net_pay', '>', 0]],
                'origin' => 'curated',
                'note' => 'This is the productivity stamped onto a processed payroll item at run time, not live tracker data — it exists only for months payroll has actually run, and it counts idle in its denominator. For current productivity ask the activities entity instead. Excludes payroll items not yet processed (net pay 0).',
            ],

            'payroll.avg_activity_percentage' => [
                'kind' => 'metric',
                'entity' => 'payroll',
                'name' => 'avg_activity_percentage',
                'label' => 'Avg activity % (payroll snapshot)',
                'type' => 'number',
                'aggregate' => 'avg',
                'column' => 'activity_percentage',
                'round' => 2,
                'where' => [['payroll_items.net_pay', '>', 0]],
                'origin' => 'curated',
                'note' => 'Activity percentage as stamped on a processed payroll item, not live tracker data. Excludes payroll items not yet processed (net pay 0).',
            ],
        ];
    }

    /**
     * Extra entity-level joins a curated dimension needs, keyed by entity.
     *
     * A dimension carries ONE join tuple, which covers every one-hop
     * department in this file. `activities` is two hops — an activity knows
     * its user, and the reporting group hangs off that user's work info — so
     * the first hop has to be an ENTITY join: they are applied before any
     * dimension join, they are LEFT, and `applyJoins()` only applies the ones a
     * plan actually reaches for, so an activity question that never mentions a
     * department joins nothing extra.
     *
     * The alternative was `QueryPlanExecutor::BASE_QUERIES`, where joins are
     * INNER and unconditional: that would silently drop every activity
     * belonging to somebody with no `employee_work_infos` row, which is the
     * precise class of bug the LEFT-join rule exists to prevent.
     *
     * `users` is joined under its own name rather than reused from the derived
     * `users as users_via_user_id` alias. The derived alias is generated from a
     * foreign key name and would change under this metric's feet; both joins
     * are LEFT onto the same primary key, so naming our own costs nothing and
     * cannot silently start meaning something else.
     *
     * @return list<array{0: string, 1: string, 2: string, 3: string}>
     */
    public static function joinsFor(string $entity): array
    {
        $joins = [
            'activities' => [
                ['employee_work_infos', 'employee_work_infos.user_id', '=', 'activities.user_id'],
                ['users', 'users.id', '=', 'activities.user_id'],
            ],
        ];

        return $joins[$entity] ?? [];
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
