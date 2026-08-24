<?php

namespace Tests\Feature\Ai;

use App\Services\Ai\QueryPlanner;
use App\Services\Ai\UnsupportedQuestionException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The vendor is faked here on purpose: this asserts our parsing and prompt
 * contract, not OpenRouter's uptime.
 *
 * RefreshDatabase: the system prompt is built from SemanticLayer::promptCatalogue(),
 * which now derives from the real schema.
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

    public function test_it_passes_the_error_shape_straight_through(): void
    {
        $this->fakeReply('{"error":"Weather is not HR data"}');

        $plan = app(QueryPlanner::class)->plan('weather in Mumbai');

        $this->assertSame('Weather is not HR data', $plan['error']);
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

        app(QueryPlanner::class)->plan('headcount by department');

        Http::assertSent(function ($request) {
            $sent = json_encode($request->data());
            // Only names and labels travel — the catalogue, never rows.
            return ! str_contains($sent, 'net_pay_value') && str_contains($sent, 'avg_net_pay');
        });
    }

    public function test_unparseable_output_is_a_refusal_not_a_guess(): void
    {
        $this->fakeReply('I think you probably want the payroll screen.');

        $this->expectException(UnsupportedQuestionException::class);

        app(QueryPlanner::class)->plan('something vague');
    }

    public function test_no_configured_provider_refuses_clearly(): void
    {
        config()->set('services.ai.secondary_api_key', null);
        config()->set('services.ai.api_key', null);

        $this->expectException(UnsupportedQuestionException::class);

        app(QueryPlanner::class)->plan('headcount');
    }
}
