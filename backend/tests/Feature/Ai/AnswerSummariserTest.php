<?php

namespace Tests\Feature\Ai;

use App\Services\Ai\AnswerSummariser;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * This is the ONLY step that sees real employee data, so it runs on the paid
 * primary provider — never the cloaked stealth model. A failure here must cost
 * the sentence, never the table.
 */
class AnswerSummariserTest extends TestCase
{
    private array $columns = [
        ['key' => 'department', 'label' => 'Department', 'type' => 'text'],
        ['key' => 'avg_net_pay', 'label' => 'Avg net pay', 'type' => 'money'],
    ];

    private array $rows = [['department' => 'Engineering', 'avg_net_pay' => '91575.93']];

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('services.ai.base_url', 'https://gemini.test/v1');
        config()->set('services.ai.api_key', 'primary-key');
        config()->set('services.ai.model', 'gemini-flash-latest');
        config()->set('services.ai.secondary_api_key', 'secondary-key');
        config()->set('services.ai.secondary_base_url', 'https://openrouter.test/api/v1');
    }

    public function test_it_returns_the_sentence(): void
    {
        Http::fake(['gemini.test/*' => Http::response([
            'choices' => [['message' => ['content' => 'Engineering averages ₹91,575.93.']]],
        ], 200)]);

        $summary = app(AnswerSummariser::class)->summarise('compare net pay', $this->columns, $this->rows);

        $this->assertSame('Engineering averages ₹91,575.93.', $summary);
    }

    public function test_rows_go_to_the_primary_provider_never_the_stealth_model(): void
    {
        Http::fake([
            'gemini.test/*' => Http::response(['choices' => [['message' => ['content' => 'ok']]]], 200),
            'openrouter.test/*' => Http::response(['choices' => [['message' => ['content' => 'leaked']]]], 200),
        ]);

        app(AnswerSummariser::class)->summarise('compare net pay', $this->columns, $this->rows);

        Http::assertNotSent(fn ($request) => str_contains($request->url(), 'openrouter.test'));
    }

    public function test_it_asks_for_rupees_explicitly(): void
    {
        // Gemini formatted the same figure as "$84,200" without being told.
        Http::fake(['gemini.test/*' => Http::response(['choices' => [['message' => ['content' => 'ok']]]], 200)]);

        app(AnswerSummariser::class)->summarise('compare net pay', $this->columns, $this->rows);

        Http::assertSent(fn ($request) => str_contains($request->data()['messages'][0]['content'], '₹'));
    }

    public function test_it_leaves_room_for_thinking_tokens(): void
    {
        // gemini-flash-latest is a thinking model: at max_tokens 120 it returned
        // HTTP 200, finish_reason "length", and EMPTY content.
        Http::fake(['gemini.test/*' => Http::response(['choices' => [['message' => ['content' => 'ok']]]], 200)]);

        app(AnswerSummariser::class)->summarise('compare net pay', $this->columns, $this->rows);

        Http::assertSent(fn ($request) => $request->data()['max_tokens'] >= 400);
    }

    public function test_an_empty_reply_becomes_null_not_an_empty_string(): void
    {
        Http::fake(['gemini.test/*' => Http::response([
            'choices' => [['message' => ['role' => 'assistant']]],
        ], 200)]);

        $this->assertNull(app(AnswerSummariser::class)->summarise('q', $this->columns, $this->rows));
    }

    public function test_a_provider_failure_returns_null_rather_than_throwing(): void
    {
        Http::fake(['gemini.test/*' => Http::response('upstream exploded', 500)]);

        $this->assertNull(app(AnswerSummariser::class)->summarise('q', $this->columns, $this->rows));
    }

    public function test_no_rows_means_no_summary_request_at_all(): void
    {
        Http::fake(['gemini.test/*' => Http::response(['choices' => [['message' => ['content' => 'x']]]], 200)]);

        $this->assertNull(app(AnswerSummariser::class)->summarise('q', $this->columns, []));
        Http::assertNothingSent();
    }
}
