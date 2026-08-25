<?php

namespace App\Services\Ai;

/**
 * Everything the model returns is untrusted input. Nothing reaches the query
 * builder without being matched against SemanticLayer by exact key — no fuzzy
 * matching, no nearest neighbour, no defaults that quietly substitute a
 * different number than the one asked for.
 *
 * This is the v2 grammar (§1-§5): a mode, up to four metrics or eight list
 * columns, up to two group-by dimensions, filters carrying every §2 operator,
 * thresholds on the aggregate, and a sort. The model's vocabulary grew; its
 * authority did not. It still picks names out of the layer and never authors an
 * aggregation, and everything still executes through Eloquent so
 * `BelongsToOrganization`'s global scope applies structurally.
 *
 * TWO RULES RUN THROUGH EVERY LINE HERE, and they pull in opposite directions.
 *
 * 1. **A plan naming something outside the layer is refused BY NAME.** Never
 *    "invalid plan": a refusal that says which word was wrong is recoverable,
 *    and one that does not is a dead end.
 * 2. **A filter this class cannot honour is refused, never dropped and never
 *    coerced.** "list employees who joined this year" answered `count: 0`
 *    against a true answer of 14. The model emitted
 *    `{"joining_date":{"gte":"2026-01-01","lte":"2026-12-31"}}`; the v1
 *    validator understood only flat equality, so it neither honoured the shape
 *    nor said so, and a query with no date filter at all came back as a
 *    confident zero. Every filter shape below is either NORMALISED into
 *    operator filters or refused naming the field it was written on. There is
 *    no third path, because the third path is the one that answers a question
 *    nobody asked.
 *
 * @see docs/superpowers/specs/2026-08-24-ai-mode-grammar-v2.md §1-§5
 */
class PlanValidator
{
    private const MAX_LIMIT = 500;
    private const DEFAULT_LIMIT = 20;

    /** §5.3 — the ceilings on a plan's shape. */
    private const MAX_METRICS = 4;
    private const MAX_COLUMNS = 8;
    private const MAX_GROUP_BY = 2;

    /** §2 — an `in` list is bounded so a plan cannot smuggle a table through it. */
    private const MAX_IN_VALUES = 50;

    private const MODES = ['aggregate', 'list'];

    /** §2, in full. Anything outside this list is refused by name. */
    private const OPERATORS = [
        'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
        'between', 'contains', 'in', 'not_in',
        'is_null', 'is_not_null', 'period',
    ];

    /** Operators whose meaning is complete without a value. */
    private const VALUELESS_OPERATORS = ['is_null', 'is_not_null'];

    /** Operators taking a set. */
    private const SET_OPERATORS = ['in', 'not_in'];

    /**
     * What a `having` may say. A threshold applies to a NUMBER the plan
     * computed, so `contains`, `period` and the null tests have nothing to
     * apply to — an aggregate is never null and never a date token.
     */
    private const HAVING_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between'];

    /**
     * @param  array<string, mixed>  $plan
     * @return array<string, mixed>
     */
    public function validate(array $plan): array
    {
        if (isset($plan['error']) && is_string($plan['error'])) {
            throw new UnsupportedQuestionException($plan['error']);
        }

        $entityKey = is_string($plan['entity'] ?? null) ? $plan['entity'] : '';
        $entity = SemanticLayer::entity($entityKey);

        if ($entity === null) {
            throw new UnsupportedQuestionException(
                sprintf("There is no '%s' data in this system.", $entityKey !== '' ? $entityKey : 'unknown')
            );
        }

        /*
         * The v1 singular shape is normalised, not refused. The planner's
         * prompt, the golden fixture and every saved plan still say
         * `"metric": "x"` and `"group_by": "y"`, and a grammar that cannot read
         * its own predecessor needs a flag day nobody scheduled.
         */
        $metrics = $this->names($plan['metrics'] ?? $plan['metric'] ?? null, 'metric');
        $columns = $this->names($plan['columns'] ?? null, 'column');
        $groupBy = $this->names($plan['group_by'] ?? null, 'group_by dimension');

        $mode = $this->mode($plan, $metrics, $columns);

        $this->assertShape($mode, $metrics, $columns, $groupBy);

        $metrics = $this->resolveMetrics($metrics, $entityKey);
        $groupBy = $this->resolveDimensions($groupBy, $entityKey);
        $columns = $this->resolveColumns($columns, $entityKey);

        $filters = $this->filters($plan['filters'] ?? null, $entityKey);
        $having = $this->having($plan['having'] ?? null, $entityKey, $metrics, $mode);
        $sort = $this->sort($plan['sort'] ?? null, $metrics, array_merge($metrics, $groupBy, $columns));

        /*
         * A model that omits the limit sends null; one that means "no limit"
         * sends 0. `??` only catches the first, so 0 fell through and clamped
         * to 1 — "headcount by department" came back as a single arbitrary row
         * and read like the org had one department. Both mean "use the
         * default", and only a positive number is a real limit.
         */
        $requested = (int) ($plan['limit'] ?? 0);
        $limit = $requested > 0 ? min(self::MAX_LIMIT, $requested) : self::DEFAULT_LIMIT;

        return [
            'entity' => $entityKey,
            'mode' => $mode,
            'metrics' => $metrics,
            'columns' => $columns,
            'group_by' => $groupBy,
            'filters' => $filters,
            'having' => $having,
            'sort' => $sort,
            'limit' => $limit,

            /*
             * DEPRECATED BRIDGE — delete with the last v1 reader.
             * `QueryPlanExecutor` and `SearchAskController`'s log line still
             * read a single `metric`. Carrying it costs one key and keeps the
             * grammar change from being a big-bang rewrite of everything
             * downstream; it is not part of §1 and nothing new should read it.
             */
            'metric' => $metrics[0] ?? null,
        ];
    }

