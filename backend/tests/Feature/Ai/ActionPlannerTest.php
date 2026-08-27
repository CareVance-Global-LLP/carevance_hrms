<?php

namespace Tests\Feature\Ai;

use App\Services\Ai\Actions\ActionCatalogue;
use App\Services\Ai\Actions\ActionPlanner;
use App\Services\Ai\UnsupportedQuestionException;
use Illuminate\Support\Facades\Http;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * The planner is the ONE place a sentence becomes an intention to change
 * something, and everything downstream trusts its output no further than a
 * string.
 *
 * The vendor is faked here on purpose: this asserts our prompt contract and our
 * parsing, not OpenRouter's uptime. Two properties are worth more than the
 * rest:
 *
 *  - **The prompt carries the catalogue and nothing else.** §3 is explicit that
 *    the model "cannot name an endpoint, a table, a column or a model". It
 *    cannot name what it was never shown, so the endpoint and the model class
 *    are checked to be ABSENT — the catalogue's own entries carry both, and
 *    rendering an entry wholesale is the obvious mistake to make.
 *  - **Unparseable output is a refusal.** A planner that guesses an action key
 *    is a planner that writes to a row nobody asked about.
 *
 * @see docs/superpowers/specs/2026-08-26-ai-write-actions.md §2, §3
 */
class ActionPlannerTest extends TestCase
{
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

    /** The system prompt actually put on the wire. */
    private function systemPrompt(): string
    {
        $prompt = '';

        Http::assertSent(function ($request) use (&$prompt) {
            $prompt = $request->data()['messages'][0]['content'];

            return true;
        });

        return $prompt;
    }

    public function test_it_parses_a_raw_json_action_plan(): void
    {
        $this->fakeReply('{"action":"leave_type.update","target":{"name":"Casual Leave"},"changes":{"carry_forward_cap":10}}');

        $plan = app(ActionPlanner::class)->plan('change the casual leave carry-forward to 10 days');

        $this->assertSame('leave_type.update', $plan['action']);
        $this->assertSame(['name' => 'Casual Leave'], $plan['target']);
        $this->assertSame(['carry_forward_cap' => 10], $plan['changes']);
    }

    /**
     * ox-alpha advertises `response_format: json_schema` and does not honour
     * it — a strict run came back fenced. The fallback extractor is not
     * optional here for the same reason it is not optional on the read path.
     */
    public function test_it_recovers_a_plan_wrapped_in_a_markdown_fence(): void
    {
        $this->fakeReply("Sure:\n```json\n{\"action\":\"department.rename\",\"target\":{\"name\":\"HR\"},\"changes\":{\"name\":\"Human Resources\"}}\n```");

        $plan = app(ActionPlanner::class)->plan('rename the HR department to Human Resources');

        $this->assertSame('department.rename', $plan['action']);
    }

    /**
     * The model's own refusal travels intact, exactly as the read path carries
     * `{"error": …}` through to its validator. The sentence is the actionable
     * half — "I can't change that" with nothing after it is a dead end.
     */
    public function test_it_passes_the_models_refusal_straight_through(): void
    {
        $this->fakeReply('{"error":"There is no action for deleting an employee."}');

        $plan = app(ActionPlanner::class)->plan('delete the employee Priya Sharma');

        $this->assertSame('There is no action for deleting an employee.', $plan['error']);
    }

    public function test_it_pins_reasoning_effort_and_zero_temperature(): void
    {
        // Unpinned, ox-alpha reasons at max by default: 6.6s instead of ~3s.
        $this->fakeReply('{"action":"department.rename","target":{"name":"HR"},"changes":{"name":"People"}}');

        app(ActionPlanner::class)->plan('rename HR to People');

        Http::assertSent(function ($request) {
            $body = $request->data();

            return $body['reasoning']['effort'] === 'low'
                && $body['temperature'] === 0
                && $body['model'] === 'stealth/ox-alpha';
        });
    }

    /**
     * Without it the model resolves anything relative against its training
     * cutoff. Nothing in the first-pass catalogue takes a date, but the prompt
     * is what a fourth entry inherits, and a date-free prompt is the kind of
     * omission nobody notices until a stored value is a year out.
     */
    public function test_the_prompt_carries_todays_date(): void
    {
        $this->fakeReply('{"action":"department.rename","target":{"name":"HR"},"changes":{"name":"People"}}');

        app(ActionPlanner::class)->plan('rename HR to People');

        $this->assertStringContainsString(now()->toDateString(), $this->systemPrompt());
    }

