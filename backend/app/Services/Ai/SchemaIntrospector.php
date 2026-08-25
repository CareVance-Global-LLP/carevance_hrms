<?php

namespace App\Services\Ai;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

/**
 * The schema, read as a question vocabulary.
 *
 * Seven hand-written entities covered under 10% of a 221-table schema, and
 * hand-writing the other 150 is not a plan — it is a promise to stop halfway
 * and leave the gap undocumented. So coverage is DERIVED here, once, from the
 * tables themselves, and correctness is CURATED on top of it: a derived metric
 * is naive by construction (`AVG(net_pay)` answers 76,313.27 where the truth is
 * 91,575.93) and says so, and `MetricOverrides` replaces the ones that have
 * been caught being wrong.
 *
 * Two rules make this safe to point at every table at once.
 *
 * 1. **Only tenant-scoped models are derived.** A table with `organization_id`
 *    is not enough: the query has to run through Eloquent with
 *    `BelongsToOrganization` applied, or a question anyone can ask in English
 *    reads every tenant's rows. `users` carries `organization_id` and `User`
 *    deliberately carries no scope — so `users` is NOT derived, and people are
 *    reached through the curated `employees` entity instead.
 *
 * 2. **The exclusion list is global and by pattern.** Not remembered per
 *    entity, because per-entity vigilance is what fails on entity 81. An
 *    excluded column is not a dimension, not a list column, not a metric and
 *    not filterable, on any table, at any role.
 *
 * 3. **Scoping a table and admitting it to the vocabulary are different
 *    decisions.** The trait doubles as both switches, so a table that needs
 *    tenant isolation but must not be queryable — `screenshots`, whose
 *    columns carry no statutory or credential token but are still nobody's
 *    business to list — needs a table-level exclusion, not a column one.
 *
 * Derivation is pure and deterministic — same schema, same output — so it can
 * be cached and rebuilt on migration rather than computed per request.
 */
final class SchemaIntrospector
{
    /**
     * Column-name patterns that may never be exposed, as token sequences.
     *
     * Matched on snake_case WORD boundaries, never as substrings, because
     * substrings are wrong in both directions and the wrong direction gets the
     * rule loosened: "designation", "residual" and "resignation" all contain
     * "esi", and "company" contains "pan". A rule that eats a third of the
     * schema by accident does not survive its first bug report.
     *
     * This is the spec's list (password · remember_token · *_token · *_secret ·
     * api_key · pan · uan · esi · aadhaar · pf_number · account_number · ifsc ·
     * bank_account* · google_*) with three widenings, each for a real column in
     * this schema that the literal list misses:
     *
     * - `account` rather than `account_number`/`bank_account*`, because
     *   `bank_transfer_items.beneficiary_account` IS a bank account number and
     *   matches neither. It costs `gl_mapping_configs.credit_account`, which is
     *   a ledger name, and that is a trade worth making.
     * - `swift` alongside `ifsc`, the same routing code by its other name.
     * - `token` and `secret` as bare words, so `token_hash`, `token_hint` and
     *   `signing_token_hash` — hashes OF a credential — go with the credential.
     *
     * `esi` also takes `payroll_items.esi_employee` and `esi_employer`, which
     * are money and not identifiers. That is deliberate: the rule is worth more
     * than the two columns, and the remedy is the documented one — a curated
     * override in `MetricOverrides`, not a hole in the pattern.
     */
    private const EXCLUDED_TOKEN_SEQUENCES = [
        ['password'],
        ['token'],
        ['secret'],
        ['api', 'key'],
        ['pan'],
        ['uan'],
        ['esi'],
        ['aadhaar'],
        ['aadhar'],
        ['pf', 'number'],
        ['account'],
        ['ifsc'],
        ['swift'],
        ['google'],
    ];

    /**
     * Tables that are scoped, but are not vocabulary. The trait is what makes a
     * table derivable, so a table that needs tenancy but must not be queryable
     * needs saying so here — otherwise fixing its isolation silently widens what
     * the assistant can see.
     *
     * screenshots is the first entry: it needs BelongsToOrganization for
     * structural tenant isolation (Task 0), but its columns — filename,
     * thumbnail, captured_at, device_id — trip none of the column-level
     * exclusions above, and no metric in this design touches it. Excluding the
     * whole table is correct rather than excluding filename: there is no
     * question about screenshots this tool should answer, so there is no
     * column set worth curating.
     */
    private const EXCLUDED_TABLES = ['screenshots'];