    // ------------------------------------------------------------------ shape

    /**
     * §1: `mode` defaults to `aggregate`.
     *
     * With one exception, and it is not a guess: a plan carrying list columns
     * and no metric can only be a row listing. Refusing that under §5.2 would
     * refuse a plan whose intent is unambiguous, which is the narrowness this
     * grammar exists to end. A plan carrying BOTH still defaults to aggregate
     * and is refused below — there the intent genuinely is unclear.
     *
     * @param  array<string, mixed>  $plan
     * @param  list<string>  $metrics
     * @param  list<string>  $columns
     */
    private function mode(array $plan, array $metrics, array $columns): string
    {
        $declared = $plan['mode'] ?? null;

        if ($declared === null || $declared === '') {
            return $columns !== [] && $metrics === [] ? 'list' : 'aggregate';
        }

        $mode = is_string($declared) ? strtolower(trim($declared)) : '';

        if (! in_array($mode, self::MODES, true)) {
            throw new UnsupportedQuestionException(sprintf(
                "'%s' is not a mode I understand — use aggregate or list.",
                is_string($declared) ? $declared : $this->describe($declared)
            ));
        }

        return $mode;
    }

    /**
     * §5.2 and §5.3 — the rules about a plan's shape, before a single name is
     * looked up. Checked in this order so the message is about the shape rather
     * than about the first name that happened to be wrong.
     *
     * @param  list<string>  $metrics
     * @param  list<string>  $columns
     * @param  list<string>  $groupBy
     */
    private function assertShape(string $mode, array $metrics, array $columns, array $groupBy): void
    {
        if ($mode === 'list') {
            if ($groupBy !== []) {
                throw new UnsupportedQuestionException(sprintf(
                    'A row listing cannot be grouped by %s — drop group_by, or ask for an aggregate instead.',
                    $this->quoteAll($groupBy)
                ));
            }

            if ($metrics !== []) {
                throw new UnsupportedQuestionException(sprintf(
                    'A row listing cannot compute %s — ask for an aggregate instead, or drop the metric.',
                    $this->quoteAll($metrics)
                ));
            }

            if ($columns === []) {
                throw new UnsupportedQuestionException('A row listing has to name at least one column to show.');
            }

            if (count($columns) > self::MAX_COLUMNS) {
                throw new UnsupportedQuestionException(sprintf(
                    'A row listing can show at most %d columns; this plan names %d.',
                    self::MAX_COLUMNS,
                    count($columns)
                ));
            }

            return;
        }

        if ($columns !== []) {
            throw new UnsupportedQuestionException(sprintf(
                'An aggregate cannot show the list columns %s — group by them instead, or ask for a row listing.',
                $this->quoteAll($columns)
            ));
        }

        if ($metrics === []) {
            throw new UnsupportedQuestionException('This plan measures nothing — it names no metric.');
        }

        if (count($metrics) > self::MAX_METRICS) {
            throw new UnsupportedQuestionException(sprintf(
                'A plan can compute at most %d metrics; this one names %d.',
                self::MAX_METRICS,
                count($metrics)
            ));
        }

        if (count($groupBy) > self::MAX_GROUP_BY) {
            throw new UnsupportedQuestionException(sprintf(
                'A plan can group by at most %d dimensions; this one names %d.',
                self::MAX_GROUP_BY,
                count($groupBy)
            ));
        }
    }

