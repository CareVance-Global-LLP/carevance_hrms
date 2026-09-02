<?php

namespace App\Services\Ai;

use App\Models\EmployeeWorkInfo;
use App\Traits\BelongsToOrganization;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * The one place a query is built — now for the §1 v2 plan in full.
 *
 * Everything runs through Eloquent so `BelongsToOrganization`'s global scope is
 * applied structurally rather than remembered. Raw SQL would bypass it, which
 * would make a wrong query a cross-tenant leak rather than merely a wrong
 * answer; that is why the model plans and this class executes.
 *
 * FIVE RULES RUN THROUGH EVERY LINE HERE.
 *
 * 1. **The base query is built on a model that carries the tenancy trait, or
 *    it is not built at all.** `employees` declares `User` as its model so
 *    `users.name` resolves, and `User` deliberately carries no scope — so
 *    basing the query on it would answer "how many people do we have" across
 *    every tenant on the platform. The base is the scoped table underneath
 *    and the declared model is JOINED onto it (`BASE_QUERIES`), and an entity
 *    whose base is unscoped fails loudly rather than answering.
 *
 * 2. **A metric's exclusion is part of the METRIC, not of the query.** It is
 *    compiled into a conditional aggregate — `avg(case when net_pay > 0 then
 *    net_pay end)` — so asking for `count` and `avg_net_pay` together gives
 *    each its own population. Applied as a WHERE, one metric's exclusion would
 *    silently redefine the other, and the number that came back would not be
 *    the number the plan names.
 *
 * 3. **A date is compared in the COLUMN's own format.** `payroll_items.month_year`
 *    is a `YYYY-MM` string; `'2026-07' >= '2026-07-01'` is false, so a `Y-m-d`
 *    bound against it does not return the wrong rows — it returns none, and an
 *    empty table beside a plan that says "July" is a confident wrong answer.
 *    Every range is half-open in the column's own granularity, which is also
 *    what makes a bound on a timestamp column cover the whole last day.
 *
 * 4. **An empty result is `rows: []`. Never a row containing 0.** "No records"
 *    and "zero" are different facts and only one of them is ever true. An
 *    ungrouped aggregate returns one row over an empty table, and that row's 0
 *    is the shape of the defect that answered "list employees who joined this
 *    year" with `count: 0` against a true answer of fourteen people.
 *
 * 5. **Anything this class cannot honour is refused BY NAME.** Never dropped,
 *    never approximated. A filter that is not applied is a question nobody
 *    asked, answered with the same confidence as the one they did.
 *
 * @see docs/superpowers/specs/2026-08-24-ai-mode-grammar-v2.md §6
 */
class QueryPlanExecutor
{
    /**
     * Entities whose semantic model is a VIEW over the table the entity is
     * actually derived from.
     *
     * There is exactly one, and it exists for a reason worth stating: the
     * `employees` concept derives from `employee_work_infos` but declares
     * `User::class` so `users.name` is selectable. `User` carries no
     * `BelongsToOrganization` — deliberately, the scope resolves the acting
     * user through Auth — so `User::query()` reads every tenant. The base is
     * therefore the scoped table and `users` is joined onto it, which changes
     * nothing about which columns resolve and everything about which rows do.
     *
     * The join is INNER on purpose: a work-info row whose user has been erased
     * is not a person to list. Every other join in this class is LEFT, because
     * dropping a row for a missing department is how a breakdown stops adding
     * up to the total above it.
     */
    private const BASE_QUERIES = [
        'employees' => [
            'model' => EmployeeWorkInfo::class,
            'joins' => [['users', 'users.id', '=', 'employee_work_infos.user_id']],
        ],
    ];

    /**
     * The comparisons a metric's own `where` may use. Anything else is a layer
     * bug. `is null` and `not null` are handled separately in
     * `metricCondition()` because they bind no value.
     */
    private const METRIC_COMPARISONS = ['=', '!=', '<>', '>', '>=', '<', '<='];

    /** §2's scalar comparisons, mapped to SQL. */
    private const SCALAR_COMPARISONS = [
        'eq' => '=', 'neq' => '<>', 'gt' => '>', 'gte' => '>=', 'lt' => '<', 'lte' => '<=',
    ];

    /**
     * Identifiers the layer may hand this class. Table-qualified or bare, and
     * nothing else — the strings come from the semantic layer rather than from
     * the model, but they are interpolated into SQL, and "it can't happen" is
     * not a property anybody can grep for.
     */
    private const IDENTIFIER = '/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)?$/';

    /** §5's row cap, matching PlanValidator's. Both apply; only this one builds SQL. */
    private const MAX_LIMIT = 500;

    private const DEFAULT_LIMIT = 20;

    /** Output aliases. Prefixed so they can never collide with a real column. */
    private const DIMENSION_ALIAS = 'ai_dim_';
    private const METRIC_ALIAS = 'ai_metric_';
    private const COLUMN_ALIAS = 'ai_col_';
    private const POPULATION_ALIAS = 'ai_population';

    /**
     * @param  array<string, mixed>  $plan  PlanValidator's canonical §1 output
     * @return array{columns: list<array{key: string, label: string, type: string}>, rows: list<array<string, mixed>>, notes: list<string>, truncated: bool}
     */
    public function execute(array $plan): array
    {
        $entityKey = (string) ($plan['entity'] ?? '');
        $entity = SemanticLayer::entity($entityKey);

        if ($entity === null) {
            throw new UnsupportedQuestionException(
                sprintf("There is no '%s' data in this system.", $entityKey !== '' ? $entityKey : 'unknown')
            );
        }

        $mode = $this->mode($plan);
        $metrics = $this->metrics($plan, $entityKey, $mode);
        $dimensions = $this->dimensions($plan, $entityKey, $mode);
        $columns = $this->listColumns($plan, $entityKey, $mode);
        $filters = $this->filters($plan, $entityKey);

        /*
         * §5's `limit` rule, re-applied rather than trusted. The validator
         * clamps it and this class is what actually builds the query, so the
         * row cap belongs here too — 0 and negative both mean the default (an
         * explicit 0 clamped to 1 is what made "headcount by department"
         * return a single row), and no plan gets to ask for the whole table.
         */
        $limit = (int) ($plan['limit'] ?? 0);
        $limit = $limit > 0 ? min(self::MAX_LIMIT, $limit) : self::DEFAULT_LIMIT;

        $query = $this->baseQuery($entityKey, $entity);

        $this->applyJoins($query, $entityKey, $entity, $metrics, $dimensions, $columns, $filters);

        foreach ($filters as $filter) {
            $this->applyFilter($query, $filter);
        }

        // Cloned BEFORE the select, the grouping and the limit, so §12's
        // zero/null census measures the same population the answer is drawn
        // from rather than a second, differently-filtered one.
        $population = clone $query;

        $result = $mode === 'list'
            ? $this->executeList($query, $columns, $plan, $limit)
            : $this->executeAggregate($query, $entity, $metrics, $dimensions, $plan, $limit);

        $result['notes'] = array_values(array_unique(array_merge(
            $this->metricNotes($metrics, $entity),
            $this->dimensionNotes($dimensions),
            $this->periodNotes($filters),
            $this->inputCensusNotes($population, $metrics, $entity),
            $this->emptyResultNotes($result['rows'], $entityKey, $entity),
        )));

        return $result;
    }