    /**
     * Columns that are structure rather than data.
     *
     * `organization_id` holds the same value on every row a caller can see, so
     * grouping by it is one row and offering it as a filter only invites
     * somebody to try another tenant's id.
     */
    private const STRUCTURAL_COLUMNS = ['organization_id'];

    /**
     * Words that make a decimal column money.
     *
     * Two groups: the generic ones any schema would have, and the salary
     * components an Indian payroll names — `da`, `pt`, `lwf`, `nps`, `vpf`,
     * `hra`, `cca`. The second group is domain vocabulary, not guesswork:
     * these are the same component names `PayrollCalculatorService` computes,
     * and they are what a payroll schema calls its rupees.
     *
     * This is still a heuristic, and it is allowed to be: a wrong FORMAT is a
     * rupee sign in the wrong place, which a reader sees. A wrong NUMBER is
     * what the curated overrides exist for, and a format nobody likes is fixed
     * the same way.
     */
    private const MONEY_TOKENS = [
        // Generic
        'amount', 'amounts', 'salary', 'wage', 'wages', 'pay', 'payable', 'payout',
        'ctc', 'gross', 'net', 'basic', 'total', 'subtotal', 'value', 'limit', 'budget',
        'cost', 'price', 'fee', 'fees', 'charge', 'charges', 'revenue', 'discount',
        'liability', 'income', 'earnings', 'advance', 'refund', 'recovery',
        'compensation', 'severance', 'contribution', 'contributions',
        // Earnings and deductions this payroll actually names
        'hra', 'cca', 'da', 'allowance', 'allowances', 'conveyance', 'medical',
        'transport', 'uniform', 'meal', 'hostel', 'education', 'internet', 'fuel',
        'insurance', 'superannuation', 'perquisite', 'differential', 'stipend',
        'incentive', 'commission', 'bonus', 'arrear', 'arrears', 'gratuity',
        'encashment', 'reimbursement', 'emi', 'deduction', 'deductions',
        'tax', 'tds', 'pt', 'lwf', 'pf', 'epf', 'eps', 'nps', 'vpf',
    ];

    /**
     * Words that mean the column counts something rather than costs something.
     *
     * `payable_hours`, `total_payable_days` and `pf_employee_percentage` all
     * carry a money word and none of them are money.
     *
     * A period is NOT a unit here. `month` and `year` name WHEN a figure
     * applies, not what it measures — `gross_full_month` and
     * `current_month_salary` are rupees, and guarding on the period was reading
     * the calendar as the unit.
     */
    private const UNIT_TOKENS = [
        'hours', 'hour', 'days', 'day', 'minutes', 'minute', 'seconds', 'second',
        'count', 'percentage', 'percent', 'pct', 'score', 'ratio', 'rate',
        'multiplier', 'qty', 'quantity', 'units', 'unit',
        'level', 'index', 'version', 'number', 'id',
        'latitude', 'longitude',
    ];

    /** Columns whose value is a label a human recognises, best first. */
    private const LABEL_COLUMNS = [
        'name', 'title', 'label', 'display_name', 'full_name', 'subject',
        'code', 'reference', 'email',
    ];

    /** @var array<string, array<int, array<string, mixed>>> table => Schema::getColumns() */
    private array $columnCache = [];

    /** @var array<string, bool> */
    private array $tableExists = [];

    /**
     * The whole derived layer, keyed by table name, in the semantic layer's own
     * shape so curated entities can be merged straight over the top.
     *
     * @return array<string, array<string, mixed>>
     */
    public static function derive(): array
    {
        return (new self)->run();
    }

    /**
     * Whether a column may be exposed at all — the one place the answer lives.
     *
     * Public because the refusal has to name the column ("PAN is not available
     * through this tool"), which means the validator needs the same answer the
     * derivation used. Two copies of this rule is one copy that drifts.
     */
    public static function isExcludedColumn(string $column): bool
    {
        $tokens = self::tokenise($column);

        foreach (self::EXCLUDED_TOKEN_SEQUENCES as $sequence) {
            if (self::containsSequence($tokens, $sequence)) {
                return true;
            }
        }

        return false;
    }