    // ------------------------------------------------------------------ names

    /**
     * A scalar name, a list of names, or nothing. Anything else is refused
     * describing what arrived — a name that is not a name cannot be looked up,
     * and dropping it would silently narrow the plan.
     *
     * @return list<string>
     */
    private function names(mixed $raw, string $what): array
    {
        if ($raw === null) {
            return [];
        }

        if (is_string($raw)) {
            return trim($raw) === '' ? [] : [trim($raw)];
        }

        if (! is_array($raw)) {
            throw new UnsupportedQuestionException(sprintf(
                'I cannot read the %ss in this plan: %s.',
                $what,
                $this->describe($raw)
            ));
        }

        $names = [];

        foreach ($raw as $name) {
            if (! is_string($name) || trim($name) === '') {
                throw new UnsupportedQuestionException(sprintf(
                    'A %s in this plan is not a name: %s.',
                    $what,
                    $this->describe($name)
                ));
            }

            $names[] = trim($name);
        }

        return $names;
    }

    /**
     * @param  list<string>  $names
     * @return list<string>
     */
    private function resolveMetrics(array $names, string $entityKey): array
    {
        foreach ($names as $name) {
            if (SemanticLayer::metric($entityKey, $name) === null) {
                $this->refuseName($name, sprintf(
                    "'%s' is not something that can be measured on %s.",
                    $name,
                    $entityKey
                ));
            }
        }

        return $this->assertNoDuplicates($names, 'metric');
    }

    /**
     * @param  list<string>  $names
     * @return list<string>
     */
    private function resolveDimensions(array $names, string $entityKey): array
    {
        foreach ($names as $name) {
            if (SemanticLayer::dimension($entityKey, $name) === null) {
                $this->refuseName($name, sprintf("%s cannot be grouped by '%s'.", $entityKey, $name));
            }
        }

        return $this->assertNoDuplicates($names, 'group_by dimension');
    }

    /**
     * §4 makes `list_columns` the row-mode allow-list, and a dimension is the
     * fallback — not a loophole.
     *
     * §8's own worked example lists `name, department, joining_date` on
     * employees, and `department` there is a CURATED DIMENSION with no
     * list_columns entry: derivation cannot see that departments are the
     * `groups` table, so `MetricOverrides` supplies the dimension and nothing
     * supplies the column. Strict list_columns would refuse the spec's own
     * example.
     *
     * This widens nothing §10 protects. Both buckets are built by
     * `SchemaIntrospector` from the SAME exclusion-filtered column set, so a
     * dimension can no more name a PAN or a bank account than a list column
     * can — `refuseName()` below still answers "not available through this
     * tool" either way, and a test pins it.
     *
     * @param  list<string>  $names
     * @return list<string>
     */
    private function resolveColumns(array $names, string $entityKey): array
    {
        foreach ($names as $name) {
            if ($this->field($entityKey, $name) === null) {
                $this->refuseName($name, sprintf(
                    "'%s' is not a column that can be listed on %s.",
                    $name,
                    $entityKey
                ));
            }
        }

        return $this->assertNoDuplicates($names, 'column');
    }

    /**
     * A field a filter may name: a dimension, or a list column. §2's operators
     * apply to both, and they are not the same set — `employees.name` is a list
     * column and no dimension, `employees.department` is a dimension and no
     * list column, and "who is called Sharma" and "who is in Engineering" are
     * both questions somebody asks.
     *
     * @return array<string, mixed>|null
     */
    private function field(string $entityKey, string $name): ?array
    {
        return SemanticLayer::listColumn($entityKey, $name)
            ?? SemanticLayer::dimension($entityKey, $name);
    }

    /**
     * §10 is a policy, not a typo. "There is no such column" would be a lie
     * about PAN — the column exists, we will not expose it — and a lie there
     * sends somebody looking for the right spelling.
     */
    private function refuseName(string $name, string $sentence): never
    {
        /*
         * WITHHELD, not merely unsupported. AI mode falls back to the prose
         * assistant when the data path refuses — that is what lets it answer
         * "how do I run payroll?" instead of rejecting it. An exclusion must
         * never take that exit: handing "everyone's PAN number" to a general
         * assistant is how a policy exclusion gets talked around rather than
         * enforced.
         */
        if (SchemaIntrospector::isExcludedColumn($name)) {
            throw UnsupportedQuestionException::withheld(
                sprintf("'%s' is not available through this tool.", $name)
            );
        }

        throw new UnsupportedQuestionException($sentence);
    }

