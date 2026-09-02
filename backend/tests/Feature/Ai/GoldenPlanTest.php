<?php

namespace Tests\Feature\Ai;

use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Organization;
use App\Models\User;
use App\Services\Ai\MetricOverrides;
use App\Services\Ai\PlanValidator;
use App\Services\Ai\QueryPlanner;
use App\Services\Ai\SchemaIntrospector;
use App\Services\Ai\SemanticLayer;
use App\Services\Ai\UnsupportedQuestionException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The regression net, at v2.
 *
 * Renaming a metric, dropping a dimension, tightening the grammar or swapping
 * the planning model are all changes that break AI mode SILENTLY — the endpoint
 * still returns 200 and the numbers just get quieter and wronger. This asserts
 * the layer's contract directly, with no vendor in the loop: no model is called
 * here, so nothing in this file can pass because a model happened to phrase a
 * plan well on the day.
 *
 * Two things are pinned, and they pull in opposite directions:
 *
 *  1. **Every accepted plan normalises to EXACTLY the shape the fixture
 *     records.** Not "it validated" — a plan that validates with a filter
 *     quietly missing is the confident-wrong-answer failure, and only a shape
 *     assertion can see it.
 *  2. **Every refused plan is refused BY NAME.** A refusal that does not say
 *     which word was wrong is a dead end, so each refused case carries the
 *     tokens its message must contain.
 *
 * Both live defects of 24 Aug 2026 are in the fixture as named regression
 * cases, with their own tests below so they cannot be deleted quietly.
 *
 * RefreshDatabase: PlanValidator resolves every plan through SemanticLayer,
 * which derives from the real schema.
 *
 * @see docs/superpowers/specs/2026-08-24-ai-mode-grammar-v2.md
 */
class GoldenPlanTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Floors, not targets. The fixture is allowed to grow and is not allowed to
     * shrink: coverage grows by adding definitions that can be tested, and a
     * case deleted to make a change pass is how the grammar narrows without
     * anybody deciding to narrow it.
     */
    private const MIN_ACCEPTED = 25;
    private const MIN_REFUSED = 12;

    /** §14's two legitimate buckets, plus the grammar itself. */
    private const CATEGORIES = ['policy', 'not_in_schema', 'grammar'];

    /**
     * Every §5 rule that must have a case of its own. Named individually
     * because "some grammar violation is refused" is not the claim — each of
     * these is a separate way a plan goes wrong, and each has its own branch.
     */
    private const REQUIRED_RULES = [
        // §14.1 — excluded by policy. The data exists; we will not expose it.
        'excluded_pan',
        'excluded_bank_account',
        'excluded_password',
        // §14.2 — not in the schema at all.
        'unknown_dimension',
        // §5 — grammar violations.
        'contains_on_a_number',
        'between_one_element',
        'in_over_fifty',
        'having_unselected_metric',
        'sort_names_nothing',
        'list_mode_with_group_by',
        'unresolvable_period',
        'metric_from_wrong_entity',
    ];

    private PlanValidator $validator;

    /** @var array{accepted: list<array<string, mixed>>, refused: list<array<string, mixed>>} */
    private array $golden;

    protected function setUp(): void
    {
        parent::setUp();

        $this->validator = new PlanValidator();
        $this->golden = json_decode(
            file_get_contents(base_path('tests/Fixtures/ai/golden-plans.json')),
            true,
            512,
            JSON_THROW_ON_ERROR
        );
    }

    // ---------------------------------------------------------------- accepted

    public function test_every_accepted_plan_validates(): void
    {
        foreach ($this->golden['accepted'] as $case) {
            try {
                $plan = $this->validator->validate($case['plan']);
                $this->assertSame($case['plan']['entity'], $plan['entity'], $case['question']);
            } catch (UnsupportedQuestionException $e) {
                $this->fail("'{$case['question']}' should validate but was refused: {$e->getDetail()}");
            }
        }
    }

    /**
     * The assertion that "it validated" cannot make.
     *
     * A plan can validate with a filter silently missing, a limit clamped to
     * something nobody asked for, or a sort direction guessed the wrong way —
     * and every one of those returns 200 with a different answer than the
     * question. So the whole normalised shape is pinned, key by key, against
     * what the fixture records.
     */
    public function test_every_accepted_plan_normalises_exactly_as_the_fixture_pins_it(): void
    {
        foreach ($this->golden['accepted'] as $case) {
            $plan = $this->validator->validate($case['plan']);

            $this->assertNormalisedPlanMatches($case['expect'], $plan, $case['question']);
        }
    }

    /**
     * A case with no `expect` block is a case that only proves the validator
     * did not throw, which is the weaker half of what this file is for.
     */
    public function test_every_accepted_case_pins_its_normalised_shape(): void
    {
        foreach ($this->golden['accepted'] as $case) {
            $this->assertArrayHasKey('expect', $case, "'{$case['question']}' records no expected plan.");

            foreach (['entity', 'mode', 'metrics', 'columns', 'group_by', 'filters', 'having', 'limit'] as $key) {
                $this->assertArrayHasKey(
                    $key,
                    $case['expect'],
                    "'{$case['question']}' does not pin '{$key}' on its expected plan."
                );
            }
        }
    }

    /**
     * §10 is structural, so it is asserted structurally rather than trusted to
     * review: nothing in the accepted half may name a column the exclusion list
     * covers. A golden case is the most persuasive possible argument that a
     * field is safe to read, which is exactly why an excluded one must not be
     * able to arrive here by accident.
     */
    public function test_no_accepted_plan_names_an_excluded_column(): void
    {
        foreach ($this->golden['accepted'] as $case) {
            foreach ($this->namesUsedBy($case['plan']) as $name) {
                $this->assertFalse(
                    SchemaIntrospector::isExcludedColumn($name),
                    "'{$case['question']}' names '{$name}', which §10 excludes from every table at every role."
                );
            }
        }
    }

    // ----------------------------------------------------------------- refused

    public function test_every_refused_plan_is_refused(): void
    {
        foreach ($this->golden['refused'] as $case) {
            try {
                $this->validator->validate($case['plan']);
                $this->fail("'{$case['question']}' should have been refused but validated.");
            } catch (UnsupportedQuestionException $e) {
                $this->assertNotEmpty($e->getDetail(), $case['question']);
            }
        }
    }

    /**
     * §5's opening word is "by name". A refusal reading "invalid plan" is a
     * dead end: the person cannot tell whether they misspelled a field, asked
     * for something the schema does not hold, or asked for something policy
     * will not release, and those have three different next steps.
     */
    public function test_every_refusal_names_what_it_refused(): void
    {
        foreach ($this->golden['refused'] as $case) {
            $detail = $this->refusalFor($case['plan'], $case['question']);

            foreach ($case['names'] as $name) {
                $this->assertStringContainsStringIgnoringCase(
                    $name,
                    $detail,
                    "The refusal for '{$case['question']}' never mentions '{$name}': {$detail}"
                );
            }
        }
    }

    public function test_every_refused_case_declares_a_known_category(): void
    {
        foreach ($this->golden['refused'] as $case) {
            $this->assertContains(
                $case['category'],
                self::CATEGORIES,
                "'{$case['question']}' is filed under an unknown refusal category."
            );
        }
    }

    /**
     * §14: only two categories of question are legitimately refused, and a
     * refusal for any other reason is a bug in the layer rather than a feature.
     * Both must therefore stay represented — and so must every §5 grammar rule,
     * individually, because they fail in different places.
     */
    public function test_the_fixture_covers_both_refusal_categories_and_every_grammar_rule(): void
    {
        $categories = array_column($this->golden['refused'], 'category');
        $rules = array_column($this->golden['refused'], 'rule');

        foreach (self::CATEGORIES as $category) {
            $this->assertContains($category, $categories, "No refused case covers '{$category}'.");
        }

        foreach (self::REQUIRED_RULES as $rule) {
            $this->assertContains($rule, $rules, "No refused case covers the rule '{$rule}'.");
        }

        $this->assertSame(
            count($rules),
            count(array_unique($rules)),
            'Two refused cases claim the same rule, so one of them proves nothing.'
        );
    }

    // -------------------------------------------------------------- the floors

    /**
     * §8 is titled "Worked examples that MUST work", and its last two rows —
     * both refusals — matter as much as the first eight: coverage grows by
     * adding definitions that can be tested, and never by loosening validation.
     * So every row of that table keeps a case, on whichever side of the fixture
     * it belongs, and the `spec` tag is what makes a missing one say which.
     */
    public function test_every_worked_example_from_the_spec_keeps_a_case(): void
    {
        $tagged = [];

        foreach (array_merge($this->golden['accepted'], $this->golden['refused']) as $case) {
            if (preg_match('/^8 row (\d+)/', (string) ($case['spec'] ?? ''), $matches) === 1) {
                $tagged[] = (int) $matches[1];
            }
        }

        foreach (range(1, 10) as $row) {
            $this->assertContains($row, $tagged, "No golden case covers §8's worked example on row {$row}.");
        }
    }

    public function test_the_fixture_is_not_allowed_to_shrink(): void
    {
        $this->assertGreaterThanOrEqual(
            self::MIN_ACCEPTED,
            count($this->golden['accepted']),
            'The accepted half of the golden fixture has shrunk below its floor.'
        );

        $this->assertGreaterThanOrEqual(
            self::MIN_REFUSED,
            count($this->golden['refused']),
            'The refused half of the golden fixture has shrunk below its floor.'
        );
    }

    // ------------------------------------------------------------- the curated

    /**
     * The curated set is where the real numbers live.
     *
     * A derived metric is naive by construction and says so (§12); a CURATED one
     * exists because a specific wrong answer was found and measured, and it only
     * ever gets quieter when it drifts. `MetricOverrides` is walked directly
     * rather than through the merged layer so this fails the moment an override
     * is added without a question that exercises it.
     */
    public function test_every_curated_metric_override_has_an_accepted_case(): void
    {
        $covered = $this->coveredMetrics();

        foreach (MetricOverrides::all() as $key => $override) {
            if ($override['kind'] !== 'metric') {
                continue;
            }

            $this->assertContains(
                "{$override['entity']}.{$override['name']}",
                $covered,
                "No golden plan computes the curated metric '{$key}', so nothing would notice it drifting."
            );
        }
    }

    /**
     * The same rule at dimension granularity, and it is not decoration:
     * `payroll.department` is a curated dimension, and the 24 Aug regression was
     * precisely a plan grouping payroll by department being refused.
     */
    public function test_every_curated_dimension_override_has_an_accepted_case(): void
    {
        $covered = $this->coveredDimensions();

        foreach (MetricOverrides::all() as $key => $override) {
            if ($override['kind'] !== 'dimension') {
                continue;
            }

            $this->assertContains(
                "{$override['entity']}.{$override['name']}",
                $covered,
                "No golden plan groups by the curated dimension '{$key}'."
            );
        }
    }

    /**
     * "Every entity" means every CURATED entity, not every one of the ~150
     * SemanticLayer derives from the schema. Coverage of the derived surface is
     * already proven structurally, by SchemaIntrospectorTest — this fixture pins
     * the hand-verified surface, the one a wrong number could hide in.
     * Requiring a named question per schema table would make this fixture a
     * second, weaker copy of SchemaIntrospectorTest's own assertions rather than
     * a check on curated correctness.
     */
    public function test_the_fixture_covers_every_curated_entity(): void
    {
        $covered = array_unique(array_column(array_column($this->golden['accepted'], 'plan'), 'entity'));

        foreach (SemanticLayer::cached() as $entity => $definition) {
            if (! self::hasCuratedMetric($definition)) {
                continue;
            }

            $this->assertContains($entity, $covered, "No golden plan covers '{$entity}'");
        }
    }

    /** Same restriction as above, at metric granularity, over the merged layer. */
    public function test_the_fixture_covers_every_curated_metric(): void
    {
        $covered = $this->coveredMetrics();

        foreach (SemanticLayer::cached() as $entityKey => $entity) {
            foreach ($entity['metrics'] as $metricKey => $metric) {
                if (($metric['origin'] ?? null) !== 'curated') {
                    continue;
                }

                $this->assertContains(
                    "{$entityKey}.{$metricKey}",
                    $covered,
                    "No golden plan covers '{$entityKey}.{$metricKey}'"
                );
            }
        }
    }

    // ------------------------------------------------- the two live defects

    /**
     * DEFECT 1, 24 Aug 2026 — a REGRESSION, and the layer was never at fault.
     *
     * The model refused this question with "department is not a supported
     * group-by dimension for the payroll entity". `payroll.department` exists,
     * is curated, and joins `groups`; what failed was the prompt's legibility,
     * where payroll arrived as a single ~2,500 character run-on with
     * `department` buried three-quarters of the way along it.
     *
     * So this asserts both halves: the dimension is really there, and a plan
     * naming it really validates. If the second ever fails, the vocabulary
     * genuinely shrank; if only the prompt regresses, that is
     * SemanticLayerCatalogueTest's assertion to make, and it exists.
     */
    public function test_defect_one_average_net_pay_by_department_is_accepted(): void
    {
        $this->assertNotNull(
            SemanticLayer::dimension('payroll', 'department'),
            'payroll has no department dimension — the vocabulary itself has shrunk.'
        );

        $case = $this->case('accepted', 'compare average net pay by department');
        $plan = $this->validator->validate($case['plan']);

        $this->assertSame('payroll', $plan['entity']);
        $this->assertSame('aggregate', $plan['mode']);
        $this->assertSame(['avg_net_pay'], $plan['metrics']);
        $this->assertSame(['department'], $plan['group_by']);
    }

    /**
     * DEFECT 2, 24 Aug 2026 — the confident wrong number this whole design
     * exists to prevent. "list employees who joined this year" answered
     * `count: 0` where the true answer was 14.
     *
     * Three separate things had to hold and none did. Each is asserted here:
     *
     *  - the plan is a ROW LISTING, so there is no aggregate cell a zero could
     *    be written into at all — an empty result is `rows: []`, and "no
     *    records" and "zero" are different facts;
     *  - the date filter SURVIVES normalisation, in both the canonical §1 shape
     *    and the nested map of bounds the model actually emitted. A dropped
     *    filter asks a wider question and answers it with undiminished
     *    confidence;
     *  - a nested shape the validator cannot honour is refused NAMING THE
     *    FIELD. Honour it or refuse it; there is no third path, and the third
     *    path is the one that produced the zero.
     */
    public function test_defect_two_joining_this_year_can_never_yield_a_zero_row(): void
    {
        foreach ([
            'list employees who joined this year',
            'list employees who joined this year (the nested filter the model actually emitted)',
        ] as $question) {
            $case = $this->case('accepted', $question);
            $plan = $this->validator->validate($case['plan']);

            $this->assertSame('list', $plan['mode'], "{$question}: not a row listing.");
            $this->assertSame([], $plan['metrics'], "{$question}: a row listing computes nothing.");
            $this->assertSame([], $plan['group_by'], "{$question}: a row listing groups nothing.");

            $onJoiningDate = array_values(array_filter(
                $plan['filters'],
                fn (array $filter) => $filter['field'] === 'joining_date'
            ));

            $this->assertNotEmpty(
                $onJoiningDate,
                "{$question}: the joining_date filter was dropped. That is the zero."
            );
        }
    }

    /** The third path, refused rather than taken. */
    public function test_defect_two_a_filter_shape_that_cannot_be_honoured_is_refused_by_name(): void
    {
        $case = $this->caseByRule('unhonourable_filter_shape');
        $detail = $this->refusalFor($case['plan'], $case['question']);

        $this->assertStringContainsStringIgnoringCase('joining_date', $detail);
        $this->assertStringContainsStringIgnoringCase('around', $detail);
    }

    // ------------------------------------------------- the plans WE emit

    /**
     * THE TWO PERSON CASES PIN AN EMITTED PLAN, NOT A HAND-WRITTEN COPY OF ONE.
     *
     * Every other case in this fixture records a plan a MODEL would write, so
     * the only thing assertable with no vendor in the loop is how the validator
     * normalises it. The person cases are different in kind: nothing but
     * `QueryPlanner::personLookupPlan()` ever writes them, and until this test
     * existed the fixture held a TRANSCRIPTION of that plan which no code path
     * was ever compared against. Narrowing `PERSON_COLUMNS` to a single column,
     * or widening it past the published profile, left every assertion in this
     * file green — the exact opposite of what a fixture carrying that column
     * list is for, because that list is the boundary between "the profile this
     * layer publishes" and "the row in the database".
     *
     * So the raw plan is asserted verbatim, and only then normalised. Both
     * halves are needed: the fixture's `expect` proves the validator honours
     * the plan, and this proves the plan is the one that actually gets planned.
     */
    public function test_the_person_cases_pin_the_plan_the_planner_actually_emits(): void
    {
        $this->rosterOf('Kajal Sharma', 'Kajal Mehta', 'Ravi Kumar');

        // A person lookup is decided and built here, with no model in it, so a
        // request reaching the vendor would mean this test proved nothing about
        // the deterministic path. The fake is an assertion, not a convenience.
        Http::fake();

        foreach ([
            'give me all detail of kajal' => 'give me all detail of kajal',
            'kajel details' => 'kajel details (the name typed one character wrong)',
        ] as $question => $recorded) {
            $case = $this->case('accepted', $recorded);
            $emitted = app(QueryPlanner::class)->plan($question);

            $this->assertSame(
                $case['plan'],
                $emitted,
                "The fixture's plan for '{$recorded}' is no longer the plan QueryPlanner emits, "
                .'so the column list it records is a copy of nothing.'
            );

            $this->assertNormalisedPlanMatches($case['expect'], $this->validator->validate($emitted), $recorded);
        }

        Http::assertNothingSent();
    }

    // ----------------------------------------------------------------- helpers

    /**
     * A roster for the person cases, and the acting user their organization
     * scope resolves through.
     *
     * `PersonLookup` reads `EmployeeWorkInfo`, which carries
     * `BelongsToOrganization` — with nobody authenticated the scope is a no-op
     * and the lookup would read every tenant, which is the one thing it must
     * never do.
     */
    private function rosterOf(string ...$names): void
    {
        // QueryPlanner refuses every question on an unconfigured client before
        // it reaches the person path at all.
        config()->set('services.ai.secondary_base_url', 'https://openrouter.test/api/v1');
        config()->set('services.ai.secondary_api_key', 'test-key');
        config()->set('services.ai.secondary_models', 'stealth/ox-alpha');

        $organization = Organization::create(['name' => 'Golden Org', 'slug' => 'golden-plan-org']);

        Auth::setUser(User::create([
            'name' => 'Golden Admin',
            'email' => 'golden-admin@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]));

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Engineering',
            'slug' => 'golden-engineering',
        ]);

        foreach ($names as $index => $name) {
            $user = User::create([
                'name' => $name,
                'email' => 'golden-person-'.$index.'@org.test',
                'password' => Hash::make('password123'),
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);

            EmployeeWorkInfo::create([
                'organization_id' => $organization->id,
                'user_id' => $user->id,
                'employee_code' => 'GOLD-'.$index,
                'report_group_id' => $group->id,
                'designation' => 'Software Engineer',
                'work_location' => 'Pune',
                'employment_type' => 'full_time',
                'employment_status' => 'active',
                'joining_date' => '2025-04-01',
            ]);
        }
    }

    /**
     * @param  array<string, mixed>  $expect
     * @param  array<string, mixed>  $plan
     */
    private function assertNormalisedPlanMatches(array $expect, array $plan, string $question): void
    {
        foreach (['entity', 'mode', 'metrics', 'columns', 'group_by', 'limit', 'sort'] as $key) {
            if (array_key_exists($key, $expect)) {
                $this->assertSame($expect[$key], $plan[$key], "{$question}: {$key}");
            }
        }

        if (array_key_exists('filters', $expect)) {
            $this->assertCount(
                count($expect['filters']),
                $plan['filters'],
                "{$question}: the plan carries a different number of filters than the fixture pins. "
                .'A filter that vanished here is a question nobody asked being answered.'
            );

            foreach ($expect['filters'] as $index => $expected) {
                $this->assertFilterMatches($expected, $plan['filters'][$index], "{$question}: filter {$index}");
            }
        }

        if (array_key_exists('having', $expect)) {
            $this->assertCount(count($expect['having']), $plan['having'], "{$question}: having");

            foreach ($expect['having'] as $index => $expected) {
                foreach ($expected as $key => $value) {
                    $this->assertSame(
                        $value,
                        $plan['having'][$index][$key] ?? null,
                        "{$question}: having {$index} {$key}"
                    );
                }
            }
        }
    }

    /**
     * @param  array<string, mixed>  $expected
     * @param  array<string, mixed>  $actual
     */
    private function assertFilterMatches(array $expected, array $actual, string $label): void
    {
        foreach ($expected as $key => $value) {
            $this->assertSame($value, $actual[$key] ?? null, "{$label}: {$key}");
        }

        if (($expected['op'] ?? null) !== 'period') {
            return;
        }

        /*
         * §3: the token is resolved SERVER-SIDE, here, once. A filter that
         * reached the executor still holding the words would be parsed a
         * second time by something that is not PeriodResolver, and two
         * parsers is two answers.
         */
        $this->assertIsArray($actual['value'], "{$label}: an unresolved period token reached the plan.");
        $this->assertArrayHasKey('start', $actual['value'], "{$label}: period start");
        $this->assertArrayHasKey('end', $actual['value'], "{$label}: period end");
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $actual['value']['start'], "{$label}: start");
        $this->assertMatchesRegularExpression('/^\d{4}-\d{2}-\d{2}$/', $actual['value']['end'], "{$label}: end");
    }

    /** @param array<string, mixed> $plan */
    private function refusalFor(array $plan, string $question): string
    {
        try {
            $this->validator->validate($plan);
        } catch (UnsupportedQuestionException $e) {
            return $e->getDetail();
        }

        $this->fail("'{$question}' should have been refused but validated.");
    }

    /**
     * Every metric a golden plan computes, as `entity.metric`. Reads both the
     * v2 `metrics` list and the v1 singular `metric`, because the fixture
     * deliberately carries both shapes — the validator still normalises them
     * and a fixture that could only say one would stop testing the other.
     *
     * @return list<string>
     */
    private function coveredMetrics(): array
    {
        $covered = [];

        foreach ($this->golden['accepted'] as $case) {
            foreach ($this->listOf($case['plan'], 'metrics', 'metric') as $metric) {
                $covered[] = $case['plan']['entity'].'.'.$metric;
            }
        }

        return array_values(array_unique($covered));
    }

    /** @return list<string> */
    private function coveredDimensions(): array
    {
        $covered = [];

        foreach ($this->golden['accepted'] as $case) {
            foreach ($this->listOf($case['plan'], 'group_by') as $dimension) {
                $covered[] = $case['plan']['entity'].'.'.$dimension;
            }
        }

        return array_values(array_unique($covered));
    }

    /**
     * Every field name a plan mentions anywhere — metrics, columns, group_by
     * and the field of each filter, in any of the shapes the fixture uses.
     *
     * @param  array<string, mixed>  $plan
     * @return list<string>
     */
    private function namesUsedBy(array $plan): array
    {
        $names = array_merge(
            $this->listOf($plan, 'metrics', 'metric'),
            $this->listOf($plan, 'columns'),
            $this->listOf($plan, 'group_by'),
        );

        foreach ((array) ($plan['filters'] ?? []) as $key => $filter) {
            if (is_string($key)) {
                $names[] = $key;
            }

            if (is_array($filter) && is_string($filter['field'] ?? null)) {
                $names[] = $filter['field'];
            }
        }

        return array_values(array_unique($names));
    }

    /**
     * One plan key as a list, whichever of its names it was written under.
     *
     * @param  array<string, mixed>  $plan
     * @return list<string>
     */
    private function listOf(array $plan, string ...$keys): array
    {
        foreach ($keys as $key) {
            if (! array_key_exists($key, $plan)) {
                continue;
            }

            $value = $plan[$key];

            if (is_string($value)) {
                return [$value];
            }

            if (is_array($value)) {
                return array_values(array_filter($value, 'is_string'));
            }
        }

        return [];
    }

    /**
     * A named case, by the question it records. Looking a case up by name is
     * what makes the two defect tests below un-deletable: remove the fixture
     * entry and the test fails saying which question went missing, rather than
     * passing over an empty loop.
     *
     * @return array<string, mixed>
     */
    private function case(string $half, string $question): array
    {
        foreach ($this->golden[$half] as $case) {
            if ($case['question'] === $question) {
                return $case;
            }
        }

        $this->fail("The golden fixture no longer carries the {$half} case '{$question}'.");
    }

    /** @return array<string, mixed> */
    private function caseByRule(string $rule): array
    {
        foreach ($this->golden['refused'] as $case) {
            if (($case['rule'] ?? null) === $rule) {
                return $case;
            }
        }

        $this->fail("The golden fixture no longer carries a refused case for the rule '{$rule}'.");
    }

    /** @param array<string, mixed> $entity */
    private static function hasCuratedMetric(array $entity): bool
    {
        foreach ($entity['metrics'] as $metric) {
            if (($metric['origin'] ?? null) === 'curated') {
                return true;
            }
        }

        return false;
    }
}