    /** @return array<int, string> The patterns, for a message a human can read. */
    public static function excludedPatterns(): array
    {
        return array_map(
            fn (array $sequence) => implode('_', $sequence),
            self::EXCLUDED_TOKEN_SEQUENCES
        );
    }

    /** @return array<string, array<string, mixed>> */
    private function run(): array
    {
        $entities = [];

        foreach ($this->tenantScopedModels() as $table => $model) {
            $entity = $this->deriveEntity($table, $model);

            if ($entity !== null) {
                $entities[$table] = $entity;
            }
        }

        // Sorted so two rebuilds of the same schema produce the same array. The
        // layer is cached and quoted back to the user in `plan`; a key that
        // moves between rebuilds moves out from under a saved question.
        ksort($entities);

        return $entities;
    }

    /**
     * Every model whose table is tenant-owned AND whose queries carry the scope.
     *
     * Read off the model rather than off the schema on purpose: the schema knows
     * a table has `organization_id`, but only the model knows whether a query
     * against it is filtered. `attendance_violations` and ten others have the
     * column and no model, so nothing can query them through Eloquent at all;
     * `users`, `invitations` and `organization_stats` have a model and no scope,
     * for reasons recorded in TenantIsolationTest.
     *
     * @return array<string, class-string<Model>>
     */
    private function tenantScopedModels(): array
    {
        $models = [];

        foreach (glob(app_path('Models/*.php')) as $file) {
            $class = 'App\\Models\\'.basename($file, '.php');

            if (! class_exists($class) || ! is_subclass_of($class, Model::class)) {
                continue;
            }

            if (! in_array(BelongsToOrganization::class, class_uses_recursive($class), true)) {
                continue;
            }

            try {
                $model = new $class;
            } catch (\Throwable $e) {
                // An abstract or constructor-hungry model is not a query target.
                continue;
            }

            $table = $model->getTable();

            if (in_array($table, self::EXCLUDED_TABLES, true)) {
                continue;
            }

            if (! $this->hasTable($table) || isset($models[$table])) {
                continue;
            }

            $models[$table] = $class;
        }

        return $models;
    }

    /**
     * @param  class-string<Model>  $modelClass
     * @return array<string, mixed>|null
     */
    private function deriveEntity(string $table, string $modelClass): ?array
    {
        /** @var Model $model */
        $model = new $modelClass;

        $columns = $this->columnsOf($table);

        if ($columns === []) {
            return null;
        }

        $casts = $model->getCasts();
        $hidden = array_map('strtolower', $model->getHidden());
        $primaryKey = $model->getKeyName();

        $foreignKeys = $this->foreignKeysOf($table);

        $joins = [];
        $dimensions = [];
        $listColumns = [];
        $metrics = [
            'count' => $this->countMetric($table),
        ];

        foreach ($columns as $column) {
            $name = $column['name'];

            if ($this->isSkippableColumn($name, $primaryKey, $casts, $hidden, $column)) {
                continue;
            }

            $foreign = $foreignKeys[$name] ?? null;
            $label = $foreign !== null ? $this->labelColumnOf($foreign['table']) : null;

            if ($foreign !== null && $label !== null) {
                // A raw id answers nothing anybody asked. The label replaces it
                // outright rather than sitting beside it, so there is no way to
                // group by an integer nobody can read.
                $alias = $this->aliasFor($foreign['table'], $name);
                $key = $this->uniqueKey($this->foreignKeyLabel($name, $foreign['table']), $dimensions);

                $joins[$alias] = [
                    $foreign['table'].' as '.$alias,
                    $alias.'.'.$foreign['column'],
                    '=',
                    $table.'.'.$name,
                ];

                $dimensions[$key] = [
                    'label' => $this->humanise($key),
                    // Declared on the entity, never here. The entity's joins are
                    // applied before any dimension is read, so repeating one
                    // would join the same table twice — a SQL error, not a wrong
                    // answer.
                    'join' => null,
                    'select' => $alias.'.'.$label,
                    /*
                     * A NAME IS NOT AN IDENTITY, and grouping by one merges
                     * people.
                     *
                     * This database has twelve separate users all called
                     * "QA E2E". Grouped by `users.name` alone, "who was absent
                     * more than 3 days last month" answered `QA E2E — 47`: the
                     * sum across all twelve, presented as one person, in a
                     * 31-day month. Four was the true figure for any one of
                     * them.
                     *
                     * The executor groups by this alongside the label, so rows
                     * sharing a label but not an identity stay separate. Two
                     * real employees called Priya Sharma get two rows — which
                     * looks duplicated and IS correct, where one merged row is
                     * tidy and is a lie about both of them.
                     */
                    'identity' => $table.'.'.$name,
                    'null_label' => '(none)',
                    'type' => 'text',
                    'date_format' => null,
                ];

                $listColumns[$key] = [
                    'label' => $this->humanise($key),
                    'select' => $alias.'.'.$label,
                    'type' => 'text',
                ];

                continue;
            }

            // Money before type: a decimal amount is a `number` to SQL and a
            // `money` to a reader, and the reader is who the column is for.
            $type = $this->isMoney($column, $name) ? 'money' : $this->columnType($column);
            $key = $this->uniqueKey($name, $dimensions);

            $dimensions[$key] = [
                'label' => $this->humanise($name),
                'join' => null,
                'select' => $table.'.'.$name,
                'null_label' => '(not set)',
                'type' => $type,
                // Only a real date column gets a format. Guessing that a text
                // column holds 'YYYY-MM' is the same sin as guessing a period:
                // it silently answers a different question. Columns like
                // payroll_items.month_year are declared by a curated override.
                'date_format' => $type === 'date' ? 'Y-m-d' : null,
            ];

            $listColumns[$key] = [
                'label' => $this->humanise($name),
                'select' => $table.'.'.$name,
                'type' => $type,
            ];

            if ($this->isMeasurable($column, $name, $foreign)) {
                foreach (['sum' => 'Total', 'avg' => 'Average', 'min' => 'Lowest', 'max' => 'Highest'] as $aggregate => $word) {
                    $metrics[$aggregate.'_'.$name] = $this->columnMetric($table, $name, $column, $aggregate, $word);
                }
            }
        }

        return [
            'label' => $this->humanise($table),
            'table' => $table,
            'model' => $modelClass,
            'joins' => array_values($joins),
            'metrics' => $metrics,
            'dimensions' => $dimensions,
            'list_columns' => $listColumns,
        ];
    }