    /**
     * Deduplicating silently is a coercion: two identical metric columns, or a
     * group-by that says `department, department`, is a plan somebody got
     * wrong, and answering it as though they had not is how a wrong plan
     * survives to be reused.
     *
     * @param  list<string>  $names
     * @return list<string>
     */
    private function assertNoDuplicates(array $names, string $what): array
    {
        $seen = [];

        foreach ($names as $name) {
            if (isset($seen[$name])) {
                throw new UnsupportedQuestionException(sprintf(
                    "'%s' is named twice as a %s in this plan.",
                    $name,
                    $what
                ));
            }

            $seen[$name] = true;
        }

        return array_values($names);
    }

    // ---------------------------------------------------------------- filters

    /**
     * Every filter shape the model has been seen to emit, normalised into the
     * §1 descriptor list — or refused naming the field it was written on.
     *
     * @return list<array<string, mixed>>
     */
    private function filters(mixed $raw, string $entityKey): array
    {
        if ($raw === null || $raw === []) {
            return [];
        }

        if (! is_array($raw)) {
            throw new UnsupportedQuestionException(sprintf(
                'I cannot read the filters in this plan: %s.',
                $this->describe($raw)
            ));
        }

        $filters = [];

        foreach ($raw as $key => $entry) {
            foreach ($this->expandFilter($key, $entry) as $descriptor) {
                $filters[] = $this->filter($descriptor, $entityKey);
            }
        }

        return $filters;
    }

    /**
     * One entry of whatever the model sent, into zero-or-more descriptors.
     *
     * @return list<array<string, mixed>>
     */
    private function expandFilter(int|string $key, mixed $entry): array
    {
        // A map keyed by field name: the v1 flat shape, and the nested
        // operator shape that produced the zero.
        if (is_string($key)) {
            return $this->expandFieldEntry($key, $entry);
        }

        // §1's own shape: a list of {field, op, value}.
        if (is_array($entry) && array_key_exists('field', $entry)) {
            return [[
                'field' => $entry['field'],
                // A descriptor with a value and no operator is equality —
                // that is what the v1 flat map meant, and it is the only
                // reading of a field beside a value.
                'op' => $entry['op'] ?? 'eq',
                'value' => $entry['value'] ?? null,
                'has_value' => array_key_exists('value', $entry),
            ]];
        }

        // A one-key map that found its way into the list.
        if (is_array($entry) && count($entry) === 1 && is_string(array_key_first($entry))) {
            $field = (string) array_key_first($entry);

            return $this->expandFieldEntry($field, $entry[$field]);
        }

        throw new UnsupportedQuestionException(sprintf(
            'A filter in this plan names no field, so I cannot honour it: %s.',
            $this->describe($entry)
        ));
    }

    /**
     * `field => something`, where something is a value, a set, or a map of
     * operators. THIS IS WHERE THE ZERO CAME FROM: the third form was neither
     * understood nor refused.
     *
     * @return list<array<string, mixed>>
     */
    private function expandFieldEntry(string $field, mixed $value): array
    {
        if (is_array($value)) {
            /*
             * {"status": ["absent", "half_day"]} — a set of values on one
             * field is membership. That is the literal reading of a set, and
             * §1's own `in` example written as a map.
             */
            if (array_is_list($value)) {
                return [['field' => $field, 'op' => 'in', 'value' => $value, 'has_value' => true]];
            }

            // {"joining_date": {"op": "period", "value": "this_year"}} — a
            // descriptor that lost its field to the key it was filed under.
            if (array_key_exists('op', $value)) {
                return [[
                    'field' => is_string($value['field'] ?? null) ? $value['field'] : $field,
                    'op' => $value['op'],
                    'value' => $value['value'] ?? null,
                    'has_value' => array_key_exists('value', $value),
                ]];
            }

            /*
             * {"joining_date": {"gte": "2026-01-01", "lte": "2026-12-31"}} —
             * two bounds on one field, which is exactly how a model writes a
             * date range. Understood as two operator filters. An inner key
             * that is not an operator is refused naming BOTH the field and the
             * word, because "I ignored part of your filter" is not something a
             * reader can be expected to infer from a number.
             */
            $descriptors = [];

            foreach ($value as $op => $operand) {
                if (! is_string($op) || ! in_array(strtolower(trim($op)), self::OPERATORS, true)) {
                    throw new UnsupportedQuestionException(sprintf(
                        "The filter on '%s' uses '%s', which is not an operator I support. Supported: %s.",
                        $field,
                        is_string($op) ? $op : $this->describe($op),
                        implode(', ', self::OPERATORS)
                    ));
                }

                $descriptors[] = [
                    'field' => $field,
                    'op' => $op,
                    'value' => $operand,
                    'has_value' => true,
                ];
            }

            if ($descriptors === []) {
                throw new UnsupportedQuestionException(sprintf(
                    "The filter on '%s' says nothing, so I cannot honour it.",
                    $field
                ));
            }

            return $descriptors;
        }

        if ($value === null) {
            throw new UnsupportedQuestionException(sprintf(
                "The filter on '%s' has no value. If you meant \"%s is not set\", say so with is_null.",
                $field,
                $field
            ));
        }

        return [['field' => $field, 'op' => 'eq', 'value' => $value, 'has_value' => true]];
    }

