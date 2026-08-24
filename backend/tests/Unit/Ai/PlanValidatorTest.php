<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\PlanValidator;
use App\Services\Ai\UnsupportedQuestionException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Refusal is the feature. A plan naming something outside the layer must be
 * rejected by name — never coerced into the nearest match, because a silently
 * substituted metric is exactly the confident-wrong-number failure the whole
 * design is built to avoid.
 *
 * RefreshDatabase: PlanValidator resolves every plan through SemanticLayer,
 * which now derives from the real schema.
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

    public function test_accepts_a_well_formed_plan(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'payroll',
            'metric' => 'avg_net_pay',
            'group_by' => 'department',
            'limit' => 10,
        ]);

        $this->assertSame('payroll', $plan['entity']);
        $this->assertSame('avg_net_pay', $plan['metric']);
        $this->assertSame('department', $plan['group_by']);
        $this->assertSame(10, $plan['limit']);
    }

    public function test_rejects_an_unknown_entity_by_name(): void
    {
        $this->expectException(UnsupportedQuestionException::class);
        $this->expectExceptionMessageMatches('/nationality/');

        $this->validator->validate(['entity' => 'nationality', 'metric' => 'headcount']);
    }

    public function test_rejects_a_metric_that_belongs_to_another_entity(): void
    {
        // avg_net_pay is real, but not on `attendance`. Nearest-match coercion
        // here is how a payroll figure gets attributed to attendance data.
        $this->expectException(UnsupportedQuestionException::class);
        $this->expectExceptionMessageMatches('/avg_net_pay/');

        $this->validator->validate(['entity' => 'attendance', 'metric' => 'avg_net_pay']);
    }

    public function test_rejects_an_unknown_dimension(): void
    {
        $this->expectException(UnsupportedQuestionException::class);
        $this->expectExceptionMessageMatches('/blood_group/');

        $this->validator->validate([
            'entity' => 'employees',
            'metric' => 'headcount',
            'group_by' => 'blood_group',
        ]);
    }

    public function test_a_missing_group_by_is_allowed_and_normalises_to_null(): void
    {
        $plan = $this->validator->validate(['entity' => 'employees', 'metric' => 'headcount']);

        $this->assertNull($plan['group_by']);
    }

    public function test_an_oversized_limit_is_clamped_rather_than_trusted(): void
    {
        $this->assertSame(500, $this->validator->validate([
            'entity' => 'employees', 'metric' => 'headcount', 'limit' => 100000,
        ])['limit']);
    }

    public function test_an_error_plan_from_the_model_is_refused_with_its_reason(): void
    {
        $this->expectException(UnsupportedQuestionException::class);
        // Case-sensitive on purpose: the model's sentence is passed through
        // verbatim, so the capital is part of what is being asserted. Lowering
        // it to /weather/ never matches and never can.
        $this->expectExceptionMessageMatches('/Weather/');

        $this->validator->validate(['error' => 'Weather is not HR data']);
    }

    public function test_filters_naming_unknown_dimensions_are_refused(): void
    {
        $this->expectException(UnsupportedQuestionException::class);
        $this->expectExceptionMessageMatches('/salary_band/');

        $this->validator->validate([
            'entity' => 'employees',
            'metric' => 'headcount',
            'filters' => ['salary_band' => 'senior'],
        ]);
    }

    public function test_a_zero_limit_means_default_not_one_row(): void
    {
        // The planner returned {"limit":0} for "headcount by department" and the
        // old `?? DEFAULT` only caught null, so 0 clamped to 1 — the answer came
        // back as a single arbitrary department and read like the org had one.
        $plan = $this->validator->validate([
            'entity' => 'employees', 'metric' => 'headcount', 'group_by' => 'department', 'limit' => 0,
        ]);

        $this->assertSame(20, $plan['limit']);
    }

    public function test_a_negative_limit_also_falls_back_to_default(): void
    {
        $plan = $this->validator->validate([
            'entity' => 'employees', 'metric' => 'headcount', 'limit' => -5,
        ]);

        $this->assertSame(20, $plan['limit']);
    }
}