    /**
     * @param  array<string, mixed>  $casts
     * @param  array<int, string>  $hidden
     * @param  array<string, mixed>  $column
     */
    private function isSkippableColumn(string $name, string $primaryKey, array $casts, array $hidden, array $column): bool
    {
        if ($name === $primaryKey || $name === 'id') {
            return true;
        }

        if (in_array($name, self::STRUCTURAL_COLUMNS, true)) {
            return true;
        }

        if (self::isExcludedColumn($name)) {
            return true;
        }

        // The model has already declared these must not leave the server. That
        // declaration is worth more than a pattern list, because it was written
        // by whoever knew what the column held.
        if (in_array(strtolower($name), $hidden, true)) {
            return true;
        }

        return $this->isOpaque($name, $casts, $column);
    }

    /**
     * Columns whose value is a document rather than a field.
     *
     * A JSON blob is not a dimension — grouping by it produces one row per row —
     * and it can hold anything, including the fields the pattern list exists to
     * keep out. Encrypted and hashed columns are unreadable by construction, and
     * an aggregate over ciphertext is a number with no meaning.
     *
     * The cast is consulted rather than the SQL type because they disagree by
     * driver: Laravel's `json()` is `json` on PostgreSQL and plain `text` on the
     * SQLite the suite runs on, so a type-only rule would derive two different
     * layers from one schema.
     *
     * @param  array<string, mixed>  $casts
     * @param  array<string, mixed>  $column
     */
    private function isOpaque(string $name, array $casts, array $column): bool
    {
        $sqlType = strtolower((string) ($column['type_name'] ?? ''));

        if (in_array($sqlType, ['json', 'jsonb', 'bytea', 'blob', 'binary', 'varbinary'], true)) {
            return true;
        }

        $cast = strtolower((string) ($casts[$name] ?? ''));

        if ($cast === '') {
            return false;
        }

        if ($cast === 'hashed' || str_starts_with($cast, 'encrypted')) {
            return true;
        }

        foreach (['array', 'json', 'object', 'collection'] as $needle) {
            if (str_contains($cast, $needle)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Whether an aggregate over this column would mean anything.
     *
     * An identifier is not a measurement: `sum_user_id` is a number the database
     * will happily produce and nobody can use.
     *
     * @param  array<string, mixed>  $column
     * @param  array{table: string, column: string}|null  $foreign
     */
    private function isMeasurable(array $column, string $name, ?array $foreign): bool
    {
        if ($foreign !== null || str_ends_with($name, '_id')) {
            return false;
        }

        if ($this->columnType($column) !== 'number' && ! $this->isMoney($column, $name)) {
            return false;
        }

        // A boolean maps to text, so it never reaches here; this catches the
        // tinyint(1) that PostgreSQL and SQLite spell differently.
        return ! $this->isBoolean($column);
    }

    /** @return array<string, mixed> */
    private function countMetric(string $table): array
    {
        return [
            'label' => $this->humanise($table),
            'type' => 'number',
            'aggregate' => 'count',
            'column' => null,
            'where' => [],
            'note' => sprintf('count = COUNT(*) over every %s row, with no exclusions.', $table),
            'format' => 'number',
            'origin' => 'derived',
        ];
    }

    /**
     * @param  array<string, mixed>  $column
     * @return array<string, mixed>
     */
    private function columnMetric(string $table, string $name, array $column, string $aggregate, string $word): array
    {
        $format = $this->isMoney($column, $name) ? 'money' : 'number';

        return [
            'label' => $word.' '.strtolower($this->humanise($name)),
            'type' => $format,
            'aggregate' => $aggregate,
            'column' => $name,
            // Derived metrics exclude nothing, which is exactly what makes them
            // naive — and why the note says so out loud rather than letting a
            // reader assume the obvious exclusions were applied.
            'where' => [],
            'note' => sprintf(
                '%s_%s = %s(%s) over every %s row, with no exclusions.',
                $aggregate,
                $name,
                strtoupper($aggregate),
                $name,
                $table
            ),
            'format' => $format,
            'origin' => 'derived',
        ];
    }

    /**
     * A dimension type decides which operators are legal on it, so the mapping
     * has to hold on both drivers: the application runs on PostgreSQL (`int8`,
     * `bool`, `timestamp`) and the suite runs on SQLite (`integer`,
     * `tinyint(1)`, `datetime`).
     *
     * @param  array<string, mixed>  $column
     */
    private function columnType(array $column): string
    {
        if ($this->isBoolean($column)) {
            // Not `number`: a boolean has two values and the only useful
            // operators on it are equality and membership.
            return 'text';
        }

        $sqlType = strtolower((string) ($column['type_name'] ?? ''));

        if (in_array($sqlType, ['date', 'timestamp', 'timestamptz', 'datetime', 'datetimetz'], true)) {
            return 'date';
        }

        if ($this->isNumeric($sqlType)) {
            return 'number';
        }

        return 'text';
    }

    /** @param array<string, mixed> $column */
    private function isBoolean(array $column): bool
    {
        $sqlType = strtolower((string) ($column['type_name'] ?? ''));

        if (in_array($sqlType, ['bool', 'boolean'], true)) {
            return true;
        }

        return $sqlType === 'tinyint' && str_contains(strtolower((string) ($column['type'] ?? '')), '(1)');
    }

    private function isNumeric(string $sqlType): bool
    {
        return in_array($sqlType, [
            'int', 'int2', 'int4', 'int8', 'integer', 'bigint', 'smallint', 'mediumint',
            'tinyint', 'serial', 'bigserial', 'smallserial',
            'numeric', 'decimal', 'money', 'real', 'double', 'double precision',
            'float', 'float4', 'float8',
        ], true);
    }

    /**
     * Money is a decimal column named like an amount — both halves required.
     *
     * `total_working_days` is an integer and `activity_percentage` is a decimal
     * that counts nothing in rupees; formatting either as currency is a
     * confident lie, which is the one failure this whole design exists to stop.
     *
     * @param  array<string, mixed>  $column
     */
    private function isMoney(array $column, string $name): bool
    {
        $sqlType = strtolower((string) ($column['type_name'] ?? ''));

        $isDecimal = in_array($sqlType, [
            'numeric', 'decimal', 'money', 'real', 'double', 'double precision',
            'float', 'float4', 'float8',
        ], true);

        if (! $isDecimal) {
            return false;
        }

        $tokens = self::tokenise($name);

        if (array_intersect($tokens, self::UNIT_TOKENS) !== []) {
            return false;
        }

        return array_intersect($tokens, self::MONEY_TOKENS) !== [];
    }

    /**
     * The dimension key a foreign key gets.
     *
     * `user_id` becomes `employee`, not `user`, because every entity that
     * belongs to a person must expose the same dimension name — grouping by
     * employee is what turns "how many" into "who", and "who" is most of what
     * an admin asks. Everything else drops the `_id`: `department_id` becomes
     * `department`, `reviewed_by` stays `reviewed_by`.
     */
    private function foreignKeyLabel(string $column, string $foreignTable): string
    {
        if ($foreignTable === 'users' && in_array($column, ['user_id', 'employee_id'], true)) {
            return 'employee';
        }

        return str_ends_with($column, '_id') ? substr($column, 0, -3) : $column;
    }

    /**
     * A join alias per foreign-key COLUMN, not per table.
     *
     * `leave_requests` points at `users` four times — `user_id`, `reviewed_by`,
     * `revoke_reviewed_by` and `escalated_to_user_id`. Joining `users` four
     * times under one name is not a wrong answer, it is a SQL error, and a
     * self-referencing key would collide with the base table the same way.
     */
    private function aliasFor(string $foreignTable, string $column): string
    {
        $alias = $foreignTable.'_via_'.$column;

        // PostgreSQL truncates identifiers at 63 bytes SILENTLY, which would
        // turn two long distinct aliases back into one collision.
        if (strlen($alias) > 60) {
            $alias = substr($alias, 0, 50).'_'.substr(md5($alias), 0, 8);
        }

        return $alias;
    }

    /**
     * @param  array<string, mixed>  $taken
     */
    private function uniqueKey(string $preferred, array $taken): string
    {
        if (! isset($taken[$preferred])) {
            return $preferred;
        }

        $candidate = $preferred.'_2';
        $suffix = 2;

        while (isset($taken[$candidate])) {
            $suffix++;
            $candidate = $preferred.'_'.$suffix;
        }

        return $candidate;
    }

    /**
     * The column on a joined table that a human would recognise the row by.
     *
     * Null when there is none — and then the foreign key stays a plain number,
     * because inventing a label out of an id would put an integer in front of
     * somebody as if it were a name.
     */
    private function labelColumnOf(string $foreignTable): ?string
    {
        if (! $this->hasTable($foreignTable)) {
            return null;
        }

        $columns = [];
        foreach ($this->columnsOf($foreignTable) as $column) {
            $columns[$column['name']] = $column;
        }

        foreach (self::LABEL_COLUMNS as $candidate) {
            if (! isset($columns[$candidate]) || self::isExcludedColumn($candidate)) {
                continue;
            }

            if ($this->columnType($columns[$candidate]) === 'text') {
                return $candidate;
            }
        }

        return null;
    }

    /**
     * Single-column foreign keys, keyed by the local column.
     *
     * Composite keys are skipped: there is no single column to hang a dimension
     * on, and half of one is a join that quietly matches the wrong rows.
     *
     * @return array<string, array{table: string, column: string}>
     */
    private function foreignKeysOf(string $table): array
    {
        $keys = [];

        foreach (Schema::getForeignKeys($table) as $foreignKey) {
            if (count($foreignKey['columns']) !== 1 || count($foreignKey['foreign_columns']) !== 1) {
                continue;
            }

            $keys[$foreignKey['columns'][0]] = [
                'table' => $foreignKey['foreign_table'],
                'column' => $foreignKey['foreign_columns'][0],
            ];
        }

        return $keys;
    }

    /** @return array<int, array<string, mixed>> */
    private function columnsOf(string $table): array
    {
        return $this->columnCache[$table] ??= Schema::getColumns($table);
    }

    private function hasTable(string $table): bool
    {
        return $this->tableExists[$table] ??= Schema::hasTable($table);
    }

    private function humanise(string $name): string
    {
        return ucfirst(trim(str_replace('_', ' ', strtolower($name))));
    }

    /** @return array<int, string> */
    private static function tokenise(string $name): array
    {
        return preg_split('/[^a-z0-9]+/', strtolower($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    }

    /**
     * @param  array<int, string>  $tokens
     * @param  array<int, string>  $sequence
     */
    private static function containsSequence(array $tokens, array $sequence): bool
    {
        $length = count($sequence);

        for ($i = 0; $i + $length <= count($tokens); $i++) {
            if (array_slice($tokens, $i, $length) === $sequence) {
                return true;
            }
        }

        return false;
    }
}