    /**
     * §6.4 said an empty result must be `rows: []` rather than a row of
     * zeroes. It said nothing about what the reader is then told, and the
     * answer was nothing at all: the aggregate branch returns `notes: []`, the
     * zero/null census is silent when the population is 0 because there is
     * nothing to count, and `AnswerSummariser` returns null on empty rows. So
     * the whole product had one sentence — "No records match that question." —
     * for an empty source, a filter that excluded everything, and a question it
     * could not answer. A dead end that reads as a refusal is what teaches
     * somebody the feature cannot do it and to stop asking.
     *
     * Two of those three are visible from here, and they are told apart by the
     * only fact that separates them: whether the entity holds anything at all.
     * One COUNT, and only when the answer came back empty.
     *
     * @param  list<array<string, mixed>>  $rows
     * @param  array<string, mixed>  $entity
     * @return list<string>
     */
    private function emptyResultNotes(array $rows, string $entityKey, array $entity): array
    {
        if ($rows !== []) {
            return [];
        }

        $label = strtolower((string) ($entity['label'] ?? $entityKey));
        $available = $this->baseQuery($entityKey, $entity)->count();

        if ($available === 0) {
            return [sprintf(
                'There is no %s data recorded in this organization at all, so nothing could match. The question is answerable — the source is empty.',
                $label
            )];
        }

        return [sprintf(
            '%d %s records exist, but none of them match this question. The source is not empty; every row was excluded by the filters or thresholds on it.',
            $available,
            $label
        )];
    }

    // ------------------------------------------------------------- the plan

    /** @param array<string, mixed> $plan */
    private function mode(array $plan): string
    {
        $mode = $plan['mode'] ?? 'aggregate';

        if ($mode !== 'aggregate' && $mode !== 'list') {
            throw new UnsupportedQuestionException(
                sprintf("'%s' is not a mode I understand — use aggregate or list.", (string) $mode)
            );
        }

        return $mode;
    }

    /**
     * The validator emits `metrics[]` and keeps a singular `metric` as a
     * deprecated bridge. Reading both costs one line and means a saved v1 plan
     * still runs; it never widens what may be named, because every name is
     * still resolved against the layer below.
     *
     * @param  array<string, mixed>  $plan
     * @return array<string, array<string, mixed>>
     */
    private function metrics(array $plan, string $entityKey, string $mode): array
    {
        if ($mode === 'list') {
            return [];
        }

        $names = $this->names($plan['metrics'] ?? $plan['metric'] ?? null);
        $metrics = [];

        foreach ($names as $name) {
            $metric = SemanticLayer::metric($entityKey, $name);

            if ($metric === null) {
                throw new UnsupportedQuestionException(sprintf(
                    "'%s' is not something that can be measured on %s.",
                    $name,
                    $entityKey
                ));
            }

            $metrics[$name] = $metric;
        }

        if ($metrics === []) {
            throw new UnsupportedQuestionException('This plan measures nothing — it names no metric.');
        }

        return $metrics;
    }

    /**
     * @param  array<string, mixed>  $plan
     * @return array<string, array<string, mixed>>
     */
    private function dimensions(array $plan, string $entityKey, string $mode): array
    {
        $names = $mode === 'list' ? [] : $this->names($plan['group_by'] ?? null);
        $dimensions = [];

        foreach ($names as $name) {
            $dimension = SemanticLayer::dimension($entityKey, $name);

            if ($dimension === null) {
                throw new UnsupportedQuestionException(
                    sprintf("%s cannot be grouped by '%s'.", $entityKey, $name)
                );
            }

            $dimensions[$name] = $dimension;
        }

        return $dimensions;
    }

    /**
     * @param  array<string, mixed>  $plan
     * @return array<string, array<string, mixed>>
     */
    private function listColumns(array $plan, string $entityKey, string $mode): array
    {
        if ($mode !== 'list') {
            return [];
        }

        $names = $this->names($plan['columns'] ?? null);
        $columns = [];

        foreach ($names as $name) {
            $column = $this->field($entityKey, $name);

            if ($column === null) {
                throw new UnsupportedQuestionException(sprintf(
                    "'%s' is not a column that can be listed on %s.",
                    $name,
                    $entityKey
                ));
            }

            $columns[$name] = $column;
        }

        if ($columns === []) {
            throw new UnsupportedQuestionException('A row listing has to name at least one column to show.');
        }

        return $columns;
    }

    /**
     * §1's filter descriptors, each resolved to the field it names.
     *
     * The shape is the validator's, and a shape this class does not recognise
     * is a contract break rather than a bad question — so it raises, loudly,
     * instead of being skipped. A filter that is silently not applied is
     * exactly the defect that answered a fourteen-person list with `count: 0`.
     *
     * @param  array<string, mixed>  $plan
     * @return list<array<string, mixed>>
     */
    private function filters(array $plan, string $entityKey): array
    {
        $raw = $plan['filters'] ?? [];

        if (! is_array($raw)) {
            throw new LogicException('QueryPlanExecutor was given filters it cannot read; validate the plan first.');
        }

        $filters = [];

        foreach ($raw as $key => $descriptor) {
            if (! is_int($key) || ! is_array($descriptor) || ! isset($descriptor['field'], $descriptor['op'])) {
                throw new LogicException(
                    'QueryPlanExecutor was given a filter that is not a {field, op, value} descriptor; '
                    .'PlanValidator normalises every other shape and refuses what it cannot.'
                );
            }

            $field = (string) $descriptor['field'];
            $definition = $this->field($entityKey, $field);

            if ($definition === null) {
                throw new UnsupportedQuestionException(
                    sprintf("'%s' is not a field on %s.", $field, $entityKey)
                );
            }

            $filters[] = [
                'field' => $field,
                'definition' => $definition,
                'op' => (string) $descriptor['op'],
                'value' => $descriptor['value'] ?? null,
            ];
        }

        return $filters;
    }

    /**
     * §4: a filter or a list column may name a dimension or a list column, and
     * they are not the same set — `employees.name` is a list column and no
     * dimension, `employees.department` is a dimension and no list column.
     *
     * @return array<string, mixed>|null
     */
    private function field(string $entityKey, string $name): ?array
    {
        return SemanticLayer::listColumn($entityKey, $name)
            ?? SemanticLayer::dimension($entityKey, $name);
    }

    /** @return list<string> */
    private function names(mixed $raw): array
    {
        if ($raw === null || $raw === '') {
            return [];
        }

        if (is_string($raw)) {
            return [$raw];
        }

        if (! is_array($raw)) {
            throw new LogicException('QueryPlanExecutor was given a name list it cannot read; validate the plan first.');
        }

        return array_values(array_map('strval', $raw));
    }

    // --------------------------------------------------------- the base query

