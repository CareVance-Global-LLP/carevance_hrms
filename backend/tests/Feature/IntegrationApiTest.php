<?php

namespace Tests\Feature;

use App\Jobs\DeliverWebhook;
use App\Models\ApiClient;
use App\Models\Organization;
use App\Models\User;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Services\Integrations\WebhookDispatcher;
use App\Support\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * The customer-facing integration surface.
 *
 * There was none: no public API, no API keys, no outbound webhooks. Every
 * customer integration was a person exporting a CSV, which erases the labour
 * saving the purchase is justified by.
 */
class IntegrationApiTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private Organization $otherOrganization;
    private User $admin;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        TenantContext::clear();

        $this->organization = Organization::factory()->create(['name' => 'Acme']);
        $this->otherOrganization = Organization::factory()->create(['name' => 'Rival']);

        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
    }

    protected function tearDown(): void
    {
        TenantContext::clear();

        parent::tearDown();
    }

    private function issueKey(array $scopes = ['employees.read']): string
    {
        return $this->actingAs($this->admin)
            ->postJson('/api/integrations/keys', [
                'name' => 'Tally sync',
                'scopes' => $scopes,
            ])
            ->assertStatus(201)
            ->json('data.key');
    }

    private function withKey(string $key): static
    {
        return $this->withHeaders([
            'Authorization' => "Bearer {$key}",
            'Accept' => 'application/json',
        ]);
    }

    // -------------------------------------------------------------- api keys

    public function test_a_key_is_shown_once_and_stored_only_as_a_hash(): void
    {
        $key = $this->issueKey();

        $this->assertStringStartsWith('cv_', $key);

        $stored = DB::table('api_clients')->first();

        $this->assertNotSame($key, $stored->key_hash);
        $this->assertSame(hash('sha256', $key), $stored->key_hash);

        // Listing must never hand the key back.
        $listed = $this->actingAs($this->admin)->getJson('/api/integrations/keys')->json('data.keys.0');

        $this->assertArrayNotHasKey('key', $listed);
        $this->assertArrayNotHasKey('key_hash', $listed);
    }

    public function test_an_ordinary_employee_cannot_mint_a_key(): void
    {
        $this->actingAs($this->employee)
            ->postJson('/api/integrations/keys', ['name' => 'mine', 'scopes' => ['payroll.read']])
            ->assertStatus(403);
    }

    public function test_a_key_with_no_valid_scope_is_refused(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/integrations/keys', ['name' => 'useless', 'scopes' => ['everything']])
            ->assertStatus(422);
    }

    // ---------------------------------------------------------- the read api

    public function test_a_valid_key_reads_its_own_organisations_employees(): void
    {
        $key = $this->issueKey();

        $response = $this->withKey($key)->getJson('/api/v1/employees')->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();

        $this->assertContains($this->employee->id, $ids);
    }

    /**
     * The property this whole design turns on.
     *
     * An API key has no authenticated user, and BelongsToOrganization treats
     * "no user" as a console command and disables itself. Without the tenant
     * pin, this endpoint would return every employee of every customer.
     */
    public function test_a_key_cannot_see_another_organisations_employees(): void
    {
        $stranger = User::factory()->create([
            'organization_id' => $this->otherOrganization->id,
            'role' => 'employee',
            'email' => 'stranger@rival.test',
        ]);

        $key = $this->issueKey();

        $response = $this->withKey($key)->getJson('/api/v1/employees')->assertOk();

        $ids = collect($response->json('data'))->pluck('id')->all();

        $this->assertNotContains(
            $stranger->id,
            $ids,
            'An API key must never read across tenants.'
        );
        $this->assertNotContains($stranger->email, collect($response->json('data'))->pluck('email')->all());
    }

    public function test_a_request_with_no_key_is_refused(): void
    {
        $this->getJson('/api/v1/employees')
            ->assertStatus(401)
            ->assertJsonPath('error_code', 'API_KEY_MISSING');
    }

    public function test_an_unknown_key_is_refused(): void
    {
        $this->withKey('cv_nonsense_'.str_repeat('a', 40))
            ->getJson('/api/v1/employees')
            ->assertStatus(401)
            ->assertJsonPath('error_code', 'API_KEY_INVALID');
    }

    public function test_a_key_without_the_scope_is_refused(): void
    {
        $key = $this->issueKey(['employees.read']);

        $this->withKey($key)
            ->getJson('/api/v1/attendance')
            ->assertStatus(403)
            ->assertJsonPath('error_code', 'API_KEY_SCOPE');
    }

    public function test_a_revoked_key_stops_working_immediately(): void
    {
        $key = $this->issueKey();
        $client = ApiClient::withoutOrganizationScope()->firstOrFail();

        $this->withKey($key)->getJson('/api/v1/employees')->assertOk();

        $this->actingAs($this->admin)
            ->deleteJson("/api/integrations/keys/{$client->id}")
            ->assertOk();

        $this->withKey($key)
            ->getJson('/api/v1/employees')
            ->assertStatus(401)
            ->assertJsonPath('error_code', 'API_KEY_INACTIVE');
    }

    public function test_an_expired_key_stops_working(): void
    {
        $key = $this->issueKey();

        ApiClient::withoutOrganizationScope()->firstOrFail()
            ->forceFill(['expires_at' => now()->subMinute()])->save();

        $this->withKey($key)
            ->getJson('/api/v1/employees')
            ->assertStatus(401)
            ->assertJsonPath('error_code', 'API_KEY_INACTIVE');
    }

    /**
     * A leaked pin would silently scope the next request in the same process
     * to the wrong tenant.
     */
    public function test_the_tenant_pin_does_not_survive_the_request(): void
    {
        $key = $this->issueKey();

        $this->withKey($key)->getJson('/api/v1/employees')->assertOk();

        $this->assertNull(TenantContext::current(), 'The tenant pin must be cleared after the response.');
    }

    // -------------------------------------------------------------- webhooks

    public function test_a_webhook_endpoint_must_be_https(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/integrations/webhooks', [
                'name' => 'insecure',
                'url' => 'http://example.test/hook',
                'events' => ['employee.created'],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('url');
    }

    public function test_the_signing_secret_is_shown_once_and_encrypted_at_rest(): void
    {
        $secret = $this->actingAs($this->admin)
            ->postJson('/api/integrations/webhooks', [
                'name' => 'Ops',
                'url' => 'https://example.test/hook',
                'events' => ['employee.created'],
            ])
            ->assertStatus(201)
            ->json('data.signing_secret');

        $raw = DB::table('webhook_endpoints')->first();

        $this->assertNotSame($secret, $raw->secret);
        $this->assertStringNotContainsString($secret, (string) $raw->secret);

        // Listing must never hand it back.
        $listed = $this->actingAs($this->admin)->getJson('/api/integrations/webhooks')->json('data.endpoints.0');
        $this->assertArrayNotHasKey('secret', $listed);
    }

    public function test_an_event_queues_a_delivery_for_a_listening_endpoint(): void
    {
        Queue::fake();

        $this->makeEndpoint(['employee.created']);

        User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'email' => 'newjoiner@acme.test',
        ]);

        $this->assertSame(
            1,
            WebhookDelivery::withoutOrganizationScope()->where('event', 'employee.created')->count()
        );

        Queue::assertPushed(DeliverWebhook::class);
    }

    public function test_an_endpoint_only_hears_the_events_it_subscribed_to(): void
    {
        Queue::fake();

        $this->makeEndpoint(['invoice.paid']);

        User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'email' => 'ignored@acme.test',
        ]);

        $this->assertSame(0, WebhookDelivery::withoutOrganizationScope()->count());
    }

    public function test_an_event_is_not_delivered_to_another_organisations_endpoint(): void
    {
        Queue::fake();

        // The rival subscribes to the same event.
        $rival = new WebhookEndpoint([
            'organization_id' => $this->otherOrganization->id,
            'name' => 'Rival',
            'url' => 'https://rival.test/hook',
            'secret' => 'whsec_rival',
            'events' => ['employee.created'],
            'is_active' => true,
        ]);
        $rival->organization_id = $this->otherOrganization->id;
        $rival->saveQuietly();

        User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'email' => 'ours@acme.test',
        ]);

        $this->assertSame(
            0,
            WebhookDelivery::withoutOrganizationScope()->where('webhook_endpoint_id', $rival->id)->count(),
            'One tenant must never receive another tenant employee events.'
        );
    }

    public function test_a_successful_delivery_is_signed_and_recorded(): void
    {
        Http::fake(['*' => Http::response('', 200)]);

        $endpoint = $this->makeEndpoint(['employee.created']);

        $delivery = new WebhookDelivery([
            'organization_id' => $this->organization->id,
            'webhook_endpoint_id' => $endpoint->id,
            'event' => 'employee.created',
            'payload' => ['employee_id' => 1],
            'status' => 'pending',
        ]);
        $delivery->organization_id = $this->organization->id;
        $delivery->save();

        (new DeliverWebhook($delivery->id))->handle();

        $delivery->refresh();

        $this->assertSame('delivered', $delivery->status);
        $this->assertSame(1, $delivery->attempts);
        $this->assertNotNull($delivery->delivered_at);

        Http::assertSent(function ($request) use ($endpoint) {
            $timestamp = $request->header('X-CareVance-Timestamp')[0];
            $expected = WebhookDispatcher::signature(
                (string) $endpoint->fresh()->secret,
                (int) $timestamp,
                $request->body()
            );

            return $request->header('X-CareVance-Signature')[0] === $expected;
        });
    }

    public function test_a_failing_delivery_retries_with_backoff_and_finally_gives_up(): void
    {
        Http::fake(['*' => Http::response('nope', 500)]);
        Queue::fake();

        $endpoint = $this->makeEndpoint(['employee.created']);

        $delivery = new WebhookDelivery([
            'organization_id' => $this->organization->id,
            'webhook_endpoint_id' => $endpoint->id,
            'event' => 'employee.created',
            'payload' => [],
            'status' => 'pending',
            'attempts' => DeliverWebhook::MAX_ATTEMPTS - 1,
        ]);
        $delivery->organization_id = $this->organization->id;
        $delivery->save();

        (new DeliverWebhook($delivery->id))->handle();

        $delivery->refresh();

        $this->assertSame('failed', $delivery->status);
        $this->assertSame(DeliverWebhook::MAX_ATTEMPTS, $delivery->attempts);
        $this->assertNull($delivery->next_attempt_at, 'A settled delivery must not be scheduled again.');
        $this->assertSame(500, $delivery->response_status);
    }

    public function test_backoff_grows_and_is_capped(): void
    {
        $this->assertSame(60, WebhookDispatcher::backoffSeconds(1));
        $this->assertSame(300, WebhookDispatcher::backoffSeconds(2));
        $this->assertSame(36000, WebhookDispatcher::backoffSeconds(9));
    }

    /**
     * Retrying a dead URL forever turns one customer's broken integration into
     * everyone's queue backlog — and it is the same queue payroll runs through.
     */
    public function test_a_repeatedly_failing_endpoint_is_switched_off(): void
    {
        Http::fake(['*' => Http::response('', 500)]);
        Queue::fake();

        $endpoint = $this->makeEndpoint(['employee.created']);
        $endpoint->forceFill(['consecutive_failures' => WebhookEndpoint::FAILURE_LIMIT - 1])->saveQuietly();

        $delivery = new WebhookDelivery([
            'organization_id' => $this->organization->id,
            'webhook_endpoint_id' => $endpoint->id,
            'event' => 'employee.created',
            'payload' => [],
            'status' => 'pending',
            'attempts' => DeliverWebhook::MAX_ATTEMPTS - 1,
        ]);
        $delivery->organization_id = $this->organization->id;
        $delivery->save();

        (new DeliverWebhook($delivery->id))->handle();

        $endpoint->refresh();

        $this->assertNotNull($endpoint->disabled_at);
        $this->assertFalse($endpoint->isListeningFor('employee.created'));
    }

    public function test_a_disabled_endpoint_can_be_re_enabled(): void
    {
        $endpoint = $this->makeEndpoint(['employee.created']);
        $endpoint->forceFill([
            'disabled_at' => now(),
            'disabled_reason' => 'too many failures',
            'consecutive_failures' => 10,
        ])->saveQuietly();

        $this->actingAs($this->admin)
            ->postJson("/api/integrations/webhooks/{$endpoint->id}/enable")
            ->assertOk();

        $endpoint->refresh();

        $this->assertNull($endpoint->disabled_at);
        $this->assertSame(0, $endpoint->consecutive_failures);
    }

    public function test_the_dead_letter_list_is_visible_to_the_customer(): void
    {
        $endpoint = $this->makeEndpoint(['employee.created']);

        $delivery = new WebhookDelivery([
            'organization_id' => $this->organization->id,
            'webhook_endpoint_id' => $endpoint->id,
            'event' => 'employee.created',
            'payload' => [],
            'status' => 'failed',
            'attempts' => 5,
            'error' => 'HTTP 500',
        ]);
        $delivery->organization_id = $this->organization->id;
        $delivery->save();

        $response = $this->actingAs($this->admin)
            ->getJson('/api/integrations/webhook-deliveries?status=failed')
            ->assertOk();

        $this->assertCount(1, $response->json('data'));
        $this->assertSame('HTTP 500', $response->json('data.0.error'));
    }

    private function makeEndpoint(array $events): WebhookEndpoint
    {
        $endpoint = new WebhookEndpoint([
            'organization_id' => $this->organization->id,
            'name' => 'Ops',
            'url' => 'https://example.test/hook',
            'secret' => 'whsec_'.str_repeat('x', 20),
            'events' => $events,
            'is_active' => true,
        ]);

        $endpoint->organization_id = $this->organization->id;
        $endpoint->saveQuietly();

        return $endpoint;
    }
}
