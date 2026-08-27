<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\ScimToken;
use App\Models\User;
use App\Services\Auth\ScimProvisioningService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * SCIM provisioning.
 *
 * SAML already let somebody sign IN. This is the half that matters: taking
 * access away when the IdP says to. Somebody disabled in Entra used to keep
 * their CareVance account until an admin removed it by hand — SAML refused
 * their next login, but an existing API token carried on working, so a leaver
 * could still read payroll on Monday.
 *
 * So the tests spend most of their effort on deprovisioning, on the two
 * different PATCH shapes real IdPs send, and on the bearer token being a
 * credential rather than a string in a column.
 */
class ScimProvisioningTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-scim']);

        $this->admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $this->organization->id,
        ]);

        $this->token = app(ScimProvisioningService::class)
            ->issueToken($this->organization, 'Entra', $this->admin)['plain'];
    }

    /** @param array<string, mixed> $payload */
    private function scim(string $method, string $path, array $payload = [], ?string $token = null)
    {
        return $this->json($method, "/api/scim/v2{$path}", $payload, [
            'Authorization' => 'Bearer '.($token ?? $this->token),
        ]);
    }

    /** @param array<string, mixed> $over */
    private function userPayload(array $over = []): array
    {
        return array_merge([
            'schemas' => ['urn:ietf:params:scim:schemas:core:2.0:User'],
            'externalId' => 'idp-abc-123',
            'userName' => 'priya@carevance.test',
            'name' => ['givenName' => 'Priya', 'familyName' => 'Nair'],
            'active' => true,
        ], $over);
    }

    private function provision(array $over = []): User
    {
        $this->scim('POST', '/Users', $this->userPayload($over))->assertCreated();

        return User::query()->where('organization_id', $this->organization->id)
            ->where('email', $over['userName'] ?? 'priya@carevance.test')->firstOrFail();
    }

    public function test_the_token_is_never_stored_in_the_clear(): void
    {
        $stored = ScimToken::query()->where('organization_id', $this->organization->id)->firstOrFail();

        /*
         * A leaked database must not hand somebody the ability to create and
         * deactivate users across a tenant.
         */
        $this->assertNotSame($this->token, $stored->token_hash);
        $this->assertSame(hash('sha256', $this->token), $stored->token_hash);
        $this->assertArrayNotHasKey('token_hash', $stored->toArray());
    }

    public function test_no_token_means_no_access(): void
    {
        $this->getJson('/api/scim/v2/Users')->assertStatus(401);
        $this->scim('GET', '/Users', [], 'scim_wrong')->assertStatus(401);
    }

    public function test_a_revoked_token_stops_working(): void
    {
        ScimToken::query()->where('organization_id', $this->organization->id)
            ->update(['revoked_at' => now()]);

        $this->scim('GET', '/Users')->assertStatus(401);
    }

    public function test_provisioning_creates_somebody_who_can_be_found_again(): void
    {
        $user = $this->provision();

        $this->assertSame('Priya Nair', $user->name);
        $this->assertSame('idp-abc-123', $user->scim_external_id);
        $this->assertTrue($user->is_scim_managed);
        $this->assertNull($user->deactivated_at);
    }

    public function test_the_username_filter_is_honoured(): void
    {
        $this->provision();

        $found = $this->scim('GET', '/Users?filter=userName eq "priya@carevance.test"')->assertOk();
        $missing = $this->scim('GET', '/Users?filter=userName eq "nobody@carevance.test"')->assertOk();

        /*
         * Entra and Okta both probe with this before creating anybody. A
         * listing that ignored the filter would report every user as already
         * existing and provision nobody.
         */
        $this->assertSame(1, $found->json('totalResults'));
        $this->assertSame(0, $missing->json('totalResults'));
    }

    public function test_an_unsupported_filter_is_refused_rather_than_ignored(): void
    {
        // Returning the whole directory for a filter we did not understand is
        // how an IdP concludes everybody already exists.
        $this->scim('GET', '/Users?filter=title co "Engineer"')
            ->assertStatus(400)
            ->assertJsonPath('scimType', 'invalidFilter');
    }

    public function test_somebody_is_matched_by_external_id_not_by_email(): void
    {
        $user = $this->provision();

        // They marry and change their surname and address.
        $this->scim('PUT', "/Users/{$user->id}", $this->userPayload([
            'userName' => 'priya.sharma@carevance.test',
            'name' => ['givenName' => 'Priya', 'familyName' => 'Sharma'],
        ]))->assertOk();

        /*
         * Matching on email would silently create a second account and
         * deprovision neither.
         */
        $this->assertSame(1, User::query()->where('scim_external_id', 'idp-abc-123')->count());
        $this->assertSame('priya.sharma@carevance.test', $user->fresh()->email);
        $this->assertSame('Priya Sharma', $user->fresh()->name);
    }

    public function test_an_existing_account_is_adopted_rather_than_duplicated(): void
    {
        $existing = User::create([
            'name' => 'Ravi',
            'email' => 'ravi@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $this->scim('POST', '/Users', $this->userPayload([
            'userName' => 'ravi@carevance.test',
            'externalId' => 'idp-ravi-9',
            'name' => ['givenName' => 'Ravi', 'familyName' => 'Kumar'],
        ]))->assertCreated();

        // Adopted and stamped, so every later sync uses the reliable key.
        $this->assertSame(1, User::query()->where('email', 'ravi@carevance.test')->count());
        $this->assertSame('idp-ravi-9', $existing->fresh()->scim_external_id);
        $this->assertTrue($existing->fresh()->is_scim_managed);
    }

    public function test_okta_style_patch_deactivates(): void
    {
        $user = $this->provision();

        // {"op":"replace","path":"active","value":false}
        $this->scim('PATCH', "/Users/{$user->id}", [
            'schemas' => ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            'Operations' => [['op' => 'replace', 'path' => 'active', 'value' => false]],
        ])->assertOk()->assertJsonPath('active', false);

        $this->assertNotNull($user->fresh()->deactivated_at);
    }

    public function test_entra_style_patch_deactivates_too(): void
    {
        $user = $this->provision();

        // {"op":"replace","value":{"active":false}} — the other shape in the
        // wild. Handling only one is how half your customers find that leavers
        // keep their access.
        $this->scim('PATCH', "/Users/{$user->id}", [
            'Operations' => [['op' => 'replace', 'value' => ['active' => false]]],
        ])->assertOk();

        $this->assertNotNull($user->fresh()->deactivated_at);
    }

    public function test_deactivating_revokes_api_tokens_not_just_a_flag(): void
    {
        $user = $this->provision();

        DB::table('personal_access_tokens')->insert([
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
            'name' => 'phone',
            'token' => hash('sha256', 'whatever'),
            'abilities' => json_encode(['*']),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->scim('DELETE', "/Users/{$user->id}")->assertStatus(204);

        /*
         * The precise failure SCIM is bought to prevent. A flag alone leaves
         * anybody holding a token able to keep reading payroll after they have
         * left.
         */
        $this->assertSame(0, DB::table('personal_access_tokens')->where('tokenable_id', $user->id)->count());
        $this->assertNotNull($user->fresh()->deactivated_at);
    }

    public function test_delete_deactivates_rather_than_erasing(): void
    {
        $user = $this->provision();

        $this->scim('DELETE', "/Users/{$user->id}")->assertStatus(204);

        /*
         * SCIM's DELETE means "no longer in the directory", not "erase their
         * employment history". Payslips, attendance and the leave ledger are
         * records the organization is obliged to keep.
         */
        $this->assertNotNull(User::query()->find($user->id));
    }

    public function test_somebody_rejoining_is_reactivated(): void
    {
        $user = $this->provision();
        $this->scim('DELETE', "/Users/{$user->id}")->assertStatus(204);

        $this->scim('POST', '/Users', $this->userPayload())->assertCreated();

        // Otherwise they come back as a live account that cannot log in.
        $this->assertNull($user->fresh()->deactivated_at);
    }

    public function test_scim_refuses_to_provision_past_the_seat_cap_with_a_scim_error_envelope(): void
    {
        // The admin from setUp already fills the only seat.
        $this->organization->forceFill(['max_seats' => 1])->save();

        $response = $this->scim('POST', '/Users', $this->userPayload())->assertStatus(403);

        /*
         * Now that a deactivated leaver releases their seat, an IdP flipping
         * somebody back on is the one path that could claim a seat with nothing
         * checking — which would make Entra the documented way round the cap.
         *
         * 403, not the guard's own 422: RFC 7644 §3.12 has no `scimType` for
         * running out of capacity, and `detail` is the only part of this an
         * administrator ever sees in Entra or Okta, so the guard's wording —
         * shortfall included — is passed through unchanged.
         */
        $this->assertSame(['urn:ietf:params:scim:api:messages:2.0:Error'], $response->json('schemas'));
        $this->assertSame('403', $response->json('status'));
        $this->assertStringContainsString('seat', strtolower((string) $response->json('detail')));

        $this->assertNull(User::query()
            ->where('organization_id', $this->organization->id)
            ->where('email', 'priya@carevance.test')
            ->first());
    }

    public function test_scim_reactivation_is_refused_when_no_seat_is_free(): void
    {
        $this->organization->forceFill(['max_seats' => 2])->save();

        $leaver = $this->provision();
        $this->scim('DELETE', "/Users/{$leaver->id}")->assertStatus(204);

        // Their seat went to somebody else while they were gone.
        User::create([
            'name' => 'Replacement',
            'email' => 'replacement@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $response = $this->scim('PATCH', "/Users/{$leaver->id}", [
            'schemas' => ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
            // Entra's shape, which is the one that used to clear the column
            // inline in the controller and so bypassed the check entirely.
            'Operations' => [['op' => 'replace', 'value' => ['active' => true]]],
        ])->assertStatus(403);

        $this->assertSame('403', $response->json('status'));
        $this->assertNotNull($leaver->fresh()->deactivated_at);
    }

    public function test_a_token_cannot_see_another_workspace(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-scim']);
        User::create([
            'name' => 'Stranger',
            'email' => 'stranger@other.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $other->id,
        ]);

        $listed = $this->scim('GET', '/Users')->assertOk()->json('Resources');

        $this->assertNotContains('stranger@other.test', array_column($listed, 'userName'));
    }

    public function test_the_response_carries_the_shapes_the_rfc_defines(): void
    {
        $this->provision();

        $response = $this->scim('GET', '/Users')->assertOk();

        /*
         * Not ours to choose. An IdP parses these strictly and reports
         * "provisioning failed" with no detail when they are wrong.
         */
        $this->assertSame(['urn:ietf:params:scim:api:messages:2.0:ListResponse'], $response->json('schemas'));
        $this->assertIsInt($response->json('totalResults'));
        $this->assertIsArray($response->json('Resources'));
        $this->assertSame(
            ['urn:ietf:params:scim:schemas:core:2.0:User'],
            $response->json('Resources.0.schemas'),
        );
    }

    public function test_the_scim_view_does_not_expose_hr_data(): void
    {
        $user = $this->provision();

        $payload = $this->scim('GET', "/Users/{$user->id}")->assertOk()->json();

        // An IdP provisions into an HR system; it has no business reading
        // somebody's salary, attendance or leave balance back out of it.
        foreach (['role', 'organization_id', 'password', 'hourly_rate', 'settings'] as $key) {
            $this->assertArrayNotHasKey($key, $payload);
        }
    }

    public function test_a_user_without_an_email_is_refused(): void
    {
        $this->scim('POST', '/Users', ['externalId' => 'idp-x', 'name' => ['givenName' => 'X']])
            ->assertStatus(400)
            ->assertJsonPath('scimType', 'invalidValue');
    }
}
