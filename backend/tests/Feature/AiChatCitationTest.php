<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\Request as ClientRequest;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

/**
 * The assistant cites the record behind every number it states.
 *
 * The citations are assembled from the tools that actually ran, not written by
 * the model into its prose. A model asked to format its own citations will
 * invent a plausible route on a bad day, which is precisely the failure this
 * feature exists to prevent.
 */
class AiChatCitationTest extends TestCase
{
    use RefreshDatabase;

    private const BASE_URL = 'https://ai.test/v1';

    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $this->admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-citations@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        config([
            'services.ai.api_key' => 'test-key',
            'services.ai.base_url' => self::BASE_URL,
            'services.ai.model' => 'test-model',
            'services.ai.fallback_models' => '',
            'services.ai.secondary_api_key' => '',
        ]);
    }

    private function fakeToolCallThenAnswer(string $toolName, string $answer): void
    {
        $responses = [
            Http::response(['choices' => [['message' => [
                'role' => 'assistant',
                'content' => null,
                'tool_calls' => [[
                    'id' => 'call_1',
                    'type' => 'function',
                    'function' => ['name' => $toolName, 'arguments' => '{}'],
                ]],
            ]]]]),
            Http::response(['choices' => [['message' => [
                'role' => 'assistant',
                'content' => $answer,
            ]]]]),
        ];

        Http::fake([self::BASE_URL.'/chat/completions' => Http::sequence()->pushResponse($responses[0])->pushResponse($responses[1])]);
    }

    public function test_a_reply_backed_by_a_tool_carries_that_tools_source_route(): void
    {
        $this->fakeToolCallThenAnswer('getPendingApprovals', 'Nothing is waiting on you right now.');

        $this->postJson('/api/ai/chat', ['message' => 'How many approvals are pending?'], $this->apiHeadersFor($this->admin))
            ->assertOk()
            ->assertJsonPath('reply', 'Nothing is waiting on you right now.')
            ->assertJsonPath('sources.0.label', 'Approval Inbox')
            ->assertJsonPath('sources.0.route', '/approval-inbox');
    }

    /**
     * A question answered from the system prompt alone ran no tool, so there is
     * no record to point at. An empty list is the honest answer — inventing a
     * route here would be the exact hallucination this design avoids.
     */
    public function test_a_reply_with_no_tool_behind_it_carries_no_sources(): void
    {
        Http::fake([self::BASE_URL.'/chat/completions' => Http::response(['choices' => [['message' => [
            'role' => 'assistant',
            'content' => 'Go to Settings → Organization to rename the company.',
        ]]]])]);

        $this->postJson('/api/ai/chat', ['message' => 'How do I rename the company?'], $this->apiHeadersFor($this->admin))
            ->assertOk()
            ->assertJsonPath('sources', []);
    }

    /**
     * Two tools in one turn must not produce the same chip twice, and must not
     * drop the second one either.
     */
    public function test_sources_from_several_tools_are_merged_without_duplicates(): void
    {
        Http::fake([self::BASE_URL.'/chat/completions' => Http::sequence()
            ->pushResponse(Http::response(['choices' => [['message' => [
                'role' => 'assistant',
                'content' => null,
                'tool_calls' => [
                    ['id' => 'a', 'type' => 'function', 'function' => ['name' => 'getPendingApprovals', 'arguments' => '{}']],
                    ['id' => 'b', 'type' => 'function', 'function' => ['name' => 'getPendingApprovals', 'arguments' => '{}']],
                    ['id' => 'c', 'type' => 'function', 'function' => ['name' => 'getTodayAttendanceSummary', 'arguments' => '{}']],
                ],
            ]]]]))
            ->pushResponse(Http::response(['choices' => [['message' => [
                'role' => 'assistant',
                'content' => 'Two people are late and nothing is pending.',
            ]]]]))]);

        $response = $this->postJson('/api/ai/chat', ['message' => 'Give me a rundown'], $this->apiHeadersFor($this->admin))
            ->assertOk();

        $routes = array_column($response->json('sources'), 'route');

        $this->assertSame(['/approval-inbox', '/attendance'], $routes);
    }

    /**
     * The landing sales bot has no tools, so it can never cite anything. It
     * must still answer with the same response shape.
     */
    public function test_the_landing_bot_answers_with_an_empty_source_list(): void
    {
        Http::fake([self::BASE_URL.'/chat/completions' => Http::response(['choices' => [['message' => [
            'role' => 'assistant',
            'content' => 'CareVance covers HR, payroll and time tracking in one place.',
        ]]]])]);

        $this->postJson('/api/ai/chat', [
            'message' => 'What is CareVance?',
            'context' => 'landing',
        ], ['Accept' => 'application/json'])
            ->assertOk()
            ->assertJsonPath('sources', []);
    }

    /**
     * The landing branch must never be handed tools. If it were, an
     * unauthenticated stranger would reach organisation data through it.
     */
    public function test_the_landing_bot_is_never_sent_tool_definitions(): void
    {
        Http::fake([self::BASE_URL.'/chat/completions' => Http::response(['choices' => [['message' => [
            'role' => 'assistant',
            'content' => 'Happy to help.',
        ]]]])]);

        $this->postJson('/api/ai/chat', [
            'message' => 'How many people are absent today?',
            'context' => 'landing',
        ], ['Accept' => 'application/json'])->assertOk();

        Http::assertSent(function (ClientRequest $request) {
            return ! array_key_exists('tools', $request->data());
        });
    }
}