    /**
     * One descriptor, checked against the layer and §2's operator table.
     *
     * @param  array<string, mixed>  $descriptor
     * @return array<string, mixed>
     */
    private function filter(array $descriptor, string $entityKey): array
    {
        $field = $descriptor['field'];

        if (! is_string($field) || trim($field) === '') {
            throw new UnsupportedQuestionException(sprintf(
                'A filter in this plan names no field, so I cannot honour it: %s.',
                $this->describe($field)
            ));
        }

        $field = trim($field);
        $definition = $this->field($entityKey, $field);

        if ($definition === null) {
            // The wording the spec asks for, verbatim: name the field, name the
            // entity it is not on.
            $this->refuseName($field, sprintf("'%s' is not a field on %s.", $field, $entityKey));
        }

        $op = is_string($descriptor['op'] ?? null) ? strtolower(trim($descriptor['op'])) : '';

        if (! in_array($op, self::OPERATORS, true)) {
            throw new UnsupportedQuestionException(sprintf(
                "'%s' is not an operator I support on '%s'. Supported: %s.",
                is_string($descriptor['op'] ?? null) ? $descriptor['op'] : $this->describe($descriptor['op'] ?? null),
                $field,
                implode(', ', self::OPERATORS)
            ));
        }

        /*
         * §4: a dimension's `type` decides which operators are legal on it.
         *
         * It can be ABSENT, and that is not an oversight to paper over: the
         * curated `payroll.month` and `attendance.date` predate the type key,
         * and `payroll.month` is a YYYY-MM string that period and range filters
         * both have to work on. An unknown type is therefore permissive — the
         * refusals below fire only where the type is KNOWN to make the operator
         * meaningless, which is the only case §5.4 actually names.
         */
        $type = is_string($definition['type'] ?? null) ? $definition['type'] : null;

        if ($op === 'contains' && in_array($type, ['number', 'money', 'date'], true)) {
            throw new UnsupportedQuestionException(sprintf(
                "contains searches text, and '%s' holds a %s value.",
                $field,
                $type
            ));
        }

        if ($op === 'period' && in_array($type, ['number', 'money'], true)) {
            throw new UnsupportedQuestionException(sprintf(
                "A period covers dates, and '%s' holds a %s value.",
                $field,
                $type
            ));
        }

        $normalised = ['field' => $field, 'op' => $op, 'value' => $this->filterValue($op, $descriptor, $field)];

        if ($op === 'period') {
            // The token is kept beside the resolved range so the plan echoed
            // back to the reader still says which words produced these dates.
            $normalised['token'] = strtolower(trim((string) ($descriptor['value'] ?? '')));
        }

        return $normalised;
    }