    /**
     * @param  array<string, mixed>  $entity
     */
    private function baseQuery(string $entityKey, array $entity): Builder
    {
        $spec = self::BASE_QUERIES[$entityKey] ?? null;
        $modelClass = $spec['model'] ?? $entity['model'];

        /*
         * The tenancy guard, asserted rather than assumed. A model without the
         * trait produces a perfectly valid query over every organization on the
         * platform, and nothing downstream would notice — so this fails hard
         * instead of returning rows. A refusal here is not a question anyone
         * can rephrase; it is a layer that is not safe to query.
         */
        if (! in_array(BelongsToOrganization::class, class_uses_recursive($modelClass), true)) {
            throw new LogicException(sprintf(
                "AI mode will not query '%s': %s does not carry BelongsToOrganization, so nothing would confine the answer to one organization.",
                $entityKey,
                $modelClass
            ));
        }

        /** @var Builder $query */
        $query = $modelClass::query();

        foreach ($spec['joins'] ?? [] as [$table, $first, $operator, $second]) {
            $query->join($table, $first, $operator, $second);
        }

        return $query;
    }

    /**
     * §4: the entity's own joins come before any dimension join.
     *
     * Only the ones the plan actually reaches for. A wide table derives a join
     * per foreign key — `leave_requests` alone has four onto `users` — and
     * joining twenty tables to read one column is a slow way to get the same
     * answer. A join is applied when an alias it introduces is named by
     * something this plan selects, filters or measures.
     *
     * LEFT, always. An inner join to `groups` for a department dimension drops
     * everybody who has no department, and then "(unassigned)" never appears
     * and the breakdown quietly stops summing to the headcount above it.
     *
     * @param  array<string, mixed>  $entity
     * @param  array<string, array<string, mixed>>  $metrics
     * @param  array<string, array<string, mixed>>  $dimensions
     * @param  array<string, array<string, mixed>>  $columns
     * @param  list<array<string, mixed>>  $filters
     */
    private function applyJoins(
        Builder $query,
        string $entityKey,
        array $entity,
        array $metrics,
        array $dimensions,
        array $columns,
        array $filters
    ): void {
        $referenced = $this->referencedExpressions($entity, $metrics, $dimensions, $columns, $filters);

        // Seeded with what `baseQuery()` already joined, so a dimension naming
        // the same table cannot join it a second time under the same name.
        $applied = [];
        foreach (self::BASE_QUERIES[$entityKey]['joins'] ?? [] as $join) {
            $applied[$this->aliasOf($join[0])] = implode(' ', $join);
        }

        foreach ($entity['joins'] ?? [] as $join) {
            [$table, $first, $operator, $second] = $join;
            $alias = $this->aliasOf($table);

            $isReferenced = false;
            foreach ($referenced as $expression) {
                if (str_starts_with($expression, $alias.'.')) {
                    $isReferenced = true;

                    break;
                }
            }

            if (! $isReferenced) {
                continue;
            }

            $this->join($query, $applied, $alias, [$table, $first, $operator, $second]);
        }

        foreach ($dimensions + $columns as $definition) {
            $join = $definition['join'] ?? null;

            if ($join === null) {
                continue;
            }

            [$table, $first, $operator, $second] = $join;
            $this->join($query, $applied, $this->aliasOf($table), [$table, $first, $operator, $second]);
        }

        foreach ($filters as $filter) {
            $join = $filter['definition']['join'] ?? null;

            if ($join === null) {
                continue;
            }

            [$table, $first, $operator, $second] = $join;
            $this->join($query, $applied, $this->aliasOf($table), [$table, $first, $operator, $second]);
        }
    }

    /**
     * One join per alias. A second join under the same alias is a SQL error,
     * and the same alias with a DIFFERENT `on` clause would silently answer
     * about other rows than the one the plan named — so that is refused rather
     * than resolved by arrival order.
     *
     * @param  array<string, string>  $applied  alias => signature
     * @param  array{0: string, 1: string, 2: string, 3: string}  $join
     */
    private function join(Builder $query, array &$applied, string $alias, array $join): void
    {
        $signature = implode(' ', $join);

        if (isset($applied[$alias])) {
            if ($applied[$alias] !== $signature) {
                throw new UnsupportedQuestionException(sprintf(
                    "This plan needs '%s' joined two different ways at once, so I cannot answer it in one query.",
                    $alias
                ));
            }

            return;
        }

        $applied[$alias] = $signature;

        [$table, $first, $operator, $second] = $join;
        $query->leftJoin($table, $first, $operator, $second);
    }

    /** `groups as groups_via_department_id` → `groups_via_department_id`. */
    private function aliasOf(string $table): string
    {
        $parts = preg_split('/\s+as\s+/i', trim($table));

        return trim(end($parts));
    }

    /**
     * Every column expression this plan touches, so `applyJoins()` knows which
     * of the entity's joins are load-bearing.
     *
     * @param  array<string, mixed>  $entity
     * @param  array<string, array<string, mixed>>  $metrics
     * @param  array<string, array<string, mixed>>  $dimensions
     * @param  array<string, array<string, mixed>>  $columns
     * @param  list<array<string, mixed>>  $filters
     * @return list<string>
     */
    private function referencedExpressions(
        array $entity,
        array $metrics,
        array $dimensions,
        array $columns,
        array $filters
    ): array {
        $expressions = [];

        /*
         * A join's own ON clause counts as a reference.
         *
         * A dimension carries one join, which is enough for a one-hop
         * department off `employee_work_infos` or `payroll_items`. `activities`
         * is two hops — an activity knows its user, and only that user's work
         * info knows their reporting group — so the first hop is an ENTITY
         * join and the dimension's join hangs off it. Reading only `select`
         * left the entity join unreferenced, which emitted
         * `left join groups on groups.id = employee_work_infos.report_group_id`
         * with `employee_work_infos` never joined: a SQL error, not an empty
         * result. Entity joins are applied before dimension joins, so naming
         * the on-clause here is all it takes for the chain to be built in
         * order.
         */
        $fromJoin = function (?array $join) use (&$expressions): void {
            if ($join === null) {
                return;
            }

            // [table, first, operator, second] — 1 and 3 are the columns.
            $expressions[] = (string) $join[1];
            $expressions[] = (string) $join[3];
        };

        foreach ($dimensions + $columns as $definition) {
            $expressions[] = (string) $definition['select'];
            $fromJoin($definition['join'] ?? null);
        }

        foreach ($filters as $filter) {
            $expressions[] = (string) $filter['definition']['select'];
            $fromJoin($filter['definition']['join'] ?? null);
        }

        foreach ($metrics as $metric) {
            if (($metric['column'] ?? null) !== null) {
                $expressions[] = $this->qualify((string) $metric['column'], $entity);
            }

            foreach ($metric['where'] ?? [] as $clause) {
                $expressions[] = $this->qualify((string) $clause[0], $entity);
            }

            foreach ($metric['span'] ?? [] as $column) {
                $expressions[] = (string) $column;
            }
        }

        return $expressions;
    }

    // ---------------------------------------------------------------- filters

