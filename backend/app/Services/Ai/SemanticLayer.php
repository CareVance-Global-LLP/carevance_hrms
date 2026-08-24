<?php

namespace App\Services\Ai;

use App\Models\Asset;
use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\PayrollItem;
use App\Models\Task;
use App\Models\User;
use Illuminate\Support\Facades\Cache;

/**
 * What AI mode is allowed to be asked about, and what each number MEANS.
 *
 * Seven hand-written entities covered under 10% of a 221-table schema, so
 * coverage is now DERIVED from the schema itself (`SchemaIntrospector::derive()`,
 * keyed by table) and correctness is CURATED on top of it (`MetricOverrides`,
 * keyed by concept, plus the hand-written definitions below): a derived
 * `AVG(net_pay)` answers 76,313.27 where the truth is 91,575.93, and this is
 * the seam that stops that number reaching anyone.
 *
 * The model picks a metric by name. It never decides how a number is computed,
 * because the obvious computation is measurably wrong more often than not.
 * Adding a curated metric means adding a test that asserts its number against
 * a known fixture. Metrics are payroll code and get payroll care.
 */
final class SemanticLayer
{
    /**
     * The cache key, STATIC by design — see `cached()` for why a computed key
     * was the wrong shape. Bump the version suffix if the shape of an entity
     * changes, so a deployed cache holding the old shape is abandoned rather
     * than read back into a layer that no longer understands it.
     */
    private const CACHE_KEY = 'ai.semantic-layer.v1';

    /**
     * What separates the aggregate prefixes from the columns they apply to in a
     * derived-metric pattern line. Named because `promptCatalogueFor()` tests
     * for it to decide whether the notation needs its legend, and a literal in
     * two places is how those two silently stop agreeing.
     */
    private const PATTERN_JOINER = ' over ';

    /**
     * Concept key => the table it owns. A table claimed here does NOT also
     * appear under its own table name — one table, one entity, or the
     * retriever offers the planner the same table twice.
     */
    private const CONCEPT_TABLES = [
        'employees' => 'employee_work_infos',
        'payroll' => 'payroll_items',
        'attendance' => 'attendance_records',
        'leave' => 'leave_requests',
        'assets' => 'assets',
        'work' => 'tasks',
        'hiring' => 'candidates',
        'activity' => 'activity_sessions',
    ];

