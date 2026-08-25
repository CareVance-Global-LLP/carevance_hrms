<?php

namespace Tests\Feature\Ai;

use App\Services\Ai\PeriodResolver;
use App\Services\Ai\PlanValidator;
use App\Services\Ai\QueryPlanner;
use App\Services\Ai\SemanticLayer;
use App\Services\Ai\UnsupportedQuestionException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * The vendor is faked here on purpose: this asserts our parsing and prompt
 * contract, not OpenRouter's uptime.
 *
 * RefreshDatabase: the system prompt is built from the semantic layer, which
 * derives from the real schema.
 *
 * Every question in this file has to be one RETRIEVAL accepts, because
 * retrieval now runs before the model does — a question that matches no entity
 * is refused locally and never reaches the fake. Three of them were changed for
 * that reason and their assertions are untouched; see the comments at each.
 */
class QueryPlannerTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.ai.secondary_base_url', 'https://openrouter.test/api/v1');
        config()->set('services.ai.secondary_api_key', 'test-key');
        config()->set('services.ai.secondary_models', 'stealth/ox-alpha');
    }

    private function fakeReply(string $content): void
    {
        Http::fake([
            'openrouter.test/*' => Http::response([
                'choices' => [['message' => ['content' => $content]]],
            ], 200),
        ]);
    }

    public function test_it_parses_a_raw_json_plan(): void
    {
        $this->fakeReply('{"entity":"payroll","metric":"avg_net_pay","group_by":"department","limit":10}');

        $plan = app(QueryPlanner::class)->plan('compare average net pay by department');

        $this->assertSame('payroll', $plan['entity']);
        $this->assertSame('avg_net_pay', $plan['metric']);
    }

    public function test_it_recovers_a_plan_wrapped_in_a_markdown_fence(): void
    {
        // ox-alpha advertises response_format: json_schema but does not honour
        // it — a strict run came back fenced. The fallback extractor is not
        // optional.
        $this->fakeReply("Here you go:\n```json\n{\"entity\":\"employees\",\"metric\":\"headcount\"}\n```");

        $plan = app(QueryPlanner::class)->plan('headcount');

        $this->assertSame('employees', $plan['entity']);
    }

    /**
     * Was asked with "weather in Mumbai", which retrieval now refuses locally
     * before any model call — a better outcome, and one that cannot exercise
     * the passthrough this test is about. "headcount by nationality" reaches
     * the model (headcount names an entity) and is refused BY it, which is the
     * path being asserted. The assertion itself is unchanged.
     */
    public function test_it_passes_the_error_shape_straight_through(): void
    {
        $this->fakeReply('{"error":"Nationality is not stored in this system."}');

        $plan = app(QueryPlanner::class)->plan('headcount by nationality');

        $this->assertSame('Nationality is not stored in this system.', $plan['error']);
    }

    public function test_it_pins_reasoning_effort_and_zero_temperature(): void
    {
        // Unpinned, ox-alpha reasons at max by default: 6.6s instead of ~3s.
        $this->fakeReply('{"entity":"employees","metric":"headcount"}');

        app(QueryPlanner::class)->plan('headcount');

        Http::assertSent(function ($request) {
            $body = $request->data();
            return $body['reasoning']['effort'] === 'low'
                && $body['temperature'] === 0
                && $body['model'] === 'stealth/ox-alpha';
        });
    }

    public function test_the_prompt_carries_todays_date(): void
    {
        // Without it the model resolved "this year" to 2025.
        $this->fakeReply('{"entity":"employees","metric":"headcount"}');

        app(QueryPlanner::class)->plan('who joined this year');

        Http::assertSent(function ($request) {
            return str_contains($request->data()['messages'][0]['content'], now()->toDateString());
        });
    }

    public function test_the_prompt_never_contains_employee_data(): void
    {
        $this->fakeReply('{"entity":"employees","metric":"headcount"}');

        app(QueryPlanner::class)->plan('average net pay by department');

        Http::assertSent(function ($request) {
            $sent = json_encode($request->data());
            // Only names and labels travel — the catalogue, never rows.
            return ! str_contains($sent, 'net_pay_value') && str_contains($sent, 'avg_net_pay');
        });
    }

    /**
     * Was asked with "something vague", which now matches no entity and is
     * refused before the fake reply is ever read — so it would have passed
     * while proving nothing about the parser. The question is one retrieval
     * accepts; the assertion is unchanged.
     */
    public function test_unparseable_output_is_a_refusal_not_a_guess(): void
    {
        $this->fakeReply('I think you probably want the payroll screen.');

        $this->expectException(UnsupportedQuestionException::class);

        app(QueryPlanner::class)->plan('average net pay');
    }

    /**
     * DEFECT 1, at the layer that actually failed.
     *
     * The prompt used to carry all 149 entities — roughly 48,000 characters,
     * ~12,000 tokens — and `payroll`'s share of it was one ~2,500 character
     * run-on. The model reported that `payroll` had no `department` dimension
     * and refused "compare average net pay by department", a query that had
     * answered Engineering 91,575.93 / Marketing 61,584.00 hours earlier.
     *
     * So the prompt now carries what retrieval picked, and this asserts both
     * halves: the entities the question is about are IN it, and the ones it is
     * not about are OUT.
     */
    public function test_the_prompt_carries_the_retrieved_entities_and_not_the_schema(): void
    {
        $this->fakeReply('{"entity":"payroll","metric":"avg_net_pay","group_by":"department"}');

        app(QueryPlanner::class)->plan('compare average net pay by department');

        Http::assertSent(function ($request) {
            $prompt = $request->data()['messages'][0]['content'];

            $this->assertStringContainsString('avg_net_pay', $prompt);
            $this->assertStringContainsString('department', $prompt);

            // Entities the question is not about, each named by a metric only
            // that entity has.
            foreach (['asset_count', 'late_count', 'leave_days_taken'] as $unrelated) {
                $this->assertStringNotContainsString($unrelated, $prompt, 'the whole catalogue is still being sent');
            }

            return true;
        });
    }

    /**
     * The budget §13 exists to hold, asserted where it is actually spent. In
     * characters rather than tokens so it does not depend on a tokeniser.
     *
     * Over a SPREAD of questions, not one: retrieval picks five entities per
     * question and they are not the same five, so a budget proven on the
     * cheapest question is proven about nothing. Payroll is the expensive one
     * — 95 dimensions, 1,700-odd metrics behind them — and it is deliberately
     * first.
     *
     * Measured 24 Aug 2026: the worst of these is 7,765 characters, of which
     * 4,780 is the catalogue and 2,985 the grammar around it. The whole schema
     * was ~48,000. If this ever trips, the saving is in `catalogueFor()` — the
     * grammar, the operators, the period tokens and the worked examples are
     * each here because leaving one out costs a class of question.
     */
    public function test_the_prompt_stays_a_retrieved_handful_not_the_whole_schema(): void
    {
        foreach ([
            'compare average net pay by department',
            'top 5 departments by total gross in July 2026',
            'who was absent more than 3 days last month',
            'list employees who joined this year',
            'leave taken by type this year',
        ] as $question) {
            $length = strlen($this->promptFor($question));

            $this->assertLessThan(8000, $length, "the planner prompt for '{$question}' is {$length} characters");
        }
    }

    /**
     * §13: "If retrieval returns nothing above a floor score, the question is
     * refused — with the entities it DID consider, so the user can rephrase."
     *
     * Refused LOCALLY, before the model is called at all: there is nothing for
     * a planner to plan against, and sending a catalogue of everything is how
     * this defect started.
     */
    public function test_a_question_matching_no_entity_is_refused_before_any_model_call(): void
    {
        $this->fakeReply('{"entity":"employees","metric":"headcount"}');

        try {
            app(QueryPlanner::class)->plan('what is the airspeed velocity of an unladen swallow');
            $this->fail('an unmatchable question was not refused');
        } catch (UnsupportedQuestionException $e) {
            $detail = $e->getDetail();
        }

        Http::assertNothingSent();

        $this->assertStringContainsString('I looked at: ', $detail);

        $considered = array_filter(array_map(
            fn (string $name) => trim($name, " .\t\n"),
            explode(',', Str::after($detail, 'I looked at: '))
        ));

        $this->assertGreaterThanOrEqual(3, count($considered), 'the refusal named nothing to rephrase against');

        foreach ($considered as $key) {
            $this->assertNotNull(
                SemanticLayer::entity($key),
                "the refusal offered '{$key}', which is not an entity anybody can ask about"
            );
        }
    }

    public function test_no_configured_provider_refuses_clearly(): void
    {
        config()->set('services.ai.secondary_api_key', null);
        config()->set('services.ai.api_key', null);

        $this->expectException(UnsupportedQuestionException::class);

        app(QueryPlanner::class)->plan('headcount');
    }

    // ------------------------------------------------------------ the grammar

    /**
     * DEFECT 2, at the layer that actually caused it.
     *
     * "list employees who joined this year" answered `count: 0` against a true
     * answer of 14, and the prompt is where that started. The v1 shape it
     * documented had no `mode` and no `columns`, so the only plan the model
     * could write for a question that asks WHO was an aggregate — and it wrote
     * one. `PlanValidator` can read a v2 plan now; until the prompt describes
     * one, nothing ever sends it one.
     */
    public function test_the_prompt_teaches_the_v2_plan_shape(): void
    {
        $prompt = $this->promptFor('compare average net pay by department');

        foreach (['"entity"', '"mode"', '"metrics"', '"columns"', '"group_by"', '"filters"', '"having"', '"sort"', '"limit"'] as $key) {
            $this->assertStringContainsString($key, $prompt, "the prompt never mentions {$key}");
        }

        $this->assertStringContainsString('aggregate', $prompt);
        $this->assertStringContainsString('list', $prompt);
    }

    /**
     * §2, in full. A model that has not been told an operator exists does not
     * use it, and every operator missing from this list is a question the
     * grammar can express and the planner cannot reach.
     */
    public function test_the_prompt_carries_the_whole_operator_table(): void
    {
        $prompt = $this->promptFor('compare average net pay by department');

        foreach ([
            'eq', 'neq', 'gt', 'gte', 'lt', 'lte',
            'between', 'contains', 'in', 'not_in',
            'is_null', 'is_not_null', 'period',
        ] as $operator) {
            $this->assertMatchesRegularExpression(
                '/\b'.preg_quote($operator, '/').'\b/',
                $prompt,
                "the operator '{$operator}' is not offered to the planner"
            );
        }
    }

    /**
     * §3. The model emits a TOKEN and the server resolves it; a model left to
     * write its own bounds writes them against its training cutoff, which is
     * how "this year" became 2025. So every token has to be nameable, and the
     * prompt has to say the resolution is not the model's job.
     */
    public function test_the_prompt_carries_every_period_token(): void
    {
        $prompt = $this->promptFor('compare average net pay by department');

        foreach ([
            'today', 'yesterday',
            'this_week', 'last_week',
            'this_month', 'last_month',
            'this_quarter', 'last_quarter',
            'this_year', 'last_year',
            'last_7_days', 'last_30_days', 'last_90_days', 'last_12_months',
        ] as $token) {
            $this->assertStringContainsString($token, $prompt, "the period token '{$token}' is not offered to the planner");
        }

        // The explicit forms §3 also accepts, so a question naming a real month
        // does not have to be squeezed into a relative token.
        $this->assertStringContainsString('2026-07-01..2026-07-31', $prompt);
    }

    /**
     * The examples are the part of a prompt a model actually copies, so a
     * wrong one is worse than none: it teaches a shape that gets refused, in a
     * voice the model trusts more than the prose above it.
     *
     * `PlanValidator` is the judge, because it is the thing that will judge
     * the real output. An example that does not validate is a bug shipped in a
     * string literal.
     */
    public function test_every_worked_example_in_the_prompt_is_a_plan_the_validator_accepts(): void
    {
        $examples = $this->workedExamples($this->promptFor('compare average net pay by department'));

        $this->assertGreaterThanOrEqual(3, count($examples), 'the prompt shows too few worked examples to teach a shape');

        $validator = new PlanValidator();

        foreach ($examples as $example) {
            try {
                $validator->validate($example);
            } catch (UnsupportedQuestionException $e) {
                $this->fail('a worked example in the planner prompt is refused by the validator: '
                    .json_encode($example).' — '.$e->getDetail());
            }
        }
    }

    /**
     * The two shapes v1 could not express at all, named by the task because
     * each one is a whole class of question:
     *
     *  - `having` is "more than 3 days" — a threshold on a computed number,
     *    the user's own first example and the thing v1 could not say.
     *  - `mode: list` is "who" — the shape whose absence answered a listing
     *    question with a count of zero.
     */
    public function test_the_worked_examples_include_a_having_and_a_list_mode(): void
    {
        $examples = $this->workedExamples($this->promptFor('compare average net pay by department'));

        $withHaving = array_values(array_filter($examples, fn (array $p) => ! empty($p['having'])));
        $this->assertNotEmpty($withHaving, 'no worked example shows a having, so "more than 3 days" stays unsayable');

        $having = $withHaving[0]['having'][0];
        $this->assertArrayHasKey('metric', $having);
        $this->assertArrayHasKey('op', $having);
        $this->assertArrayHasKey('value', $having);
        $this->assertContains(
            $having['metric'],
            (array) ($withHaving[0]['metrics'] ?? []),
            'the having example names a metric its own plan does not compute'
        );

        $lists = array_values(array_filter($examples, fn (array $p) => ($p['mode'] ?? null) === 'list'));
        $this->assertNotEmpty($lists, 'no worked example shows list mode, which is what answered a listing question with a count');
        $this->assertNotEmpty($lists[0]['columns'] ?? [], 'the list example shows no columns');
        $this->assertArrayNotHasKey('group_by', $lists[0]);
    }

    /**
     * DEFECT 2's other half. The model emitted
     * `{"joining_date":{"gte":"2026-01-01","lte":"2026-12-31"}}` because
     * nothing told it what a filter looks like — and it wrote its own dates
     * because nothing told it not to. Both are prompt failures, and both are
     * fixed by showing the descriptor with a period token in it.
     */
    public function test_the_worked_examples_filter_a_date_with_a_period_token_not_a_hand_written_range(): void
    {
        $examples = $this->workedExamples($this->promptFor('compare average net pay by department'));

        $periodFilters = [];

        foreach ($examples as $example) {
            foreach ($example['filters'] ?? [] as $filter) {
                $this->assertSame(
                    ['field', 'op', 'value'],
                    array_keys($filter),
                    'a worked filter is not the {field, op, value} descriptor: '.json_encode($filter)
                );

                if ($filter['op'] === 'period') {
                    $periodFilters[] = $filter;
                }
            }
        }

        $this->assertNotEmpty($periodFilters, 'no worked example filters by a period token');

        foreach ($periodFilters as $filter) {
            $this->assertNotNull(
                PeriodResolver::resolve((string) $filter['value']),
                "the example period '{$filter['value']}' is not a token the server can resolve"
            );
        }
    }

    /** §1's refusal shape, shown rather than only described. */
    public function test_the_prompt_shows_the_refusal_shape(): void
    {
        $prompt = $this->promptFor('compare average net pay by department');

        $refusals = array_values(array_filter(
            $this->promptPlans($prompt),
            fn (array $p) => array_key_exists('error', $p)
        ));

        $this->assertNotEmpty($refusals, 'the prompt never shows what a refusal looks like');
        $this->assertIsString($refusals[0]['error']);
    }

    /**
     * The examples name `attendance.absent_days` and `employees.joining_date`,
     * and the catalogue sent with a payroll question names neither. Without
     * this sentence the prompt contradicts itself — "never invent a name" over
     * four examples full of names that are not on the list — and a model
     * resolving that contradiction the other way starts quoting the examples
     * as though they were the catalogue.
     */
    public function test_the_prompt_says_the_examples_are_shape_not_vocabulary(): void
    {
        $intro = Str::before($this->promptFor('compare average net pay by department'), 'Q: ');

        $this->assertMatchesRegularExpression(
            '/shape[^\n]*catalogue|catalogue[^\n]*shape/i',
            $intro,
            'nothing tells the planner the examples are a shape rather than a vocabulary'
        );
    }

    /**
     * A v2 plan is several times the size of a v1 one — four metrics, two
     * group_by, a filter list, a having and a sort. Truncated mid-object it is
     * unparseable, and unparseable is a refusal: the question then fails for
     * want of output budget rather than for anything about the question.
     */
    public function test_the_request_leaves_room_for_a_whole_v2_plan(): void
    {
        $this->fakeReply('{"entity":"employees","metrics":["headcount"]}');

        app(QueryPlanner::class)->plan('headcount');

        Http::assertSent(function ($request) {
            $this->assertGreaterThanOrEqual(1200, $request->data()['max_tokens']);

            return true;
        });
    }

    /**
     * The planner parses; it does not normalise. Everything §1 allows has to
     * survive to `PlanValidator`, which is the one place a plan is judged — a
     * second, quieter normalisation here is how two components come to
     * disagree about what a plan said.
     */
    public function test_it_parses_a_full_v2_plan_without_flattening_it(): void
    {
        $this->fakeReply(json_encode([
            'entity' => 'attendance',
            'metrics' => ['absent_days'],
            'group_by' => ['employee'],
            'filters' => [['field' => 'date', 'op' => 'period', 'value' => 'last_month']],
            'having' => [['metric' => 'absent_days', 'op' => 'gt', 'value' => 3]],
            'sort' => ['by' => 'absent_days', 'dir' => 'desc'],
            'limit' => 20,
        ]));

        $plan = app(QueryPlanner::class)->plan('who was absent more than 3 days last month');

        $this->assertSame(['absent_days'], $plan['metrics']);
        $this->assertSame(['employee'], $plan['group_by']);
        $this->assertSame('period', $plan['filters'][0]['op']);
        $this->assertSame('last_month', $plan['filters'][0]['value']);
        $this->assertSame(3, $plan['having'][0]['value']);
        $this->assertSame(['by' => 'absent_days', 'dir' => 'desc'], $plan['sort']);
    }

    // ------------------------------------------------------------------ tools

    /** The system prompt for a question, captured off the faked request. */
    private function promptFor(string $question): string
    {
        $this->fakeReply('{"entity":"employees","metrics":["headcount"]}');

        app(QueryPlanner::class)->plan($question);

        $prompt = '';

        Http::assertSent(function ($request) use (&$prompt) {
            $prompt = $request->data()['messages'][0]['content'];

            return true;
        });

        $this->assertNotSame('', $prompt);

        return $prompt;
    }

    /**
     * Every JSON object the prompt shows as an answer.
     *
     * Marked with `A:` rather than sniffed for a leading brace, so the pseudo
     * shape line — which is deliberately not valid JSON — is never mistaken
     * for an example, and so a MALFORMED example fails here rather than being
     * quietly skipped by a parser that could not read it.
     *
     * @return list<array<string, mixed>>
     */
    private function promptPlans(string $prompt): array
    {
        $plans = [];

        foreach (preg_split('/\R/', $prompt) ?: [] as $line) {
            $line = trim($line);

            if (! str_starts_with($line, 'A: ')) {
                continue;
            }

            $decoded = json_decode(substr($line, 3), true);

            $this->assertIsArray($decoded, "a worked example in the prompt is not valid JSON: {$line}");

            $plans[] = $decoded;
        }

        return $plans;
    }

    /**
     * The worked PLANS — the refusal example is an answer too, and it is not a
     * plan.
     *
     * @return list<array<string, mixed>>
     */
    private function workedExamples(string $prompt): array
    {
        return array_values(array_filter(
            $this->promptPlans($prompt),
            fn (array $plan) => ! array_key_exists('error', $plan)
        ));
    }
}