    /** @param array<string, mixed> $filter */
    private function applyFilter(Builder $query, array $filter): void
    {
        $column = $this->identifier((string) $filter['definition']['select']);
        $op = $filter['op'];
        $value = $filter['value'];
        $format = $this->dateFormatFor($filter['definition']);

        if ($op === 'is_null') {
            $query->whereRaw("{$column} is null");

            return;
        }

        if ($op === 'is_not_null') {
            $query->whereRaw("{$column} is not null");

            return;
        }

        if ($op === 'contains') {
            /*
             * §2: escaping is mandatory. An unescaped '%' returns the whole
             * table — the search-box table dump, arriving through a question
             * instead of through a search box. The pattern is the one
             * `SearchController::likePattern()` already uses, and ESCAPE is
             * spelled out because SQLite has no default escape character at
             * all, so omitting it leaves the wildcards live on the suite's own
             * driver.
             */
            $pattern = '%'.str_replace(
                ['\\', '%', '_'],
                ['\\\\', '\\%', '\\_'],
                mb_strtolower((string) $value)
            ).'%';

            $query->whereRaw("lower({$column}) like ? escape '\\'", [$pattern]);

            return;
        }

        if ($op === 'period') {
            if ($format === null) {
                /*
                 * §3, refused rather than attempted. Comparing a date range
                 * against a column that does not hold dates matches nothing,
                 * and nothing reads as "there were none" rather than "I could
                 * not ask that".
                 */
                throw new UnsupportedQuestionException(sprintf(
                    "'%s' is not stored as a date, so I cannot narrow it to a period.",
                    $filter['field']
                ));
            }

            [$from, $until] = $this->boundsFrom(
                $format,
                (string) ($value['start'] ?? ''),
                (string) ($value['end'] ?? ''),
                $filter['field']
            );

            $query->whereRaw("{$column} >= ? and {$column} < ?", [$from, $until]);

            return;
        }

        if ($format !== null) {
            $this->applyDateFilter($query, $column, $format, $filter);

            return;
        }

        $this->applyScalarFilter($query, $column, $filter);
    }

    /** @param array<string, mixed> $filter */
    private function applyScalarFilter(Builder $query, string $column, array $filter): void
    {
        $op = $filter['op'];
        $value = $filter['value'];

        if (isset(self::SCALAR_COMPARISONS[$op])) {
            $query->whereRaw("{$column} ".self::SCALAR_COMPARISONS[$op].' ?', [$value]);

            return;
        }

        if ($op === 'between') {
            $bounds = array_values((array) $value);
            $query->whereRaw("{$column} >= ? and {$column} <= ?", [$bounds[0], $bounds[1]]);

            return;
        }

        if ($op === 'in' || $op === 'not_in') {
            $values = array_values((array) $value);
            $placeholders = implode(', ', array_fill(0, count($values), '?'));
            $negation = $op === 'not_in' ? 'not ' : '';

            $query->whereRaw("{$column} {$negation}in ({$placeholders})", $values);

            return;
        }

        throw new UnsupportedQuestionException(sprintf(
            "I cannot apply '%s' to '%s'.",
            $op,
            $filter['field']
        ));
    }

    /**
     * §3, for every operator that is a comparison rather than a pattern.
     *
     * Each operand becomes a HALF-OPEN range in the column's own granularity,
     * which is what makes the same code correct in all four awkward
     * combinations: a `Y-m` bound on a `YYYY-MM` string column, a `Y-m` bound
     * on a real date column, a `Y-m-d` bound on a date column, and a `Y-m-d`
     * bound on a TIMESTAMP column — where `<= '2026-12-31'` would otherwise
     * throw away every row stamped after midnight on the last day.
     *
     * @param  array<string, mixed>  $filter
     */
    private function applyDateFilter(Builder $query, string $column, string $format, array $filter): void
    {
        $op = $filter['op'];
        $field = $filter['field'];
        $value = $filter['value'];

        if ($op === 'between') {
            $bounds = array_values((array) $value);
            [$from] = $this->boundsOf($format, $bounds[0], $field);
            [, $until] = $this->boundsOf($format, $bounds[1], $field);

            $query->whereRaw("{$column} >= ? and {$column} < ?", [$from, $until]);

            return;
        }

        if ($op === 'in' || $op === 'not_in') {
            $clauses = [];
            $bindings = [];

            foreach (array_values((array) $value) as $item) {
                [$from, $until] = $this->boundsOf($format, $item, $field);
                $clauses[] = "({$column} >= ? and {$column} < ?)";
                $bindings[] = $from;
                $bindings[] = $until;
            }

            $sql = '('.implode(' or ', $clauses).')';
            $query->whereRaw($op === 'in' ? $sql : "not {$sql}", $bindings);

            return;
        }

        [$from, $until] = $this->boundsOf($format, $value, $field);

        match ($op) {
            // "on that day/month" is a range, not a point: a timestamp column
            // has no value equal to '2026-07-01' at all.
            'eq' => $query->whereRaw("{$column} >= ? and {$column} < ?", [$from, $until]),
            'neq' => $query->whereRaw("({$column} < ? or {$column} >= ?)", [$from, $until]),
            'gte' => $query->whereRaw("{$column} >= ?", [$from]),
            'gt' => $query->whereRaw("{$column} >= ?", [$until]),
            'lt' => $query->whereRaw("{$column} < ?", [$from]),
            'lte' => $query->whereRaw("{$column} < ?", [$until]),
            default => throw new UnsupportedQuestionException(sprintf(
                "I cannot apply '%s' to the date field '%s'.",
                $op,
                $field
            )),
        };
    }

    /**
     * The format a value must be written in to be comparable with this column.
     *
     * Declared by the layer (§4) or, for a column the layer calls a date
     * without saying more, the ISO day. Never guessed from the values: reading
     * a text column as though it held `YYYY-MM` is the same sin as guessing a
     * period, and it fails the same silent way.
     *
     * @param  array<string, mixed>  $definition
     */
    private function dateFormatFor(array $definition): ?string
    {
        $declared = $definition['date_format'] ?? null;

        if (is_string($declared) && $declared !== '') {
            return $declared;
        }

        return ($definition['type'] ?? null) === 'date' ? 'Y-m-d' : null;
    }

    /**
     * One operand → `[from, until)` in the column's format.
     *
     * The operand's OWN precision decides the span it covers: `2026` is a
     * year, `2026-07` is a month, `2026-07-15` is a day. Expressing that span
     * in the column's format is what lets "on or before July" mean the end of
     * July on a daily column and the July row on a monthly one.
     *
     * @return array{0: string, 1: string}
     */
    private function boundsOf(string $format, mixed $value, string $field): array
    {
        [$start, $end] = $this->calendarSpanOf($value, $field);

        return $this->boundsFrom($format, $start, $end, $field);
    }

    /**
     * An inclusive `Y-m-d` span → the half-open pair the column understands.
     *
     * @return array{0: string, 1: string}
     */
    private function boundsFrom(string $format, string $start, string $end, string $field): array
    {
        $from = $this->parseDate($start, $field)->format($format);
        $lastIncluded = $this->parseDate($end, $field)->format($format);

        return [$from, $this->nextInFormat($format, $lastIncluded, $field)];
    }

    /**
     * The next distinct value a column of this format can hold. `2026-07` is
     * followed by `2026-08`, not by `2026-07-02` — an upper bound computed in
     * the wrong granularity is an empty range wearing the right answer's shape.
     */
    private function nextInFormat(string $format, string $value, string $field): string
    {
        $moment = $this->parseDate($value, $field);

        return match ($format) {
            'Y-m-d' => $moment->addDay()->format($format),
            // addMonth() on the 31st lands in the month after next; the
            // no-overflow form is the one that means "the following month".
            'Y-m' => $moment->addMonthNoOverflow()->format($format),
            'Y' => $moment->addYear()->format($format),
            default => throw new UnsupportedQuestionException(sprintf(
                "'%s' is stored in a date format I cannot compare against (%s).",
                $field,
                $format
            )),
        };
    }