    /**
     * Every action, by name, with every field and its bounds.
     *
     * Pinned against the catalogue itself rather than against a copy written
     * here, because the failure worth catching is a FOURTH action being added
     * and the prompt still describing three. A model cannot pick a key it was
     * never shown, and the symptom is a refusal for something the system does
     * support — indistinguishable, from the outside, from a missing feature.
     */
    public function test_the_prompt_lists_every_action_with_its_fields_and_bounds(): void
    {
        $this->fakeReply('{"action":"department.rename","target":{"name":"HR"},"changes":{"name":"People"}}');

        app(ActionPlanner::class)->plan('rename HR to People');

        $prompt = $this->systemPrompt();

        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertStringContainsString($key, $prompt, "the prompt never names {$key}");
            $this->assertStringContainsString($entry['label'], $prompt, "the prompt never labels {$key}");

            foreach ($entry['fields'] as $field => $spec) {
                $this->assertStringContainsString($field, $prompt, "the prompt never names {$key}.{$field}");

                if (isset($spec['min'], $spec['max'])) {
                    $this->assertStringContainsString(
                        (string) $spec['max'],
                        $prompt,
                        "the prompt never states {$key}.{$field}'s upper bound",
                    );
                }

                if (isset($spec['max_length'])) {
                    $this->assertStringContainsString(
                        (string) $spec['max_length'],
                        $prompt,
                        "the prompt never states {$key}.{$field}'s length limit",
                    );
                }
            }
        }
    }

    /**
     * §3: the model "cannot name an endpoint, a table, a column or a model".
     *
     * It cannot name what it was never shown. Rendering a catalogue entry
     * wholesale would hand it the route and the Eloquent class, and from there
     * a plan naming a different route is one token away — which the executor
     * would then have to refuse, rather than the plan being unthinkable.
     */
    public function test_the_prompt_shows_no_endpoint_and_no_model_class(): void
    {
        $this->fakeReply('{"action":"department.rename","target":{"name":"HR"},"changes":{"name":"People"}}');

        app(ActionPlanner::class)->plan('rename HR to People');

        $prompt = $this->systemPrompt();

        $this->assertStringNotContainsString('/api/', $prompt, 'the prompt hands the model a route');
        $this->assertStringNotContainsString('App\\Models', $prompt, 'the prompt hands the model an Eloquent class');

        foreach (ActionCatalogue::all() as $key => $entry) {
            $this->assertStringNotContainsString(
                $entry['endpoint'][1],
                $prompt,
                "{$key}'s endpoint reached the model",
            );
        }
    }

    public function test_unparseable_output_is_a_refusal_not_a_guess(): void
    {
        $this->fakeReply('I think you want the leave settings screen.');

        $this->expectException(UnsupportedQuestionException::class);

        app(ActionPlanner::class)->plan('change the casual leave carry-forward to 10 days');
    }

    /**
     * A configuration fault, checked before anything else: it is true of every
     * request, and telling somebody to rephrase would be a lie.
     */
    public function test_an_unconfigured_provider_is_a_refusal_before_any_call(): void
    {
        config()->set('services.ai.secondary_api_key', null);
        config()->set('services.ai.api_key', null);
        Http::fake();

        try {
            app(ActionPlanner::class)->plan('change the casual leave carry-forward to 10 days');
            $this->fail('an unconfigured planner produced a plan');
        } catch (UnsupportedQuestionException $e) {
            $this->assertStringContainsString('not configured', $e->getDetail());
        }

        Http::assertNothingSent();
    }

    /**
     * The local gate, and the reason it exists.
     *
     * Consulting the model on every question would spend a call and ~3s on
     * every READ, and — worse — §6 says an action refusal never falls back to
     * prose, so a question wrongly routed here comes back as "I can't change
     * that" instead of an answer. So an INSTRUCTION is a change request and a
     * QUESTION is not: "change the cap to 10" acts, "how do I change the cap?"
     * asks, and the second one is what the prose assistant is for.
     */
    #[DataProvider('changeRequests')]
    public function test_it_recognises_an_instruction_to_change_something(string $question): void
    {
        $this->assertTrue(
            ActionPlanner::isChangeRequest($question),
            "'{$question}' should have been read as a change",
        );
    }

    public static function changeRequests(): array
    {
        return [
            ['change the casual leave carry-forward to 10 days'],
            ['set the annual quota for sick leave to 12'],
            ['rename the HR department to Human Resources'],
            ['update our timezone to Asia/Kolkata'],
            ['can you change the office start time to 09:30?'],
            ['increase the casual leave quota to 15 days'],
        ];
    }

    #[DataProvider('questions')]
    public function test_it_leaves_a_question_to_the_read_and_prose_paths(string $question): void
    {
        $this->assertFalse(
            ActionPlanner::isChangeRequest($question),
            "'{$question}' should not have been read as a change",
        );
    }

    public static function questions(): array
    {
        return [
            ['how do I change the carry-forward cap?'],
            ['what is the carry-forward cap for casual leave'],
            ['who was absent more than 3 days last month'],
            ['headcount by department'],
            ['show me the leave types'],
            ['why did the HR department change its name'],
        ];
    }
}