    /**
     * §2's value column, enforced. Every branch either produces a value the
     * executor can apply or refuses naming the field — a filter whose value
     * cannot be read must never become a filter that is not applied.
     *
     * @param  array<string, mixed>  $descriptor
     */
    private function filterValue(string $op, array $descriptor, string $field): mixed
    {
        $value = $descriptor['value'] ?? null;

        if (in_array($op, self::VALUELESS_OPERATORS, true)) {
            // Whatever came with it cannot change which rows match, so it is
            // dropped rather than refused.
            return null;
        }

        if ($op === 'period') {
            $token = is_string($value) ? trim($value) : '';
            $resolved = PeriodResolver::resolve($token);

            if ($resolved === null) {
                /*
                 * §3: an unrecognised token is a refusal, never a guess. A
                 * wrong range does not degrade an answer — it answers a
                 * different question with the same confidence.
                 */
                throw new UnsupportedQuestionException(sprintf(
                    "'%s' is not a period I can resolve for '%s'. Use a token like last_month or this_year, a month like 2026-07, or a range like 2026-07-01..2026-07-31.",
                    $token !== '' ? $token : $this->describe($value),
                    $field
                ));
            }

            // Resolved HERE so the executor never parses a token: one parser,
            // one set of bounds, and the label the answer quotes is derived
            // from the same range that was filtered on.
            return $resolved;
        }

        if (in_array($op, self::SET_OPERATORS, true)) {
            if (! is_array($value)) {
                throw new UnsupportedQuestionException(sprintf(
                    "'%s' on '%s' needs a list of values; it was given %s.",
                    $op,
                    $field,
                    $this->describe($value)
                ));
            }

            if ($value === []) {
                // An empty set matches nothing, and nothing reads as "no such
                // people" rather than "you asked for no values".
                throw new UnsupportedQuestionException(sprintf(
                    "The '%s' filter on '%s' lists no values, so it could only match nothing.",
                    $op,
                    $field
                ));
            }

            if (count($value) > self::MAX_IN_VALUES) {
                throw new UnsupportedQuestionException(sprintf(
                    "The '%s' filter on '%s' lists %d values; at most %d are allowed.",
                    $op,
                    $field,
                    count($value),
                    self::MAX_IN_VALUES
                ));
            }

            foreach ($value as $item) {
                $this->assertScalar($item, $field, $op);
            }

            return array_values($value);
        }

        if ($op === 'between') {
            if (! is_array($value) || count($value) !== 2) {
                throw new UnsupportedQuestionException(sprintf(
                    "between on '%s' needs exactly two bounds; it was given %s.",
                    $field,
                    $this->describe($value)
                ));
            }

            $bounds = array_values($value);
            $this->assertScalar($bounds[0], $field, 'between');
            $this->assertScalar($bounds[1], $field, 'between');

            if (is_numeric($bounds[0]) && is_numeric($bounds[1]) && $bounds[0] + 0 > $bounds[1] + 0) {
                // A backwards band matches nothing, and nothing reads as an
                // answer about the band rather than about the plan.
                throw new UnsupportedQuestionException(sprintf(
                    "between on '%s' runs backwards (%s to %s), so it could only match nothing.",
                    $field,
                    $this->describe($bounds[0]),
                    $this->describe($bounds[1])
                ));
            }

            return $bounds;
        }

        $this->assertScalar($value, $field, $op);

        if ($op === 'contains' && trim((string) $value) === '') {
            // An empty LIKE matches every row — the whole-table failure §2's
            // escaping rule exists to prevent, arriving through the value
            // instead of through the pattern.
            throw new UnsupportedQuestionException(sprintf(
                "contains on '%s' has nothing to search for, so it would match every row.",
                $field
            ));
        }

        return $value;
    }

    private function assertScalar(mixed $value, string $field, string $op): void
    {
        if (is_string($value) || is_int($value) || is_float($value) || is_bool($value)) {
            return;
        }

        throw new UnsupportedQuestionException(sprintf(
            "The '%s' filter on '%s' needs a single value; it was given %s.",
            $op,
            $field,
            $this->describe($value)
        ));
    }

    // ----------------------------------------------------------------- having

    /**
     * §1's threshold on an AGGREGATE — what makes "more than 3 days"
     * expressible at all.
     *
     * @param  list<string>  $metrics
     * @return list<array<string, mixed>>
     */
    private function having(mixed $raw, string $entityKey, array $metrics, string $mode): array
    {
        if ($raw === null || $raw === []) {
            return [];
        }

        if ($mode !== 'aggregate') {
            throw new UnsupportedQuestionException(
                'A row listing computes no aggregate, so a having has nothing to apply to.'
            );
        }

        if (! is_array($raw)) {
            throw new UnsupportedQuestionException(sprintf(
                'I cannot read the having in this plan: %s.',
                $this->describe($raw)
            ));
        }

        // A single threshold written as one descriptor rather than a list.
        if (array_key_exists('metric', $raw)) {
            $raw = [$raw];
        }

        $having = [];

        foreach ($raw as $key => $entry) {
            foreach ($this->expandHaving($key, $entry) as $descriptor) {
                $having[] = $this->havingClause($descriptor, $entityKey, $metrics);
            }
        }

        return $having;
    }