    /**
     * A value's own calendar span, inclusive, as `Y-m-d` strings.
     *
     * @return array{0: string, 1: string}
     */
    private function calendarSpanOf(mixed $value, string $field): array
    {
        $raw = is_string($value) ? trim($value) : (string) $value;

        if (preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $raw) === 1) {
            return [$raw, $raw];
        }

        if (preg_match('/^(\d{4})-(\d{2})$/', $raw) === 1) {
            $start = $this->parseDate($raw.'-01', $field);

            return [$start->toDateString(), $start->endOfMonth()->toDateString()];
        }

        if (preg_match('/^(\d{4})$/', $raw) === 1) {
            $start = $this->parseDate($raw.'-01-01', $field);

            return [$start->toDateString(), $start->endOfYear()->toDateString()];
        }

        $moment = $this->parseDate($raw, $field);

        return [$moment->toDateString(), $moment->toDateString()];
    }

    private function parseDate(string $value, string $field): CarbonImmutable
    {
        try {
            return CarbonImmutable::parse($value)->startOfDay();
        } catch (\Throwable $e) {
            throw new UnsupportedQuestionException(sprintf(
                "'%s' is not a date I can compare '%s' against.",
                $value,
                $field
            ));
        }
    }

    // -------------------------------------------------------------- execution

    /**
     * @param  array<string, mixed>  $entity
     * @param  array<string, array<string, mixed>>  $metrics
     * @param  array<string, array<string, mixed>>  $dimensions
     * @param  array<string, mixed>  $plan
     * @return array{columns: list<array<string, string>>, rows: list<array<string, mixed>>, notes: list<string>, truncated: bool}
     */
    private function executeAggregate(
        Builder $query,
        array $entity,
        array $metrics,
        array $dimensions,
        array $plan,
        int $limit
    ): array {
        $selects = [];
        $bindings = [];
        $responseColumns = [];
        $aliases = [];

        $index = 0;
        foreach ($dimensions as $key => $dimension) {
            $expression = $this->identifier((string) $dimension['select']);
            $alias = self::DIMENSION_ALIAS.$index;

            /*
             * cast(... as text), not PostgreSQL's `::text`: the app runs on
             * PostgreSQL and the whole suite runs on SQLite, which does not
             * parse `::` at all. The cast is not optional either way — a
             * dimension over a date or a numeric column cannot be coalesced
             * with a string label without one.
             *
             * The label is BOUND rather than interpolated. It comes from the
             * layer today; a bound value cannot become SQL tomorrow.
             */
            $selects[] = "coalesce(cast({$expression} as text), ?) as {$alias}";
            $bindings[] = (string) ($dimension['null_label'] ?? '(not set)');

            $query->groupBy(DB::raw($expression));

            /*
             * Group by the identity too, where the dimension has one.
             *
             * A foreign-key dimension SELECTS a label — `users.name` — and a
             * label is not unique. Twelve users here share the name "QA E2E",
             * and grouping on the name alone reported their combined 47
             * absences as one person's, in a 31-day month.
             *
             * Both columns go in the GROUP BY rather than the id alone:
             * PostgreSQL only infers functional dependency from the grouped
             * table's own primary key, and the label comes from a joined
             * alias, so selecting it while grouping only by the foreign key
             * is an error there even though SQLite allows it.
             */
            if (! empty($dimension['identity'])) {
                $query->groupBy(DB::raw($this->identifier((string) $dimension['identity'])));
            }

            // 'text' rather than the dimension's own type, and truthfully so:
            // after the coalesce the value IS a string, null label and all.
            $responseColumns[] = ['key' => $key, 'label' => (string) $dimension['label'], 'type' => 'text'];
            $aliases[$key] = $alias;
            $index++;
        }

        $index = 0;
        $havingByMetric = [];
        foreach ($metrics as $key => $metric) {
            $aggregate = $this->aggregate($metric, $entity, $query);
            $alias = self::METRIC_ALIAS.$index;

            $selects[] = "{$aggregate['sql']} as {$alias}";
            $bindings = array_merge($bindings, $aggregate['bindings']);

            $responseColumns[] = [
                'key' => $key,
                'label' => (string) $metric['label'],
                'type' => (string) $metric['type'],
            ];
            $aliases[$key] = $alias;
            $havingByMetric[$key] = $aggregate;
            $index++;
        }

        // The census that tells "nothing matched" apart from "the answer is 0".
        $selects[] = 'count(*) as '.self::POPULATION_ALIAS;

        $query->selectRaw(implode(', ', $selects), $bindings);

        $this->applyHaving($query, $plan, $havingByMetric);
        $this->applySort($query, $plan, $aliases, array_key_first($aliases));

        $records = $query->limit($limit + 1)->get();
        $truncated = $records->count() > $limit;
        $records = $records->take($limit);

        $rows = [];
        foreach ($records as $record) {
            $attributes = $record->getAttributes();
            $row = [];

            foreach ($aliases as $key => $alias) {
                $row[$key] = $attributes[$alias] ?? null;
            }

            $rows[] = $row;
        }

        /*
         * §6, and the defect this whole design exists to stop. An aggregate
         * with no grouping returns exactly one row over an empty table, and
         * that row says `count: 0` — which reads as "there are none of those"
         * when the truth is "nothing was measured". A grouped aggregate cannot
         * hit this: a group only exists because rows fell into it.
         */
        if ($dimensions === []
            && count($rows) === 1
            && (int) ($records->first()?->getAttributes()[self::POPULATION_ALIAS] ?? 0) === 0) {
            $rows = [];
        }

        return ['columns' => $responseColumns, 'rows' => $rows, 'notes' => [], 'truncated' => $truncated];
    }

    /**
     * @param  array<string, array<string, mixed>>  $columns
     * @param  array<string, mixed>  $plan
     * @return array{columns: list<array<string, string>>, rows: list<array<string, mixed>>, notes: list<string>, truncated: bool}
     */
    private function executeList(Builder $query, array $columns, array $plan, int $limit): array
    {
        $selects = [];
        $responseColumns = [];
        $aliases = [];

        $index = 0;
        foreach ($columns as $key => $column) {
            $expression = $this->identifier((string) $column['select']);
            $alias = self::COLUMN_ALIAS.$index;

            // §4: never SELECT *. Every column here was named in the plan and
            // matched against the entity's allow-list before it got here.
            $selects[] = "{$expression} as {$alias}";

            $responseColumns[] = [
                'key' => $key,
                'label' => (string) $column['label'],
                'type' => (string) ($column['type'] ?? 'text'),
            ];
            $aliases[$key] = $alias;
            $index++;
        }

        $query->selectRaw(implode(', ', $selects));

        $this->applySort($query, $plan, $aliases, array_key_first($aliases));

        $records = $query->limit($limit + 1)->get();
        $truncated = $records->count() > $limit;
        $records = $records->take($limit);

        $rows = [];
        foreach ($records as $record) {
            $attributes = $record->getAttributes();
            $row = [];

            foreach ($aliases as $key => $alias) {
                $row[$key] = $attributes[$alias] ?? null;
            }

            $rows[] = $row;
        }

        return ['columns' => $responseColumns, 'rows' => $rows, 'notes' => [], 'truncated' => $truncated];
    }

    /**
     * §6: a `having` applies to the aggregate expression, not to a re-derived
     * one. The same compiled expression goes into the SELECT and the HAVING,
     * so a threshold can never be applied to a different number than the one
     * the answer shows.
     *
     * @param  array<string, mixed>  $plan
     * @param  array<string, array{sql: string, bindings: list<mixed>}>  $aggregates
     */
    private function applyHaving(Builder $query, array $plan, array $aggregates): void
    {
        foreach ($plan['having'] ?? [] as $clause) {
            $metric = (string) ($clause['metric'] ?? '');
            $op = (string) ($clause['op'] ?? '');
            $value = $clause['value'] ?? null;

            if (! isset($aggregates[$metric])) {
                throw new UnsupportedQuestionException(sprintf(
                    "'%s' is not one of the metrics this plan computes, so there is no value to compare it against.",
                    $metric
                ));
            }

            $sql = $aggregates[$metric]['sql'];

            if ($op === 'between') {
                $bounds = array_values((array) $value);

                $query->havingRaw(
                    "{$sql} >= ? and {$sql} <= ?",
                    array_merge($aggregates[$metric]['bindings'], [$bounds[0]], $aggregates[$metric]['bindings'], [$bounds[1]])
                );

                continue;
            }

            if (! isset(self::SCALAR_COMPARISONS[$op])) {
                throw new UnsupportedQuestionException(sprintf(
                    "'%s' cannot be applied to the metric '%s'.",
                    $op,
                    $metric
                ));
            }

            $query->havingRaw(
                "{$sql} ".self::SCALAR_COMPARISONS[$op].' ?',
                array_merge($aggregates[$metric]['bindings'], [$value])
            );
        }
    }

    /**
     * §1's sort, over the aliases this query actually produced.
     *
     * With NO sort the order still has to be deterministic, because `limit`
     * decides which rows survive: an arbitrary order means "the top five" is
     * whichever five the planner happened to reach first, and `truncated: true`
     * beside an arbitrary five is a worse answer than a slow one. The default
     * is the leading column — the first group-by in an aggregate, the first
     * column in a listing — ascending, which is the order a human reads a name
     * or a month in.
     *
     * @param  array<string, mixed>  $plan
     * @param  array<string, string>  $aliases
     */
    private function applySort(Builder $query, array $plan, array $aliases, ?string $fallback): void
    {
        $sort = $plan['sort'] ?? null;

        if (is_array($sort) && isset($sort['by'])) {
            $by = (string) $sort['by'];

            if (! isset($aliases[$by])) {
                throw new UnsupportedQuestionException(sprintf(
                    "This plan cannot sort by '%s' — it does not compute it.",
                    $by
                ));
            }

            $query->orderBy($aliases[$by], ($sort['dir'] ?? 'desc') === 'asc' ? 'asc' : 'desc');

            return;
        }

        if ($fallback !== null) {
            $query->orderBy($aliases[$fallback], 'asc');
        }
    }

    // ------------------------------------------------------------- aggregates

    /**
     * A metric compiled into ONE aggregate expression, exclusion included.
     *
     * The exclusion is a CASE inside the aggregate rather than a WHERE on the
     * query, and that is the whole reason multi-metric works: `count` and
     * `avg_net_pay` in one plan need different populations, and a WHERE can
     * only give them the same one. `avg` and `sum` ignore the nulls the CASE
     * produces, and `count` counts only what the CASE kept, so each number is
     * identical to what the single-metric query used to return.
     *
     * @param  array<string, mixed>  $metric
     * @param  array<string, mixed>  $entity
     * @return array{sql: string, bindings: list<mixed>}
     */
    private function aggregate(array $metric, array $entity, Builder $query): array
    {
        [$condition, $bindings] = $this->metricCondition($metric, $entity);
        $function = (string) $metric['aggregate'];

        if ($function === 'rate') {
            return $this->rate($metric, $entity, $query, $condition, $bindings);
        }

        if ($function === 'count') {
            return [
                'sql' => $condition === null ? 'count(*)' : "count(case when {$condition} then 1 end)",
                'bindings' => $bindings,
            ];
        }

        $value = $this->metricValue($metric, $entity, $query);

        return [
            'sql' => $this->rounded($condition === null
                ? "{$function}({$value})"
                : "{$function}(case when {$condition} then {$value} end)", $metric),
            'bindings' => $bindings,
        ];
    }

    /**
     * `aggregate => 'rate'`: one population as a percentage of another, both
     * measured over the same column and the same rows.
     *
     * The metric's `where` IS the denominator and `numerator` narrows it, which
     * is the whole reason this is one metric rather than two. Computed as two
     * independent metrics the halves can be drawn from different populations —
     * that is how a percentage comes back over 100 — and a reader has no way to
     * tell from the answer that it happened.
     *
     * NULLIF, not a guard clause: a group with nothing tracked yields NULL and
     * renders blank. "Nothing was measured here" and "they were 0% productive"
     * are different facts and only one of them is ever true (§6.4).
     *
     * @param  array<string, mixed>  $metric
     * @param  array<string, mixed>  $entity
     * @param  list<mixed>  $bindings  the denominator's, in order
     * @return array{sql: string, bindings: list<mixed>}
     */
    private function rate(array $metric, array $entity, Builder $query, ?string $denominator, array $bindings): array
    {
        [$narrowing, $narrowingBindings] = $this->metricCondition(
            ['label' => $metric['label'] ?? 'rate', 'where' => $metric['numerator'] ?? []],
            $entity
        );

        if ($narrowing === null) {
            throw new LogicException(sprintf(
                "The rate metric '%s' names no numerator, so it would report 100%% of itself.",
                (string) ($metric['label'] ?? 'unnamed')
            ));
        }

        $value = $this->metricValue($metric, $entity, $query);
        $whole = $denominator ?? '1 = 1';
        $part = $denominator === null ? $narrowing : "{$denominator} and {$narrowing}";

        return [
            'sql' => $this->rounded(sprintf(
                '100.0 * sum(case when %s then %s end) / nullif(sum(case when %s then %s end), 0)',
                $part,
                $value,
                $whole,
                $value
            ), $metric),
            // Bound in the order they appear in the SQL above: the numerator's
            // CASE carries the denominator's clauses first, then its own.
            'bindings' => array_merge($bindings, $narrowingBindings, $bindings),
        ];
    }

    /**
     * §12: the answer is stated to the precision the definition claims, in SQL,
     * so the stored value and the rendered one cannot disagree.
     *
     * Rounding here rather than in PHP is what keeps a `having` threshold
     * applied to the same number the reader sees — `applyHaving()` reuses this
     * exact expression.
     *
     * @param  array<string, mixed>  $metric
     */
    private function rounded(string $sql, array $metric): string
    {
        $places = $metric['round'] ?? null;

        if ($places === null) {
            return $sql;
        }

        if (! is_int($places) || $places < 0 || $places > 6) {
            throw new LogicException(sprintf(
                "The metric '%s' asks to be rounded to '%s' places, which is not a precision this executor will build.",
                (string) ($metric['label'] ?? 'unnamed'),
                var_export($places, true)
            ));
        }

        return "round({$sql}, {$places})";
    }

    /**
     * What the aggregate is taken OVER: a column, or the span a curated metric
     * declares instead.
     *
     * `leave_days_taken` is a sum over `(end_date - start_date + 1)` — one
     * five-day request is five days taken, not one row — and the two drivers
     * spell that differently, which is exactly why `MetricOverrides` names the
     * columns and leaves the arithmetic here.
     *
     * @param  array<string, mixed>  $metric
     * @param  array<string, mixed>  $entity
     */
    private function metricValue(array $metric, array $entity, Builder $query): string
    {
        $span = $metric['span'] ?? null;

        if (is_array($span) && isset($span['start'], $span['end'])) {
            $start = $this->identifier((string) $span['start']);
            $end = $this->identifier((string) $span['end']);
            $driver = $query->getConnection()->getDriverName();

            return match ($driver) {
                'sqlite' => "(julianday({$end}) - julianday({$start}) + 1)",
                'pgsql' => "({$end} - {$start} + 1)",
                default => throw new LogicException(sprintf(
                    "A day span is not implemented for the '%s' driver; '%s' cannot be computed here.",
                    $driver,
                    (string) $metric['label']
                )),
            };
        }

        if (($metric['column'] ?? null) === null) {
            throw new LogicException(sprintf(
                "The metric '%s' aggregates but names neither a column nor a span.",
                (string) $metric['label']
            ));
        }

        $expression = $this->identifier($this->qualify((string) $metric['column'], $entity));

        /*
         * `cap` clips each row BEFORE the aggregate, which is not the same as
         * filtering the row out and is why it cannot be a `where` clause.
         * UsageProcessingService clips every activity row to
         * `max_log_duration_seconds` at read time, and a non-idle row is not
         * bounded when it is written — so a raw SUM reports 8.3 hours for a row
         * every Monitoring screen reports as 4. Dropping the row instead would
         * lose the first four hours too.
         */
        $cap = $metric['cap'] ?? null;

        if ($cap !== null) {
            if (! is_int($cap) || $cap <= 0) {
                throw new LogicException(sprintf(
                    "The metric '%s' declares a cap of '%s', which is not a positive integer.",
                    (string) $metric['label'],
                    var_export($cap, true)
                ));
            }

            $driver = $query->getConnection()->getDriverName();

            $expression = match ($driver) {
                'sqlite' => "min({$expression}, {$cap})",
                'pgsql' => "least({$expression}, {$cap})",
                default => throw new LogicException(sprintf(
                    "A per-row cap is not implemented for the '%s' driver; '%s' cannot be computed here.",
                    $driver,
                    (string) $metric['label']
                )),
            };
        }

        /*
         * `scale` is a unit conversion, nothing more: durations are stored in
         * seconds and nobody asks for 119,340 seconds of productive time. It
         * divides the ROW, so it commutes with sum and cancels out of a rate.
         */
        $scale = $metric['scale'] ?? null;

        if ($scale !== null) {
            if (! is_int($scale) || $scale <= 0) {
                throw new LogicException(sprintf(
                    "The metric '%s' declares a scale of '%s', which is not a positive integer.",
                    (string) $metric['label'],
                    var_export($scale, true)
                ));
            }

            // The `.0` is load-bearing on PostgreSQL: integer / integer is
            // integer division there, so a 45-minute row would scale to 0 hours.
            $expression = "({$expression} / {$scale}.0)";
        }

        return $expression;
    }

    /**
     * @param  array<string, mixed>  $metric
     * @param  array<string, mixed>  $entity
     * @return array{0: string|null, 1: list<mixed>}
     */
    private function metricCondition(array $metric, array $entity): array
    {
        $parts = [];
        $bindings = [];

        foreach ($metric['where'] ?? [] as $clause) {
            [$column, $operator, $value] = $clause;

            /*
             * Emptiness is a comparison no placeholder can carry: `col = ?`
             * with a null binding is NULL, never true, so a metric written that
             * way silently measures nothing. Two curated definitions need it —
             * "activity the tracker has not classified" and "the person has not
             * been deactivated" — and both are exclusions, which is exactly the
             * kind of clause that must never fail quietly.
             */
            if ($operator === 'is null' || $operator === 'not null') {
                $parts[] = $this->identifier($this->qualify((string) $column, $entity))
                    .($operator === 'is null' ? ' is null' : ' is not null');

                continue;
            }

            if (! in_array($operator, self::METRIC_COMPARISONS, true)) {
                throw new LogicException(sprintf(
                    "The metric '%s' uses the comparison '%s', which this executor does not build.",
                    (string) $metric['label'],
                    (string) $operator
                ));
            }

            $parts[] = $this->identifier($this->qualify((string) $column, $entity)).' '.$operator.' ?';
            $bindings[] = $value;
        }

        return [$parts === [] ? null : implode(' and ', $parts), $bindings];
    }

    /**
     * A bare column name belongs to the entity's own table.
     *
     * Derivation builds joins from real foreign keys, so an unqualified
     * `status` is ambiguous the moment a dimension joins another table that
     * also has one: PostgreSQL refuses it outright, and a dialect that resolves
     * it silently picks a column nobody chose.
     *
     * @param  array<string, mixed>  $entity
     */
    private function qualify(string $column, array $entity): string
    {
        if (str_contains($column, '.')) {
            return $column;
        }

        $table = $entity['table'] ?? null;

        return is_string($table) && $table !== '' ? $table.'.'.$column : $column;
    }

    private function identifier(string $expression): string
    {
        if (preg_match(self::IDENTIFIER, $expression) !== 1) {
            throw new LogicException(sprintf(
                "'%s' is not a column reference this executor will put into SQL.",
                $expression
            ));
        }

        return $expression;
    }

    // ------------------------------------------------------------------ notes

    /**
     * §6 and §12: what was actually computed, said out loud.
     *
     * A metric's hand-written note wins when it has one — somebody wrote it
     * knowing why the definition is what it is. A curated metric without one
     * still has to say something, because "absent days" reads as obvious and
     * is not: it is the rows marked absent, and lateness is a different
     * question measured a different way.
     *
     * @param  array<string, array<string, mixed>>  $metrics
     * @param  array<string, mixed>  $entity
     * @return list<string>
     */
    private function metricNotes(array $metrics, array $entity): array
    {
        $notes = [];

        foreach ($metrics as $key => $metric) {
            $note = $metric['note'] ?? null;

            $notes[] = is_string($note) && trim($note) !== ''
                ? $note
                : $this->definitionOf($key, $metric, $entity);
        }

        return $notes;
    }

    /**
     * @param  array<string, mixed>  $metric
     * @param  array<string, mixed>  $entity
     */
    private function definitionOf(string $key, array $metric, array $entity): string
    {
        $function = strtoupper((string) $metric['aggregate']);

        if (isset($metric['span']['start'], $metric['span']['end'])) {
            $over = 'days per row';
        } elseif (($metric['column'] ?? null) !== null) {
            $over = (string) $metric['column'];
        } else {
            $over = '*';
        }

        $conditions = [];
        foreach ($metric['where'] ?? [] as $clause) {
            $conditions[] = sprintf('%s %s %s', $clause[0], $clause[1], $this->quote($clause[2]));
        }

        return sprintf(
            '%s = %s(%s) over %s%s.',
            $key,
            $function,
            $over,
            (string) ($entity['table'] ?? 'the rows'),
            $conditions === [] ? ', with no exclusions' : ' where '.implode(' and ', $conditions)
        );
    }

    private function quote(mixed $value): string
    {
        return is_string($value) ? "'".$value."'" : (string) $value;
    }

    /**
     * A curated dimension carries a note for the same reason a curated metric
     * does: "department" is the reporting group and not the access group, and
     * a reader who assumes the other one reads the table wrong.
     *
     * @param  array<string, array<string, mixed>>  $dimensions
     * @return list<string>
     */
    private function dimensionNotes(array $dimensions): array
    {
        $notes = [];

        foreach ($dimensions as $dimension) {
            $note = $dimension['note'] ?? null;

            if (is_string($note) && trim($note) !== '') {
                $notes[] = $note;
            }
        }

        return $notes;
    }

    /**
     * §6: the resolved period, in words. The label comes from `PeriodResolver`,
     * which derives it from the bounds rather than from the token — a label
     * computed from the words can disagree with the range it describes, and
     * this line exists precisely so a reader can catch that.
     *
     * @param  list<array<string, mixed>>  $filters
     * @return list<string>
     */
    private function periodNotes(array $filters): array
    {
        $periods = array_values(array_filter($filters, fn (array $f) => $f['op'] === 'period'));
        $notes = [];

        foreach ($periods as $filter) {
            $label = $filter['value']['label'] ?? null;

            if (! is_string($label) || $label === '') {
                continue;
            }

            $notes[] = count($periods) > 1
                ? sprintf('Period (%s): %s', (string) $filter['definition']['label'], $label)
                : 'Period: '.$label;
        }

        return $notes;
    }

    /**
     * §12, the honesty clause: a number the reader cannot check has to describe
     * its own input.
     *
     * Two censuses, one extra query, both counted over the SAME filtered
     * population the answer is drawn from and through each metric's own
     * exclusion — a census that ignored the exclusion would describe rows the
     * number never saw.
     *
     * 1. **A derived aggregate excludes nothing by construction**, so when its
     *    input holds zeros or blanks the answer says how many it counted. This
     *    is the ₹76,313 failure caught at read time rather than shipped. The
     *    reader can then say "exclude the zeros", and that sentence becomes a
     *    curated override — the whole maintenance model, and it only works if
     *    the wrong number announces itself.
     *
     * 2. **A span cannot be negative**, and on this database 31 approved leave
     *    requests end before they start. `leave_days_taken` faithfully summed
     *    them to MINUS 234 days: the definition is right, the rows are wrong,
     *    and a bare "-234" tells a reader neither. The number still comes back
     *    — refusing to answer because some rows are malformed is worse — but it
     *    comes back saying how many rows are subtracting from it.
     *
     * @param  array<string, array<string, mixed>>  $metrics
     * @param  array<string, mixed>  $entity
     * @return list<string>
     */
    private function inputCensusNotes(Builder $population, array $metrics, array $entity): array
    {
        $selects = [];
        $aliases = [];
        $index = 0;

        foreach ($metrics as $key => $metric) {
            [$condition] = $this->metricCondition($metric, $entity);
            $measured = $condition === null ? '1 = 1' : $condition;

            $span = $metric['span'] ?? null;
            $column = $metric['column'] ?? null;
            $isDerivedColumnAggregate = ($metric['origin'] ?? null) === 'derived'
                && $column !== null
                && in_array($metric['aggregate'], ['sum', 'avg', 'min', 'max'], true);

            if (! $isDerivedColumnAggregate && ! is_array($span)) {
                continue;
            }

            $aliases[$key] = ['metric' => $metric, 'total' => "ai_total_{$index}"];
            $selects[] = "sum(case when {$measured} then 1 else 0 end) as ai_total_{$index}";

            if ($isDerivedColumnAggregate) {
                $qualified = $this->identifier($this->qualify((string) $column, $entity));
                $aliases[$key] += ['zeros' => "ai_zero_{$index}", 'nulls' => "ai_null_{$index}"];
                $selects[] = "sum(case when {$measured} and {$qualified} = 0 then 1 else 0 end) as ai_zero_{$index}";
                $selects[] = "sum(case when {$measured} and {$qualified} is null then 1 else 0 end) as ai_null_{$index}";
            }

            if (is_array($span) && isset($span['start'], $span['end'])) {
                $start = $this->identifier((string) $span['start']);
                $end = $this->identifier((string) $span['end']);
                $aliases[$key] += ['backwards' => "ai_back_{$index}"];
                $selects[] = "sum(case when {$measured} and {$end} < {$start} then 1 else 0 end) as ai_back_{$index}";
            }

            $index++;
        }

        if ($selects === []) {
            return [];
        }

        // The census reuses every join and filter the answer was built from,
        // and only the metric bindings are re-supplied — a second, differently
        // filtered query would describe a population nobody asked about.
        $bindings = [];
        foreach ($aliases as $alias) {
            [, $metricBindings] = $this->metricCondition($alias['metric'], $entity);
            $repeats = 1 + (isset($alias['zeros']) ? 2 : 0) + (isset($alias['backwards']) ? 1 : 0);

            for ($i = 0; $i < $repeats; $i++) {
                $bindings = array_merge($bindings, $metricBindings);
            }
        }

        $record = $population->selectRaw(implode(', ', $selects), $bindings)->first();

        if ($record === null) {
            return [];
        }

        $attributes = $record->getAttributes();
        $notes = [];

        foreach ($aliases as $key => $alias) {
            $total = (int) ($attributes[$alias['total']] ?? 0);
            $zeros = isset($alias['zeros']) ? (int) ($attributes[$alias['zeros']] ?? 0) : 0;
            $nulls = isset($alias['nulls']) ? (int) ($attributes[$alias['nulls']] ?? 0) : 0;
            $backwards = isset($alias['backwards']) ? (int) ($attributes[$alias['backwards']] ?? 0) : 0;

            if ($zeros > 0 || $nulls > 0) {
                $parts = [];
                if ($zeros > 0) {
                    $parts[] = sprintf('%d where it is 0', $zeros);
                }
                if ($nulls > 0) {
                    $parts[] = sprintf('%d where nothing is recorded', $nulls);
                }

                $notes[] = sprintf(
                    '%s included all %d matching rows, %s — a derived metric excludes nothing.',
                    $key,
                    $total,
                    implode(' and ', $parts)
                );
            }

            if ($backwards > 0) {
                $notes[] = sprintf(
                    '%s counted %d of %d rows whose end date falls before its start date; each of those subtracts from this total, so the underlying records need fixing before the figure means anything.',
                    $key,
                    $backwards,
                    $total
                );
            }
        }

        return $notes;
    }
}
