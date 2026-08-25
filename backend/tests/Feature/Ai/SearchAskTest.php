<?php

namespace Tests\Feature\Ai;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class SearchAskTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    protected function setUp(): void
    {
        parent::setUp();

        $this->org = Organization::create(['name' => 'Org', 'slug' => 'org']);
        config()->set('services.ai.secondary_base_url', 'https://openrouter.test/api/v1');
        config()->set('services.ai.secondary_api_key', 'k');
        config()->set('services.ai.secondary_models', 'stealth/ox-alpha');
    }

    private function user(string $role): User
    {
        return User::create([
            'name' => ucfirst($role), 'email' => $role . '-ask@org.test',
            'password' => Hash::make('password123'), 'role' => $role,
            'organization_id' => $this->org->id,
        ]);
    }

    private function fakePlan(string $json): void
    {
        Http::fake(['openrouter.test/*' => Http::response([
            'choices' => [['message' => ['content' => $json]]],
        ], 200)]);
    }

    public function test_an_admin_gets_a_plan_columns_and_rows(): void
    {
        $this->actingAs($this->user('admin'));
        $this->fakePlan('{"entity":"employees","metric":"headcount","group_by":"department"}');

        $response = $this->postJson('/api/search/ask', ['question' => 'headcount by department']);

        $response->assertOk()
            ->assertJsonStructure(['plan', 'columns', 'rows', 'notes', 'summary', 'truncated']);
        // The summary is a separate call so the table can render first.
        $this->assertNull($response->json('summary'));
    }

    public function test_the_derived_plan_is_returned_so_a_human_can_check_it(): void
    {
        $this->actingAs($this->user('admin'));
        $this->fakePlan('{"entity":"employees","metric":"headcount","group_by":"department"}');

        $response = $this->postJson('/api/search/ask', ['question' => 'headcount by department']);

        $this->assertSame('employees', $response->json('plan.entity'));
        $this->assertSame('headcount', $response->json('plan.metric'));
    }

    /**
     * This asserted 422 until the assistants were merged, and the change is
     * deliberate rather than a weakened assertion.
     *
     * The reason the data path declined is what the test was really about, and
     * it is still asserted — it just now travels on a prose answer instead of
     * an error. Measured against the real model, the prose for this exact
     * question is "our system does not currently track headcount broken down by
     * nationality", which is the same fact said usefully; a 422 carrying that
     * sentence made the reader work out that there was nothing to rephrase
     * towards.
     *
     * `detail` surviving on a prose answer is not decoration. A prose reply to
     * something that SHOULD have been a table is a coverage gap, and dropping
     * the reason hides the gap.
     *
     * A WITHHELD refusal still returns 422 and never becomes prose — that is
     * covered in OneAssistantTest, which exists because the assistant, given
     * "everyone's PAN number", helpfully explained where to export PAN data.
     */
    public function test_an_unanswerable_question_answers_in_prose_and_keeps_its_reason(): void
    {
        $this->actingAs($this->user('admin'));
        $this->fakePlan('{"error":"Nationality is not stored in this system."}');

        $response = $this->postJson('/api/search/ask', ['question' => 'headcount by nationality']);

        $response->assertStatus(200)
            ->assertJsonPath('kind', 'prose')
            ->assertJsonPath('detail', 'Nationality is not stored in this system.');

        $this->assertSame([], $response->json('rows'), 'prose carries no rows to be mistaken for data');
        $this->assertNull($response->json('plan'), 'no plan ran, so none is offered for inspection');
    }

    public function test_a_withheld_subject_stays_a_refusal_and_never_becomes_prose(): void
    {
        $this->actingAs($this->user('admin'));

        $this->postJson('/api/search/ask', ['question' => "everyone's PAN number"])
            ->assertStatus(422)
            ->assertJsonPath('kind', 'refusal')
            ->assertJsonPath('error', 'unsupported_question');
    }

    public function test_a_non_admin_is_refused(): void
    {
        $this->actingAs($this->user('employee'));

        $this->postJson('/api/search/ask', ['question' => 'headcount'])->assertStatus(403);
    }

    public function test_an_anonymous_caller_is_refused(): void
    {
        $this->postJson('/api/search/ask', ['question' => 'headcount'])->assertStatus(401);
    }

    public function test_the_question_is_required_and_bounded(): void
    {
        $this->actingAs($this->user('admin'));

        $this->postJson('/api/search/ask', [])->assertStatus(422);
        $this->postJson('/api/search/ask', ['question' => str_repeat('a', 2001)])->assertStatus(422);
    }

    public function test_the_summary_endpoint_returns_a_sentence(): void
    {
        $this->actingAs($this->user('admin'));
        config()->set('services.ai.base_url', 'https://gemini.test/v1');
        config()->set('services.ai.api_key', 'primary');
        Http::fake(['gemini.test/*' => Http::response([
            'choices' => [['message' => ['content' => 'Engineering leads on headcount.']]],
        ], 200)]);

        $this->postJson('/api/search/ask/summary', [
            'question' => 'headcount by department',
            'columns' => [['key' => 'department', 'label' => 'Department', 'type' => 'text']],
            'rows' => [['department' => 'Engineering']],
        ])->assertOk()->assertJsonPath('summary', 'Engineering leads on headcount.');
    }

    public function test_the_ask_is_logged(): void
    {
        $this->actingAs($this->user('admin'));
        $this->fakePlan('{"entity":"employees","metric":"headcount"}');

        $this->postJson('/api/search/ask', ['question' => 'headcount']);

        $this->assertDatabaseHas('ai_chat_logs', ['message' => 'headcount']);
    }
}