    /**
     * The original hand-written metrics and dimensions, kept byte-for-byte as
     * they were verified against the live database. Re-deriving any of these
     * is how a correct number becomes a wrong one again — so `curate()` merges
     * them over the derived base per metric/dimension key, never wholesale.
     * `list_columns` is the one addition: derivation introduces that concept,
     * and `employees` needs one entry (see below) that could not have existed
     * before it.
     *
     * `employees`' `label` and `model` matter beyond cosmetics: the table this
     * concept derives from is `employee_work_infos`, but `QueryPlanExecutor`
     * builds its base query on `users` and joins `employee_work_infos` onto
     * it (`applyEntityJoins()`), so the entity's `model` has to stay
     * `User::class` or that join has no base table to attach to.
     *
     * `MetricOverrides::forEntity()` is merged over this in turn where the two
     * disagree — `avg_net_pay`, `total_gross` and `late_count` here are
     * unqualified column names, and `MetricOverrides` holds the table-qualified
     * versions that are safe once a dimension can join another table onto the
     * same query.
     *
     * @return array<string, array<string, mixed>>
     */
    private static function legacyEntities(): array
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
                // Derivation runs off employee_work_infos, which has no `name`
                // column of its own — the name is on `users`, which is what
                // this entity's model (User::class, above) actually queries.
                // No join needed: it is the base table.
                'list_columns' => [
                    'name' => [
                        'label' => 'Name',
                        'select' => 'users.name',
                        'type' => 'text',
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

    /**
     * The keying decision, stated once so nothing downstream has to guess it.
     *
     * `derive()` keys by table (`payroll_items`); `MetricOverrides` keys by
     * concept (`payroll`). This returns BOTH: the eight concept keys keep their
     * curated definitions, built as `derive()[table]` with the legacy
     * hand-written entity and then `MetricOverrides::forEntity(concept)`
     * merged over the top — every other org-scoped table appears under its own
     * table-name key, and a table claimed by a concept does NOT also appear
     * under its table name.
     *
     * @return array<string, array<string, mixed>>
     */
    public static function entities(): array
    {
        $derived = SchemaIntrospector::derive();
        $legacy = self::legacyEntities();
        $entities = [];

        foreach (self::CONCEPT_TABLES as $concept => $table) {
            $base = $derived[$table] ?? null;

            if ($base === null) {
                continue; // the table is absent in this deployment; say nothing about it
            }

            $entities[$concept] = self::curate($concept, $base, $legacy[$concept] ?? null);
            unset($derived[$table]);   // one table, one entity
        }

        foreach ($derived as $table => $entity) {
            $entities[$table] = self::stampOrigins($entity);
        }

        return $entities;
    }

    /**
     * Merge PER KEY, never per entity. Replacing $base['metrics'] wholesale
     * would delete every derived metric on the table beside the one being
     * corrected. Order matters: the legacy hand-written definition lands
     * first (it is what was verified), and MetricOverrides lands last so it
     * wins where the two disagree — MetricOverrides holds the newer,
     * table-qualified version of the same fix.
     */
    private static function curate(string $concept, array $base, ?array $legacy): array
    {
        $entity = self::stampOrigins($base);

        if ($legacy !== null) {
            $entity['label'] = $legacy['label'];
            $entity['model'] = $legacy['model'];

            foreach (['metrics', 'dimensions', 'list_columns'] as $bucket) {
                foreach ($legacy[$bucket] ?? [] as $name => $definition) {
                    $entity[$bucket][$name] = $definition + ['origin' => 'curated'];
                }
            }
        }

        $overrides = MetricOverrides::forEntity($concept);

        foreach (['metrics', 'dimensions'] as $bucket) {
            foreach ($overrides[$bucket] as $name => $definition) {
                $entity[$bucket][$name] = $definition + ['origin' => 'curated'];
            }
        }

        return $entity;
    }

    private static function stampOrigins(array $entity): array
    {
        foreach ($entity['metrics'] as $name => $metric) {
            $entity['metrics'][$name] = $metric + ['origin' => 'derived'];
        }

        return $entity;
    }

    /**
     * The read path, and the reason `cached()` exists.
     *
     * This reads `cached()`, NOT `entities()`. `metric()`, `dimension()` and
     * `listColumn()` all resolve through here, `PlanValidator` and
     * `QueryPlanExecutor` make about eight such lookups between them for a
     * single question, and `entities()` walks every table and column in the
     * schema on every call — measured at 0.95s each against Postgres, with no
     * amortisation whatsoever, so one question spent roughly 7.6 seconds
     * deriving the same 149 entities eight times before a single row was read.
     * The spec's wording is `never computed per request`, and pointing the
     * accessors at the derivation rather than the cache is precisely how that
     * happens.
     *
     * SQLite makes derivation nearly free, so no test can catch this by being
     * slow — `test_a_lookup_never_touches_the_database()` asserts the real
     * property instead: after the layer is warm, a lookup issues no query.
     */
    public static function entity(string $key): ?array
    {
        return self::cached()[$key] ?? null;
    }

    public static function metric(string $entity, string $metric): ?array
    {
        return self::entity($entity)['metrics'][$metric] ?? null;
    }

    public static function dimension(string $entity, string $dimension): ?array
    {
        return self::entity($entity)['dimensions'][$dimension] ?? null;
    }

    public static function listColumn(string $entity, string $column): ?array
    {
        return self::entity($entity)['list_columns'][$column] ?? null;
    }

    /**
     * The whole layer, cached under a static key and rebuilt on migration.
     *
     * The key used to be `'ai.semantic-layer.'.schemaFingerprint()`, a hash of
     * every table and column. A computed key is genuinely attractive because it
     * invalidates itself — but it is self-defeating here, because computing it
     * means READING every table's columns. A cache HIT still walked the whole
     * schema to discover that nothing had changed. Under PHP-FPM the memo below
     * starts empty on every request, so that walk was paid on every AI
     * question: ~0.65s, a fifth of the spec's 3s planning budget, spent
     * learning nothing. The spec's words are `rebuilt on migration, never
     * computed per request`, and that describes an EVENT, not a key.
     *
     * So invalidation is event-based: `AppServiceProvider::boot()` listens for
     * `MigrationsEnded` and calls `forgetCached()`. The day-long TTL stays as
     * the backstop, and it is not decoration — this schema has drifted from its
     * migrations before (`bank_transfer_batches`), and a change made outside a
     * migration fires no event at all. The TTL bounds how long the layer can go
     * on describing a column that no longer exists to at most a day.
     *
     * Schema-level, not tenant-level: the catalogue holds table and column
     * names and no tenant data, so one cache serves every organization. Keying
     * it on organization_id would multiply one identical catalogue by the
     * tenant count.
     *
     * The in-process memo on top of the cache store is what makes `entity()`
     * safe to call in a loop: `PlanValidator` and `QueryPlanExecutor` make
     * about eight lookups for one question, and only the first touches the
     * store at all.
     *
     * @return array<string, array<string, mixed>>
     */
    public static function cached(): array
    {
        return self::$memo ??= Cache::remember(
            self::CACHE_KEY,
            now()->addDay(),
            fn () => self::entities(),
        );
    }

    /**
     * Dropped by `forgetCached()`. A class property rather than a function
     * `static` for exactly that reason: a function static cannot be reset from
     * outside, and this one has to be.
     *
     * @var array<string, array<string, mixed>>|null
     */
    private static ?array $memo = null;

    /**
     * Forget the cached layer — BOTH the in-process memo and the cache entry.
     *
     * Both, because they fail differently and independently. `Cache::flush()`
     * cannot reach the memo, since a static outlives the container; and
     * dropping the memo alone would just re-read the same stale entry back out
     * of the store on the next call.
     *
     * Two callers, for two different reasons:
     *
     * - The `MigrationsEnded` listener in `AppServiceProvider::boot()`. This is
     *   the real invalidation path — the schema has changed, so a vocabulary
     *   derived from it is wrong until it is rebuilt.
     * - `Tests\TestCase::setUp()`, beside its existing `Cache::flush()`. The
     *   memo does not revalidate itself on a hit — that check IS the schema
     *   walk this whole design exists to avoid — so a test touching the layer
     *   before its database is migrated would memoise an empty catalogue and
     *   serve it to every later test in the same PHP process: every plan
     *   refused as `no such entity`, in a full run only, passing in isolation.
     */
    public static function forgetCached(): void
    {
        self::$memo = null;

        Cache::forget(self::CACHE_KEY);
    }

    /**
     * The catalogue for a SPECIFIC set of entities — what the retriever hands
     * the planner once it has narrowed 80 entities down to the handful a
     * question is actually about. Names and labels only — no rows, no column
     * values, nothing that could carry employee data to the model.
     *
     * Curated metrics are listed BY NAME — a planner has to pick one by name,
     * and their definitions are hand-verified rather than obvious from the
     * column. Derived metrics are compressed to the PATTERN that produced
     * them instead: `payroll` alone carries 300+ derived sum/avg/min/max
     * metrics, one set per numeric column, and spelling every one out blew
     * the retrieved-entity catalogue past 4,000 tokens on a single entity.
     * The pattern conveys the identical vocabulary — every `{aggregate}_{col}`
     * name is still choosable, just not enumerated — in a fraction of the
     * space. Truncating the list instead would silently turn coverage into
     * "the model can't see that metric", which is the one failure this
     * design exists to prevent.
     *
     * @param  array<int, string>  $entityKeys
     */
    public static function promptCatalogueFor(array $entityKeys): string
    {
        $lines = [];
        $usesAggregatePattern = false;
        $usesGroupings = false;

        foreach ($entityKeys as $key) {
            $entity = self::entity($key);

            if ($entity === null) {
                continue;
            }

            $lines[] = sprintf('- %s (%s)', $key, $entity['label']);

            $curated = self::curatedMetricNames($entity['metrics']);
            if ($curated !== []) {
                $lines[] = '    metrics: '.implode(', ', $curated);
            }

            foreach (self::derivedMetricPatterns($entity['metrics']) as $pattern) {
                $usesAggregatePattern = $usesAggregatePattern || str_contains($pattern, self::PATTERN_JOINER);
                $lines[] = '    metrics: '.$pattern;
            }

            $groupings = self::groupableAndListableLines($entity);
            $usesGroupings = $usesGroupings || $groupings !== [];
            array_push($lines, ...$groupings);
        }

        if ($lines === []) {
            return '';
        }

        return implode("\n", array_merge(self::legend($usesAggregatePattern, $usesGroupings), $lines));
    }

    /**
     * The key to the notation, without which the compression is a refusal.
     *
     * `QueryPlanner`'s prompt says "You may only use these entities, metrics
     * and group_by dimensions" and "Never invent an entity, metric or
     * dimension that is not listed above". Compressing 300 derived metrics
     * into `sum_/avg_ over net_pay, basic` obeys the budget but means no
     * derived metric name appears literally anywhere — so assembling one is
     * indistinguishable from the inventing the prompt forbids, and a
     * well-behaved planner refuses rather than guesses. `PlanValidator` would
     * catch a guess by name, so the failure is safe; it is still a failure, and
     * the identical one truncating the list would have caused.
     *
     * So the notation is DECLARED, not left to be inferred. Roughly 150
     * characters against an 8,000-character budget, and it buys back the ~300
     * metrics on `payroll` alone plus every metric on the 141 non-concept
     * entities.
     *
     * Emitted only for the notation actually used, and pinned by
     * `test_the_pattern_notation_is_never_emitted_without_its_legend()` so the
     * key and the thing it explains cannot drift apart.
     *
     * @return list<string>
     */
    private static function legend(bool $usesAggregatePattern, bool $usesGroupings): array
    {
        $legend = [];

        if ($usesAggregatePattern) {
            $legend[] = '# Notation: "sum_/avg_ over x, y" means the metrics sum_x, avg_x, sum_y and avg_y all exist — join a prefix to a column name. Every metric it spells out is listed and may be used.';
        }

        if ($usesGroupings) {
            $legend[] = '# "per" lists the group_by dimensions; "columns" lists the fields a row listing can show.';
        }

        return $legend;
    }

    /**
     * @param  array<string, array<string, mixed>>  $metrics
     * @return list<string>
     */
    private static function curatedMetricNames(array $metrics): array
    {
        $names = [];

        foreach ($metrics as $name => $metric) {
            if (($metric['origin'] ?? null) === 'curated') {
                $names[] = $name;
            }
        }

        return $names;
    }

    /**
     * Derived metrics, one line per distinct aggregate pattern rather than
     * one line per metric. `count` (no column) stands alone; every other
     * derived metric is grouped by its underlying column, and columns that
     * share the identical set of aggregates share one line — the common
     * case, since SchemaIntrospector always derives sum/avg/min/max together
     * for a measurable column, so it is usually one line for the whole
     * entity rather than four per column.
     *
     * @param  array<string, array<string, mixed>>  $metrics
     * @return list<string>
     */
    private static function derivedMetricPatterns(array $metrics): array
    {
        $lines = [];
        $columnsByAggregateSet = [];

        foreach ($metrics as $metric) {
            if (($metric['origin'] ?? null) !== 'derived') {
                continue;
            }

            if ($metric['aggregate'] === 'count') {
                $lines[] = 'count';

                continue;
            }

            $columnsByAggregateSet[$metric['column']][] = $metric['aggregate'];
        }

        $columnsBySignature = [];
        foreach ($columnsByAggregateSet as $column => $aggregates) {
            sort($aggregates);
            $columnsBySignature[implode(',', $aggregates)][] = $column;
        }

        foreach ($columnsBySignature as $signature => $columns) {
            $prefixes = implode('/', array_map(fn (string $a) => $a.'_', explode(',', $signature)));
            $lines[] = $prefixes.self::PATTERN_JOINER.implode(', ', $columns);
        }

        return $lines;
    }

    /**
     * `per` (dimensions) and `columns` (list_columns) come from the SAME
     * per-column loop in SchemaIntrospector, so on a wide table they are
     * nearly the same ~90 names twice — that duplication, not metrics, is
     * what pushed `payroll` alone over budget once the metrics were
     * compressed. The names shared by both buckets are printed once; a name
     * that is only groupable or only listable is called out separately, so
     * nothing is lost — every key still appears under whichever line(s) it
     * genuinely belongs to.
     *
     * @return list<string>
     */
    private static function groupableAndListableLines(array $entity): array
    {
        $dimensionKeys = array_keys($entity['dimensions']);
        $columnKeys = array_keys($entity['list_columns']);

        $shared = array_values(array_intersect($dimensionKeys, $columnKeys));
        $dimensionOnly = array_values(array_diff($dimensionKeys, $columnKeys));
        $columnOnly = array_values(array_diff($columnKeys, $dimensionKeys));

        $lines = [];

        if ($shared !== []) {
            $lines[] = sprintf('    per/columns: %s', implode(', ', $shared));
        }

        if ($dimensionOnly !== []) {
            $lines[] = sprintf('    per (group-by only): %s', implode(', ', $dimensionOnly));
        }

        if ($columnOnly !== []) {
            $lines[] = sprintf('    columns (list only): %s', implode(', ', $columnOnly));
        }

        return $lines;
    }

    /** The full catalogue, unfiltered. Kept for callers that have not adopted retrieval yet. */
    public static function promptCatalogue(): string
    {
        return self::promptCatalogueFor(array_keys(self::cached()));
    }
}