    /**
     * The same shapes filters accept, keyed by metric — a model that writes
     * `{"absent_days": {"gt": 3}}` for a threshold has written the identical
     * nested form it writes for a filter, and refusing one while understanding
     * the other would be arbitrary.
     *
     * @return list<array<string, mixed>>
     */
    private function expandHaving(int|string $key, mixed $entry): array
    {
        if (is_string($key)) {
            if (is_array($entry)) {
                if (array_key_exists('op', $entry)) {
                    return [[
                        'metric' => is_string($entry['metric'] ?? null) ? $entry['metric'] : $key,
                        'op' => $entry['op'],
                        'value' => $entry['value'] ?? null,
                    ]];
                }

                $descriptors = [];

                foreach ($entry as $op => $operand) {
                    $descriptors[] = ['metric' => $key, 'op' => $op, 'value' => $operand];
                }

                if ($descriptors === []) {
                    throw new UnsupportedQuestionException(sprintf(
                        "The having on '%s' says nothing, so I cannot honour it.",
                        $key
                    ));
                }

                return $descriptors;
            }

            return [['metric' => $key, 'op' => 'eq', 'value' => $entry]];
        }

        if (is_array($entry) && array_key_exists('metric', $entry)) {
            return [[
                'metric' => $entry['metric'],
                'op' => $entry['op'] ?? 'eq',
                'value' => $entry['value'] ?? null,
            ]];
        }

        if (is_array($entry) && count($entry) === 1 && is_string(array_key_first($entry))) {
            $metric = (string) array_key_first($entry);

            return $this->expandHaving($metric, $entry[$metric]);
        }

        throw new UnsupportedQuestionException(sprintf(
            'A having in this plan names no metric, so I cannot honour it: %s.',
            $this->describe($entry)
        ));
    }

    /**
     * @param  array<string, mixed>  $descriptor
     * @param  list<string>  $metrics
     * @return array<string, mixed>
     */
    private function havingClause(array $descriptor, string $entityKey, array $metrics): array
    {
        $name = $descriptor['metric'];

        if (! is_string($name) || trim($name) === '') {
            throw new UnsupportedQuestionException(sprintf(
                'A having in this plan names no metric, so I cannot honour it: %s.',
                $this->describe($name)
            ));
        }

        $name = trim($name);

        if (! in_array($name, $metrics, true)) {
            /*
             * §5.6. Two different facts, told apart rather than merged: a
             * metric that exists but is not being computed is a plan somebody
             * can fix by adding it, and a metric that does not exist is not.
             */
            if (SemanticLayer::metric($entityKey, $name) !== null) {
                throw new UnsupportedQuestionException(sprintf(
                    "'%s' is not one of the metrics this plan computes, so there is no value to compare it against. Add it to metrics first.",
                    $name
                ));
            }

            $this->refuseName($name, sprintf(
                "'%s' is not something that can be measured on %s.",
                $name,
                $entityKey
            ));
        }

        $op = is_string($descriptor['op'] ?? null) ? strtolower(trim($descriptor['op'])) : '';

        if (! in_array($op, self::HAVING_OPERATORS, true)) {
            throw new UnsupportedQuestionException(sprintf(
                "'%s' cannot be applied to the metric '%s'. A threshold on a computed number takes one of: %s.",
                is_string($descriptor['op'] ?? null) ? $descriptor['op'] : $this->describe($descriptor['op'] ?? null),
                $name,
                implode(', ', self::HAVING_OPERATORS)
            ));
        }

        return ['metric' => $name, 'op' => $op, 'value' => $this->havingValue($op, $descriptor['value'] ?? null, $name)];
    }

    /**
     * A threshold on an aggregate is a NUMBER. A string that is not a number
     * cannot be compared against one, and coercing "a lot" to 0 would keep
     * every row and call it a filter.
     */
    private function havingValue(string $op, mixed $value, string $metric): mixed
    {
        if ($op === 'between') {
            if (! is_array($value) || count($value) !== 2) {
                throw new UnsupportedQuestionException(sprintf(
                    "between on '%s' needs exactly two numbers; it was given %s.",
                    $metric,
                    $this->describe($value)
                ));
            }

            $bounds = array_values($value);

            return [
                $this->number($bounds[0], $metric),
                $this->number($bounds[1], $metric),
            ];
        }

        return $this->number($value, $metric);
    }

