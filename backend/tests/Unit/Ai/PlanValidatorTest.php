<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\PlanValidator;
use App\Services\Ai\UnsupportedQuestionException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Tests\TestCase;

/**
 * Refusal is the feature, and so is understanding.
 *
 * Two failures are defended against here and they pull in opposite directions,
 * which is why both halves are tested this hard:
 *
 *  - A plan naming something outside the layer must be rejected BY NAME, never
 *    coerced into the nearest match. A silently substituted metric is the
 *    confident-wrong-number failure the whole design exists to prevent.
 *  - A plan the validator COULD honour must not be refused, and a filter it
 *    cannot honour must not be silently dropped. "list employees who joined
 *    this year" answered `count: 0` against a true answer of 14, because the
 *    model emitted a nested `{"joining_date":{"gte":…,"lte":…}}` filter that
 *    the v1 validator neither understood nor refused. A dropped filter asks a
 *    wider question and reports the answer with undiminished confidence.
 *
 * RefreshDatabase: PlanValidator resolves every plan through SemanticLayer,
 * which derives from the real schema.
 *
 * @see docs/superpowers/specs/2026-08-24-ai-mode-grammar-v2.md §1-§5
 */
class PlanValidatorTest extends TestCase
{
    use RefreshDatabase;

    private PlanValidator $validator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->validator = new PlanValidator();
    }

    /**
     * Every refusal is asserted through its DETAIL, because the detail is what
     * reaches the person who asked. A refusal that does not name what was wrong
     * is a dead end even when the exception type is right.
     */
    private function refusalFor(array $plan): string
    {
        try {
            $this->validator->validate($plan);
        } catch (UnsupportedQuestionException $e) {
            return $e->getDetail();
        }

        $this->fail('This plan should have been refused: '.json_encode($plan));
    }

    // ---------------------------------------------------------------- v1 shape

    public function test_the_v1_singular_shape_is_normalised_into_the_v2_arrays(): void
    {
        // Older plans, the golden fixture and the planner's current prompt all
        // still emit `metric`/`group_by` as scalars. Normalising rather than
        // refusing is what lets the grammar move without a flag day.
        $plan = $this->validator->validate([
            'entity' => 'payroll',
            'metric' => 'avg_net_pay',
            'group_by' => 'department',
            'limit' => 10,
        ]);

        $this->assertSame('payroll', $plan['entity']);
        $this->assertSame('aggregate', $plan['mode']);
        $this->assertSame(['avg_net_pay'], $plan['metrics']);
        $this->assertSame(['department'], $plan['group_by']);
        $this->assertSame([], $plan['columns']);
        $this->assertSame(10, $plan['limit']);
    }

    public function test_a_missing_group_by_normalises_to_an_empty_list(): void
    {
        $plan = $this->validator->validate(['entity' => 'employees', 'metric' => 'headcount']);

        $this->assertSame([], $plan['group_by']);
    }

    public function test_the_v1_sort_strings_still_sort_by_the_first_metric(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'group_by' => 'department', 'sort' => 'metric_desc',
        ]);

        $this->assertSame(['by' => 'avg_net_pay', 'dir' => 'desc'], $plan['sort']);
    }

    public function test_an_error_plan_from_the_model_is_refused_with_its_reason(): void
    {
        // Case-sensitive on purpose: the model's sentence is passed through
        // verbatim, so the capital is part of what is being asserted.
        $this->assertStringContainsString('Weather', $this->refusalFor(['error' => 'Weather is not HR data']));
    }

    // ------------------------------------------------------------------ naming

    public function test_rejects_an_unknown_entity_by_name(): void
    {
        $this->assertStringContainsString(
            'nationality',
            $this->refusalFor(['entity' => 'nationality', 'metric' => 'headcount'])
        );
    }

    public function test_rejects_a_metric_that_belongs_to_another_entity(): void
    {
        // avg_net_pay is real, but not on `attendance`. Nearest-match coercion
        // here is how a payroll figure gets attributed to attendance data.
        $this->assertStringContainsString(
            'avg_net_pay',
            $this->refusalFor(['entity' => 'attendance', 'metric' => 'avg_net_pay'])
        );
    }

    public function test_rejects_an_unknown_dimension(): void
    {
        $this->assertStringContainsString('blood_group', $this->refusalFor([
            'entity' => 'employees', 'metric' => 'headcount', 'group_by' => 'blood_group',
        ]));
    }

    public function test_rejects_an_unknown_list_column_by_name(): void
    {
        $this->assertStringContainsString('nationality', $this->refusalFor([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name', 'nationality'],
        ]));
    }

    public function test_a_statutory_identifier_is_refused_as_policy_not_as_a_typo(): void
    {
        // §10: the data exists and we will not expose it. Saying "no such
        // column" would be a lie, and would invite somebody to go looking for
        // the right spelling.
        $detail = $this->refusalFor(['entity' => 'employees', 'mode' => 'list', 'columns' => ['name', 'pan']]);

        $this->assertStringContainsString('pan', strtolower($detail));
        $this->assertStringContainsString('not available', strtolower($detail));
    }

    // -------------------------------------------------------------------- mode

    public function test_a_row_listing_cannot_also_be_grouped(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'employees', 'mode' => 'list',
            'columns' => ['name'], 'group_by' => ['department'],
        ]);

        $this->assertStringContainsString('group', strtolower($detail));
    }

    public function test_an_aggregate_cannot_carry_list_columns(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'employees', 'mode' => 'aggregate',
            'metric' => 'headcount', 'columns' => ['name'],
        ]);

        $this->assertStringContainsString('columns', strtolower($detail));
    }

    public function test_an_unknown_mode_is_refused_by_name(): void
    {
        $this->assertStringContainsString('chart', $this->refusalFor([
            'entity' => 'employees', 'mode' => 'chart', 'metric' => 'headcount',
        ]));
    }

    public function test_columns_with_no_metric_are_read_as_a_row_listing(): void
    {
        // Nothing else could be meant, and refusing a plan whose intent is
        // unambiguous is the narrowness this grammar exists to end.
        $plan = $this->validator->validate([
            'entity' => 'employees', 'columns' => ['name', 'joining_date'],
        ]);

        $this->assertSame('list', $plan['mode']);
        $this->assertSame(['name', 'joining_date'], $plan['columns']);
        $this->assertSame([], $plan['metrics']);
    }

    public function test_an_aggregate_with_no_metric_is_refused(): void
    {
        $this->assertStringContainsString('metric', strtolower($this->refusalFor(['entity' => 'employees'])));
    }

    public function test_a_listing_with_no_columns_is_refused(): void
    {
        $this->assertStringContainsString('column', strtolower($this->refusalFor([
            'entity' => 'employees', 'mode' => 'list', 'columns' => [],
        ])));
    }

    public function test_a_dimension_that_is_no_list_column_can_still_be_listed(): void
    {
        // §8's own worked example lists name, department and joining_date, and
        // `department` on employees is a CURATED DIMENSION with no list_columns
        // entry — derivation cannot see that departments are the `groups`
        // table. Refusing it would refuse the spec's own example. A dimension
        // is built from the same exclusion-filtered column set as a list
        // column, so this widens nothing §10 protects — as the PAN test above
        // pins.
        $plan = $this->validator->validate([
            'entity' => 'employees', 'mode' => 'list',
            'columns' => ['name', 'department', 'joining_date'],
        ]);

        $this->assertSame(['name', 'department', 'joining_date'], $plan['columns']);
    }

    // ------------------------------------------------------------------ counts

    public function test_more_than_four_metrics_are_refused(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'payroll',
            'metrics' => ['count', 'sum_basic', 'avg_basic', 'min_basic', 'max_basic'],
        ]);

        $this->assertStringContainsString('4', $detail);
    }

    public function test_more_than_eight_columns_are_refused(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'leave', 'mode' => 'list',
            'columns' => ['employee', 'start_date', 'end_date', 'reason', 'status',
                'reviewed_by', 'reviewed_at', 'review_note', 'leave_type'],
        ]);

        $this->assertStringContainsString('8', $detail);
    }

    public function test_more_than_two_group_by_dimensions_are_refused(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'],
            'group_by' => ['department', 'month', 'payment_status'],
        ]);

        $this->assertStringContainsString('2', $detail);
    }

    public function test_two_metrics_and_two_dimensions_are_accepted(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'payroll',
            'metrics' => ['avg_net_pay', 'total_gross'],
            'group_by' => ['department', 'month'],
        ]);

        $this->assertSame(['avg_net_pay', 'total_gross'], $plan['metrics']);
        $this->assertSame(['department', 'month'], $plan['group_by']);
    }

    public function test_the_same_metric_twice_is_refused_rather_than_deduplicated(): void
    {
        $this->assertStringContainsString('avg_net_pay', $this->refusalFor([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay', 'avg_net_pay'],
        ]));
    }

    // ------------------------------------------------------- DEFECT 2: filters

    public function test_the_nested_operator_filter_that_answered_zero_is_understood(): void
    {
        // THE REGRESSION. "list employees who joined this year" answered
        // `count: 0`; the true answer is 14. The model emitted exactly this
        // filter, the v1 validator did not understand the nested shape, did not
        // refuse it, and a dropped filter became a zero. Understood means two
        // operator filters that still name joining_date and still carry both
        // bounds — never an empty filter list.
        $plan = $this->validator->validate([
            'entity' => 'employees',
            'mode' => 'list',
            'columns' => ['name', 'department', 'joining_date'],
            'filters' => ['joining_date' => ['gte' => '2026-01-01', 'lte' => '2026-12-31']],
        ]);

        $this->assertCount(2, $plan['filters'], 'A filter the validator cannot honour must be refused, never dropped.');
        $this->assertSame(
            [
                ['field' => 'joining_date', 'op' => 'gte', 'value' => '2026-01-01'],
                ['field' => 'joining_date', 'op' => 'lte', 'value' => '2026-12-31'],
            ],
            $plan['filters']
        );
    }

    public function test_a_filter_shape_that_cannot_be_honoured_is_refused_by_name(): void
    {
        // The other half of the same rule. `roughly` is not an operator, so
        // this filter cannot be honoured — and a filter that cannot be honoured
        // is a refusal naming the field, never a query without it.
        $detail = $this->refusalFor([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'filters' => ['joining_date' => ['roughly' => '2026']],
        ]);

        $this->assertStringContainsString('joining_date', $detail);
        $this->assertStringContainsString('roughly', $detail);
    }

    public function test_a_filter_with_no_field_is_refused_rather_than_ignored(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'employees', 'metric' => 'headcount',
            'filters' => [['op' => 'gte', 'value' => '2026-01-01']],
        ]);

        $this->assertStringContainsString('filter', strtolower($detail));
    }

    public function test_filters_naming_unknown_fields_are_refused(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'employees', 'metric' => 'headcount',
            'filters' => ['salary_band' => 'senior'],
        ]);

        $this->assertStringContainsString('salary_band', $detail);
        $this->assertStringContainsString('employees', $detail);
    }

    public function test_the_v1_flat_filter_map_becomes_an_equality_filter(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'filters' => ['month' => '2026-07'],
        ]);

        $this->assertSame([['field' => 'month', 'op' => 'eq', 'value' => '2026-07']], $plan['filters']);
    }

    public function test_a_set_of_values_on_a_field_is_read_as_membership(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'attendance', 'metric' => 'absent_days',
            'filters' => ['status' => ['absent', 'half_day']],
        ]);

        $this->assertSame([['field' => 'status', 'op' => 'in', 'value' => ['absent', 'half_day']]], $plan['filters']);
    }

    public function test_the_v2_descriptor_list_is_taken_as_written(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'filters' => [
                ['field' => 'employment_type', 'op' => 'neq', 'value' => 'intern'],
                ['field' => 'exit_date', 'op' => 'is_null'],
            ],
        ]);

        $this->assertSame([
            ['field' => 'employment_type', 'op' => 'neq', 'value' => 'intern'],
            ['field' => 'exit_date', 'op' => 'is_null', 'value' => null],
        ], $plan['filters']);
    }

    public function test_an_unknown_operator_is_refused_by_name(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'filters' => [['field' => 'employee_code', 'op' => 'starts_with', 'value' => 'EMP']],
        ]);

        $this->assertStringContainsString('starts_with', $detail);
        $this->assertStringContainsString('employee_code', $detail);
    }

    public function test_contains_is_refused_on_a_money_field(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'filters' => [['field' => 'net_pay', 'op' => 'contains', 'value' => '9']],
        ]);

        $this->assertStringContainsString('net_pay', $detail);
        $this->assertStringContainsString('contains', $detail);
    }

    public function test_contains_is_accepted_on_a_text_field(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'filters' => [['field' => 'name', 'op' => 'contains', 'value' => 'sharma']],
        ]);

        $this->assertSame([['field' => 'name', 'op' => 'contains', 'value' => 'sharma']], $plan['filters']);
    }

    public function test_between_needs_exactly_two_bounds(): void
    {
        $this->assertStringContainsString('net_pay', $this->refusalFor([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'filters' => [['field' => 'net_pay', 'op' => 'between', 'value' => [50000]]],
        ]));
    }

    public function test_a_reversed_between_is_refused_rather_than_answered_with_nothing(): void
    {
        // An impossible band matches no rows, and no rows reads as "nobody
        // earns that much" — a different claim from "you asked for a band that
        // runs backwards".
        $this->assertStringContainsString('net_pay', $this->refusalFor([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'filters' => [['field' => 'net_pay', 'op' => 'between', 'value' => [90000, 50000]]],
        ]));
    }

    public function test_between_with_two_bounds_is_accepted(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'filters' => [['field' => 'net_pay', 'op' => 'between', 'value' => [50000, 90000]]],
        ]);

        $this->assertSame([['field' => 'net_pay', 'op' => 'between', 'value' => [50000, 90000]]], $plan['filters']);
    }

    public function test_an_in_list_is_capped_at_fifty_values(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'attendance', 'metric' => 'absent_days',
            'filters' => [['field' => 'status', 'op' => 'in', 'value' => range(1, 51)]],
        ]);

        $this->assertStringContainsString('50', $detail);
    }

    public function test_an_empty_in_list_is_refused_rather_than_matching_nothing(): void
    {
        $this->assertStringContainsString('status', $this->refusalFor([
            'entity' => 'attendance', 'metric' => 'absent_days',
            'filters' => [['field' => 'status', 'op' => 'in', 'value' => []]],
        ]));
    }

    public function test_equality_against_null_is_refused_rather_than_read_as_is_null(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'employees', 'metric' => 'headcount',
            'filters' => ['exit_date' => null],
        ]);

        $this->assertStringContainsString('exit_date', $detail);
    }

    // ----------------------------------------------------------------- periods

    public function test_a_period_token_is_resolved_to_concrete_bounds_here(): void
    {
        // Resolved at validation so the executor never parses a token — one
        // parser, one set of bounds, and the label the answer quotes back is
        // derived from the same range that was filtered on.
        Carbon::setTestNow(Carbon::parse('2026-08-24'));

        try {
            $plan = $this->validator->validate([
                'entity' => 'attendance', 'metric' => 'absent_days', 'group_by' => 'employee',
                'filters' => [['field' => 'date', 'op' => 'period', 'value' => 'last_month']],
            ]);
        } finally {
            Carbon::setTestNow();
        }

        $this->assertSame('period', $plan['filters'][0]['op']);
        $this->assertSame('last_month', $plan['filters'][0]['token']);
        $this->assertSame('2026-07-01', $plan['filters'][0]['value']['start']);
        $this->assertSame('2026-07-31', $plan['filters'][0]['value']['end']);
        $this->assertSame('July 2026', $plan['filters'][0]['value']['label']);
    }

    public function test_an_explicit_month_is_a_period_too(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'payroll', 'metrics' => ['total_gross'], 'group_by' => ['department'],
            'filters' => [['field' => 'month', 'op' => 'period', 'value' => '2026-07']],
        ]);

        $this->assertSame('2026-07-01', $plan['filters'][0]['value']['start']);
        $this->assertSame('2026-07-31', $plan['filters'][0]['value']['end']);
    }

    public function test_an_unresolvable_period_is_refused_by_name(): void
    {
        // A wrong range answers a different question with the same confidence,
        // so a token nobody wrote down is a refusal and never a nearest guess.
        $this->assertStringContainsString('last_fortnight', $this->refusalFor([
            'entity' => 'attendance', 'metric' => 'absent_days',
            'filters' => [['field' => 'date', 'op' => 'period', 'value' => 'last_fortnight']],
        ]));
    }

    public function test_a_period_on_a_money_field_is_refused(): void
    {
        $this->assertStringContainsString('net_pay', $this->refusalFor([
            'entity' => 'payroll', 'metric' => 'avg_net_pay',
            'filters' => [['field' => 'net_pay', 'op' => 'period', 'value' => 'this_year']],
        ]));
    }

    // ------------------------------------------------------------------ having

    public function test_the_absent_more_than_three_days_example_validates(): void
    {
        // §8's first worked example, and the question v1 could not express.
        $plan = $this->validator->validate([
            'entity' => 'attendance',
            'metrics' => ['absent_days'],
            'group_by' => ['employee'],
            'filters' => [['field' => 'date', 'op' => 'period', 'value' => 'last_month']],
            'having' => [['metric' => 'absent_days', 'op' => 'gt', 'value' => 3]],
            'sort' => ['by' => 'absent_days', 'dir' => 'desc'],
        ]);

        $this->assertSame([['metric' => 'absent_days', 'op' => 'gt', 'value' => 3]], $plan['having']);
        $this->assertSame(['by' => 'absent_days', 'dir' => 'desc'], $plan['sort']);
    }

    public function test_a_having_on_a_metric_the_plan_does_not_compute_is_refused(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'attendance', 'metrics' => ['absent_days'],
            'group_by' => ['employee'],
            'having' => [['metric' => 'late_count', 'op' => 'gt', 'value' => 3]],
        ]);

        $this->assertStringContainsString('late_count', $detail);
    }

    public function test_a_having_naming_no_metric_at_all_is_refused_by_name(): void
    {
        $this->assertStringContainsString('sick_days', $this->refusalFor([
            'entity' => 'attendance', 'metrics' => ['absent_days'], 'group_by' => ['employee'],
            'having' => [['metric' => 'sick_days', 'op' => 'gt', 'value' => 3]],
        ]));
    }

    public function test_the_nested_having_shape_is_understood_like_the_nested_filter(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'attendance', 'metrics' => ['absent_days'], 'group_by' => ['employee'],
            'having' => ['absent_days' => ['gt' => 3]],
        ]);

        $this->assertSame([['metric' => 'absent_days', 'op' => 'gt', 'value' => 3]], $plan['having']);
    }

    public function test_a_having_threshold_that_is_not_a_number_is_refused(): void
    {
        $this->assertStringContainsString('absent_days', $this->refusalFor([
            'entity' => 'attendance', 'metrics' => ['absent_days'], 'group_by' => ['employee'],
            'having' => [['metric' => 'absent_days', 'op' => 'gt', 'value' => 'a lot']],
        ]));
    }

    public function test_a_row_listing_cannot_carry_a_having(): void
    {
        $detail = $this->refusalFor([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name'],
            'having' => [['metric' => 'headcount', 'op' => 'gt', 'value' => 3]],
        ]);

        $this->assertStringContainsString('having', strtolower($detail));
    }

    // -------------------------------------------------------------------- sort

    public function test_a_sort_naming_nothing_in_the_plan_is_refused_by_name(): void
    {
        $this->assertStringContainsString('total_gross', $this->refusalFor([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['department'],
            'sort' => ['by' => 'total_gross', 'dir' => 'desc'],
        ]));
    }

    public function test_a_sort_by_a_group_by_dimension_is_allowed(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'payroll', 'metrics' => ['avg_net_pay'], 'group_by' => ['month'],
            'sort' => ['by' => 'month', 'dir' => 'asc'],
        ]);

        $this->assertSame(['by' => 'month', 'dir' => 'asc'], $plan['sort']);
    }

    public function test_a_missing_direction_defaults_by_what_is_being_sorted(): void
    {
        // A metric with no stated direction means "the biggest first" — that is
        // what "top departments" asks for. A name or a date means the order a
        // human reads it in.
        $byMetric = $this->validator->validate([
            'entity' => 'payroll', 'metrics' => ['total_gross'], 'group_by' => ['department'],
            'sort' => ['by' => 'total_gross'],
        ]);
        $byDimension = $this->validator->validate([
            'entity' => 'payroll', 'metrics' => ['total_gross'], 'group_by' => ['month'],
            'sort' => ['by' => 'month'],
        ]);

        $this->assertSame('desc', $byMetric['sort']['dir']);
        $this->assertSame('asc', $byDimension['sort']['dir']);
    }

    public function test_a_stated_direction_nobody_recognises_is_refused_not_guessed(): void
    {
        // Absence is a gap to fill by rule; a stated value nobody recognises is
        // a claim that cannot be honoured — and direction decides WHICH rows
        // survive the limit, so guessing it answers a different question.
        $this->assertStringContainsString('sideways', $this->refusalFor([
            'entity' => 'payroll', 'metrics' => ['total_gross'], 'group_by' => ['department'],
            'sort' => ['by' => 'total_gross', 'dir' => 'sideways'],
        ]));
    }

    public function test_a_listing_sorts_by_one_of_its_columns(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'employees', 'mode' => 'list', 'columns' => ['name', 'joining_date'],
            'sort' => ['by' => 'joining_date', 'dir' => 'desc'],
        ]);

        $this->assertSame(['by' => 'joining_date', 'dir' => 'desc'], $plan['sort']);
    }

    // ------------------------------------------------------------------- limit

    public function test_an_oversized_limit_is_clamped_rather_than_trusted(): void
    {
        $this->assertSame(500, $this->validator->validate([
            'entity' => 'employees', 'metric' => 'headcount', 'limit' => 100000,
        ])['limit']);
    }

    public function test_a_zero_limit_means_default_not_one_row(): void
    {
        // The planner returned {"limit":0} for "headcount by department" and the
        // old `?? DEFAULT` only caught null, so 0 clamped to 1 — the answer came
        // back as a single arbitrary department and read like the org had one.
        $this->assertSame(20, $this->validator->validate([
            'entity' => 'employees', 'metric' => 'headcount', 'group_by' => 'department', 'limit' => 0,
        ])['limit']);
    }

    public function test_a_negative_limit_also_falls_back_to_default(): void
    {
        $this->assertSame(20, $this->validator->validate([
            'entity' => 'employees', 'metric' => 'headcount', 'limit' => -5,
        ])['limit']);
    }
}
