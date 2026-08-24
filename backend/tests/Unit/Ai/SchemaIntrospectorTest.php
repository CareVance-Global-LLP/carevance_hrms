<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\SchemaIntrospector;
use App\Traits\BelongsToOrganization;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Derivation is what turns seven hand-written entities into the whole schema,
 * so it is also what turns one forgotten exclusion into eighty leaks.
 *
 * These tests assert the two halves of that bargain separately: that coverage
 * is genuinely wide, and that width costs nothing in exposure. The exclusion
 * assertions deliberately re-state the forbidden names as literals rather than
 * calling the introspector's own predicate — a test that asks the code under
 * test what "excluded" means cannot catch the code changing its mind.
 */
class SchemaIntrospectorTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Tokens that may never appear in any derived column name, select or key.
     *
     * Written out here, not imported, for the reason in the class docblock.
     * Matched on snake_case word boundaries because substrings are wrong in
     * both directions: "designation", "residual" and "resignation" all contain
     * "esi", and "company" contains "pan".
     */
    private const FORBIDDEN_TOKENS = [
        'password', 'token', 'secret',
        'pan', 'uan', 'esi', 'aadhaar', 'aadhar',
        'account', 'ifsc', 'swift', 'google',
    ];

    /**
     * Real columns in this schema that carry a statutory identifier, a bank
     * destination or a credential. None of them may appear anywhere in the
     * derived layer, under any key, on any entity.
     */
    private const FORBIDDEN_COLUMNS = [
        'password', 'remember_token', 'google_id', 'google_token', 'google_refresh_token',
        'api_key', 'api_secret', 'api_token', 'token_hash', 'signing_token_hash',
        'pan', 'pan_number', 'pan_deductor', 'pan_employee', 'pan_or_tax_id',
        'uan', 'uan_number', 'esi_number', 'esi_ip_number', 'esi_code',
        'account_number', 'bank_account_number', 'pf_account_number',
        'beneficiary_account', 'beneficiary_ifsc', 'ifsc_swift', 'bank_ifsc_swift',
    ];

    public function test_it_derives_an_entity_for_more_than_a_hundred_tables(): void
    {
        // 160 of the 221 tables carry organization_id; 146 of those have an
        // Eloquent model that carries the tenant scope. Seven hand-written
        // entities covered under 10% of what an admin can ask about, which is
        // the whole reason derivation exists.
        $entities = SchemaIntrospector::derive();

        $this->assertGreaterThanOrEqual(
            100,
            count($entities),
            'Derivation found only '.count($entities).' entities; the schema has 160 org-scoped tables.'
        );

        foreach (['payroll_items', 'attendance_records', 'leave_requests', 'assets', 'tasks'] as $table) {
            $this->assertArrayHasKey($table, $entities, "{$table} was not derived.");
        }
    }

    public function test_no_derived_entity_exposes_an_excluded_column(): void
    {
        foreach (SchemaIntrospector::derive() as $entityKey => $entity) {
            foreach ($entity['dimensions'] as $key => $dimension) {
                $this->assertNotForbidden($key, "{$entityKey} dimension key");
                $this->assertNotForbidden($this->columnOf($dimension['select']), "{$entityKey}.{$key} dimension select");
            }

            foreach ($entity['list_columns'] as $key => $column) {
                $this->assertNotForbidden($key, "{$entityKey} list column key");
                $this->assertNotForbidden($this->columnOf($column['select']), "{$entityKey}.{$key} list column select");
            }

            foreach ($entity['metrics'] as $key => $metric) {
                $this->assertNotForbidden($key, "{$entityKey} metric key");

                if ($metric['column'] !== null) {
                    $this->assertNotForbidden($this->columnOf($metric['column']), "{$entityKey}.{$key} metric column");
                }
            }
        }
    }

    public function test_the_named_statutory_and_credential_columns_appear_nowhere_at_all(): void
    {
        // The pattern test above proves the rule; this proves the rule reaches
        // the columns it was written for. A pattern that matched nothing real
        // would pass the first test and protect nobody.
        $haystack = strtolower(json_encode(SchemaIntrospector::derive()));

        foreach (self::FORBIDDEN_COLUMNS as $column) {
            $this->assertStringNotContainsString(
                '.'.$column.'"',
                $haystack,
                "{$column} is selectable through the derived layer."
            );
            $this->assertStringNotContainsString(
                '"'.$column.'"',
                $haystack,
                "{$column} is named as a key in the derived layer."
            );
        }
    }

    public function test_the_exclusion_predicate_is_by_word_not_by_substring(): void
    {
        // Substring matching excludes half the schema by accident: "designation",
        // "residual" and "resignation" all contain "esi"; "company" contains
        // "pan". A rule that eats real columns gets loosened, and then it stops
        // protecting the ones it was written for.
        foreach (['pan_number', 'uan', 'esi_ip_number', 'password', 'remember_token', 'api_secret', 'google_refresh_token', 'account_number', 'bank_account_number', 'beneficiary_ifsc'] as $column) {
            $this->assertTrue(SchemaIntrospector::isExcludedColumn($column), "{$column} should be excluded.");
        }

        foreach (['designation', 'residual_order', 'resignation_date', 'company_name', 'panel_size', 'expansion', 'tokenable_type', 'total_amount'] as $column) {
            $this->assertFalse(SchemaIntrospector::isExcludedColumn($column), "{$column} should NOT be excluded.");
        }
    }

    public function test_a_foreign_key_becomes_a_joined_label_dimension(): void
    {
        $payroll = SchemaIntrospector::derive()['payroll_items'];

        // department_id -> groups.id. There is no departments table; departments
        // ARE the groups table, and the raw id answers nothing a human asked.
        $this->assertArrayHasKey('department', $payroll['dimensions']);
        $department = $payroll['dimensions']['department'];

        $this->assertSame('text', $department['type']);
        $this->assertStringEndsWith('.name', $department['select'], 'A foreign key must resolve to a label, not an id.');
        $this->assertNotSame('department_id', $this->columnOf($department['select']));

        // The join it needs is declared on the entity, because list_columns
        // carry no join of their own and both sides select through it.
        $joinedTables = array_map(fn (array $join) => $join[0], $payroll['joins']);
        $groupsJoin = null;
        foreach ($payroll['joins'] as $join) {
            if (str_starts_with($join[0], 'groups')) {
                $groupsJoin = $join;
            }
        }

        $this->assertNotNull($groupsJoin, 'No join to groups was declared: '.implode(', ', $joinedTables));
        $this->assertSame('=', $groupsJoin[2]);
        $this->assertSame('payroll_items.department_id', $groupsJoin[3]);
        $this->assertStringStartsWith($this->aliasOf($department['select']).'.', $groupsJoin[1]);

        // The raw id must not survive alongside the label, or a caller can group
        // by an integer nobody can read.
        $this->assertArrayNotHasKey('department_id', $payroll['dimensions']);
        $this->assertArrayNotHasKey('department_id', $payroll['list_columns']);
    }

    public function test_a_row_belonging_to_a_person_exposes_an_employee_dimension(): void
    {
        // Grouping by employee is what turns "how many" into "who", and "who"
        // is most of what an admin asks.
        $entities = SchemaIntrospector::derive();

        foreach (['payroll_items', 'attendance_records', 'leave_requests'] as $table) {
            $entity = $entities[$table];

            $this->assertArrayHasKey('employee', $entity['dimensions'], "{$table} has a user_id but no employee dimension.");
            $this->assertStringEndsWith('.name', $entity['dimensions']['employee']['select']);
            $this->assertArrayNotHasKey('user_id', $entity['dimensions']);
        }
    }

    public function test_several_foreign_keys_to_one_table_are_aliased_apart(): void
    {
        // leave_requests points at users four times: user_id, reviewed_by,
        // revoke_reviewed_by and escalated_to_user_id. Joining `users` four
        // times under one name is not a wrong answer, it is a SQL error.
        $leave = SchemaIntrospector::derive()['leave_requests'];

        $userJoins = array_values(array_filter(
            $leave['joins'],
            fn (array $join) => str_contains($join[3], 'leave_requests.') && str_starts_with($join[0], 'users')
        ));

        $this->assertGreaterThan(1, count($userJoins), 'Expected several joins to users on leave_requests.');

        $aliases = array_map(fn (array $join) => $this->aliasOf($join[1]), $userJoins);
        $this->assertSame($aliases, array_unique($aliases), 'Two joins to users share one alias: '.implode(', ', $aliases));

        $selects = array_map(fn (array $d) => $d['select'], $leave['dimensions']);
        $this->assertSame(
            array_values($selects),
            array_values(array_unique($selects)),
            'Two dimensions select the same expression, so one of them answers the wrong question.'
        );
    }

    public function test_a_decimal_column_named_like_an_amount_gets_money_format(): void
    {
        $payroll = SchemaIntrospector::derive()['payroll_items'];

        foreach (['sum_net_pay', 'avg_net_pay', 'min_net_pay', 'max_net_pay'] as $key) {
            $this->assertArrayHasKey($key, $payroll['metrics'], "{$key} was not derived.");
            $this->assertSame('money', $payroll['metrics'][$key]['format'], "{$key} is not formatted as money.");
            $this->assertSame('money', $payroll['metrics'][$key]['type']);
            $this->assertSame('net_pay', $payroll['metrics'][$key]['column']);
        }

        $this->assertSame('money', $payroll['list_columns']['net_pay']['type']);
        $this->assertSame('money', $payroll['dimensions']['net_pay']['type']);

        // A decimal that is not an amount is not money. activity_percentage is
        // numeric(5,2) and rendering it as ₹98.50 is a lie with a currency sign
        // on it.
        $this->assertSame('number', $payroll['metrics']['avg_activity_percentage']['format']);
        $this->assertSame('number', $payroll['list_columns']['activity_percentage']['type']);

        // An integer count of days is not money however it is named — and
        // total_working_days is named exactly like the tokens that flag one.
        $this->assertSame('number', $payroll['metrics']['sum_total_working_days']['format']);

        // A period is not a unit. `month` says WHEN the figure applies, not what
        // it measures, and reading the calendar as the unit turned two columns
        // of rupees into plain numbers.
        $this->assertSame('money', $payroll['list_columns']['gross_full_month']['type']);

        // Professional tax carries no generic money word at all. The salary
        // components an Indian payroll names are the vocabulary this schema
        // stores its rupees under, so they are part of the rule.
        $this->assertSame('money', $payroll['list_columns']['pt']['type']);
        $this->assertSame('money', $payroll['list_columns']['lwf']['type']);

        // A decimal count of days stays a count, whatever else is in its name.
        $this->assertSame('number', $payroll['list_columns']['present_days']['type']);
        $this->assertSame('number', $payroll['list_columns']['total_payable_days']['type']);
    }

    public function test_every_entity_gets_a_count_and_every_numeric_column_four_aggregates(): void
    {
        $payroll = SchemaIntrospector::derive()['payroll_items'];

        $this->assertArrayHasKey('count', $payroll['metrics']);
        $this->assertSame('count', $payroll['metrics']['count']['aggregate']);
        $this->assertNull($payroll['metrics']['count']['column']);

        foreach (['sum' => 'sum_gross_salary', 'avg' => 'avg_gross_salary', 'min' => 'min_gross_salary', 'max' => 'max_gross_salary'] as $aggregate => $key) {
            $this->assertSame($aggregate, $payroll['metrics'][$key]['aggregate']);
            $this->assertSame('gross_salary', $payroll['metrics'][$key]['column']);
        }

        // An id is not a measurement. sum_user_id is a number the database will
        // happily produce and nobody can use.
        foreach (['sum_id', 'sum_user_id', 'sum_organization_id', 'avg_department_id'] as $key) {
            $this->assertArrayNotHasKey($key, $payroll['metrics'], "{$key} aggregates an identifier.");
        }
    }

    public function test_a_derived_metric_says_it_is_derived_and_states_its_definition(): void
    {
        // A derived metric is naive by construction: AVG(net_pay) over every
        // row returns 76,313.27 where the truth is 91,575.93. The answer has to
        // be able to say which one it computed.
        foreach (SchemaIntrospector::derive() as $entityKey => $entity) {
            foreach ($entity['metrics'] as $metricKey => $metric) {
                $this->assertSame('derived', $metric['origin'], "{$entityKey}.{$metricKey}");
                $this->assertNotEmpty($metric['note'], "{$entityKey}.{$metricKey} states no definition.");
                $this->assertSame([], $metric['where'], "{$entityKey}.{$metricKey} is derived but carries exclusions.");
            }
        }
    }

    public function test_the_tenant_column_and_the_primary_key_are_not_dimensions(): void
    {
        // organization_id is the same value on every row a caller can see, so
        // grouping by it is one row; offering it as a filter invites somebody to
        // try another tenant's id.
        foreach (SchemaIntrospector::derive() as $entityKey => $entity) {
            foreach (['organization_id', 'id'] as $column) {
                $this->assertArrayNotHasKey($column, $entity['dimensions'], "{$entityKey} exposes {$column}");
                $this->assertArrayNotHasKey($column, $entity['list_columns'], "{$entityKey} lists {$column}");
            }
        }
    }

    public function test_every_derived_entity_is_queryable_through_a_tenant_scoped_model(): void
    {
        // The global scope is the whole isolation guarantee. An entity whose
        // model does not carry it would read every tenant's rows through a
        // question anyone can ask in English.
        $entities = SchemaIntrospector::derive();

        foreach ($entities as $entityKey => $entity) {
            $this->assertTrue(class_exists($entity['model']), "{$entityKey} names no model.");
            $this->assertContains(
                BelongsToOrganization::class,
                class_uses_recursive($entity['model']),
                "{$entityKey} is derived from {$entity['model']}, which has no organization scope."
            );
        }

        // users carries organization_id but User is deliberately unscoped — the
        // scope resolves the acting user through Auth. It therefore may not be
        // derived; people are reached through the curated entity instead.
        $this->assertArrayNotHasKey('users', $entities);
        $this->assertArrayNotHasKey('invitations', $entities);
        $this->assertArrayNotHasKey('organization_stats', $entities);
    }

    public function test_every_derived_entity_declares_the_shape_the_executor_relies_on(): void
    {
        foreach (SchemaIntrospector::derive() as $entityKey => $entity) {
            foreach (['label', 'table', 'model', 'joins', 'metrics', 'dimensions', 'list_columns'] as $key) {
                $this->assertArrayHasKey($key, $entity, "{$entityKey} is missing {$key}");
            }

            $this->assertTrue(Schema::hasTable($entity['table']), "{$entityKey} names a table that does not exist.");

            foreach ($entity['metrics'] as $metricKey => $metric) {
                $where = "{$entityKey}.{$metricKey}";
                $this->assertContains($metric['type'], ['money', 'number'], $where);
                $this->assertContains($metric['aggregate'], ['count', 'sum', 'avg', 'min', 'max'], $where);

                if ($metric['aggregate'] !== 'count') {
                    $this->assertNotNull($metric['column'], "{$where} aggregates but names no column");
                }
            }

            foreach ($entity['dimensions'] as $dimensionKey => $dimension) {
                $where = "{$entityKey}.{$dimensionKey}";
                $this->assertContains($dimension['type'], ['text', 'number', 'date', 'money'], $where);
                $this->assertNotEmpty($dimension['null_label'], $where);
                $this->assertStringContainsString('.', $dimension['select'], $where);

                // A dimension carries no join of its own: every join is declared
                // once on the entity and applied before any dimension is read.
                // Declaring it twice is how the same table gets joined twice.
                $this->assertNull($dimension['join'], "{$where} declares a join the entity already applies.");

                if ($dimension['type'] === 'date') {
                    $this->assertSame('Y-m-d', $dimension['date_format'], $where);
                } else {
                    $this->assertNull($dimension['date_format'], $where);
                }
            }

            foreach ($entity['list_columns'] as $listKey => $column) {
                $where = "{$entityKey}.{$listKey}";
                $this->assertContains($column['type'], ['text', 'number', 'date', 'money'], $where);
                $this->assertNotEmpty($column['label'], $where);
                $this->assertStringContainsString('.', $column['select'], $where);
            }

            foreach ($entity['joins'] as $join) {
                $this->assertCount(4, $join, "{$entityKey} has a malformed join.");
                $this->assertSame('=', $join[2]);
            }
        }
    }

    public function test_derivation_is_deterministic(): void
    {
        // The layer is cached and rebuilt on migration. Two rebuilds that differ
        // would move a metric key out from under a saved question.
        $this->assertSame(SchemaIntrospector::derive(), SchemaIntrospector::derive());
    }

    private function assertNotForbidden(string $name, string $context): void
    {
        $tokens = preg_split('/[^a-z0-9]+/', strtolower($name), -1, PREG_SPLIT_NO_EMPTY);

        foreach (self::FORBIDDEN_TOKENS as $forbidden) {
            $this->assertNotContains($forbidden, $tokens, "{$context} '{$name}' exposes '{$forbidden}'.");
        }
    }

    private function columnOf(string $select): string
    {
        $parts = explode('.', $select);

        return end($parts);
    }

    private function aliasOf(string $select): string
    {
        return explode('.', $select)[0];
    }
}