    private function number(mixed $value, string $metric): int|float
    {
        if (is_int($value) || is_float($value)) {
            return $value;
        }

        if (is_string($value) && is_numeric(trim($value))) {
            return trim($value) + 0;
        }

        throw new UnsupportedQuestionException(sprintf(
            "A threshold on '%s' has to be a number; it was given %s.",
            $metric,
            $this->describe($value)
        ));
    }

    // ------------------------------------------------------------------- sort

    /**
     * §5.7 — `sort.by` names a metric, a group-by dimension or a list column
     * this plan actually has. Sorting by anything else is either an error or a
     * second query nobody asked for.
     *
     * @param  list<string>  $metrics
     * @param  list<string>  $sortable
     * @return array{by: string, dir: string}|null
     */
    private function sort(mixed $raw, array $metrics, array $sortable): ?array
    {
        if ($raw === null || $raw === '' || $raw === []) {
            return null;
        }

        if (is_string($raw)) {
            $token = strtolower(trim($raw));

            // The v1 vocabulary, which said only "by the metric, this way".
            if ($token === 'metric_asc' || $token === 'metric_desc') {
                if ($metrics === []) {
                    throw new UnsupportedQuestionException(sprintf(
                        "'%s' sorts by a metric, and this plan computes none.",
                        $raw
                    ));
                }

                return ['by' => $metrics[0], 'dir' => $token === 'metric_asc' ? 'asc' : 'desc'];
            }

            return $this->sortBy($raw, null, $metrics, $sortable);
        }

        if (! is_array($raw) || ! array_key_exists('by', $raw)) {
            throw new UnsupportedQuestionException(sprintf(
                'I cannot read the sort in this plan: %s. It takes {"by": <name>, "dir": "asc" or "desc"}.',
                $this->describe($raw)
            ));
        }

        return $this->sortBy($raw['by'], $raw['dir'] ?? null, $metrics, $sortable);
    }

    /**
     * @param  list<string>  $metrics
     * @param  list<string>  $sortable
     * @return array{by: string, dir: string}
     */
    private function sortBy(mixed $by, mixed $dir, array $metrics, array $sortable): array
    {
        if (! is_string($by) || ! in_array(trim($by), $sortable, true)) {
            throw new UnsupportedQuestionException(sprintf(
                'This plan cannot sort by %s — it can sort by %s.',
                is_string($by) ? "'".$by."'" : $this->describe($by),
                $sortable === [] ? 'nothing it computes' : $this->quoteAll($sortable)
            ));
        }

        $by = trim($by);

        /*
         * A MISSING direction is a gap filled by rule; a STATED one nobody
         * recognises is refused. The difference matters because direction
         * decides which rows survive the limit — top five and bottom five are
         * different answers, and guessing between them is exactly the
         * confident-wrong-answer failure this class exists to stop.
         *
         * The rule: a metric with no direction means "biggest first", which is
         * what "top departments" asks for. A dimension or a column means the
         * order a human reads a name or a date in.
         */
        if ($dir === null || $dir === '') {
            return ['by' => $by, 'dir' => in_array($by, $metrics, true) ? 'desc' : 'asc'];
        }

        $direction = is_string($dir) ? strtolower(trim($dir)) : '';

        if (! in_array($direction, ['asc', 'desc'], true)) {
            throw new UnsupportedQuestionException(sprintf(
                "'%s' is not a sort direction — use asc or desc.",
                is_string($dir) ? $dir : $this->describe($dir)
            ));
        }

        return ['by' => $by, 'dir' => $direction];
    }

    // ------------------------------------------------------------- describing

    /**
     * What arrived, quoted back so a refusal names the thing it refused rather
     * than describing a category. Bounded, because the model's output is
     * untrusted input and a refusal is rendered to a person.
     */
    private function describe(mixed $value): string
    {
        $rendered = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);

        if ($rendered === false) {
            return gettype($value);
        }

        return strlen($rendered) > 80 ? substr($rendered, 0, 77).'...' : $rendered;
    }

    /** @param list<string> $names */
    private function quoteAll(array $names): string
    {
        return implode(', ', array_map(fn (string $name) => "'".$name."'", $names));
    }
}
