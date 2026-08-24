<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\SamlConnection;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Configuring single sign-on.
 *
 * Three things are worth a test here, and all three are about a login failing
 * at the worst possible moment - in front of somebody who cannot get in and has
 * no way to tell why:
 *
 *   1. A certificate that cannot be parsed must be refused while the admin who
 *      pasted it is still on the screen.
 *   2. An issuer already claimed by another workspace must be refused, because
 *      responses are matched to connections across tenants.
 *   3. The certificate must never come back out of the API.
 */
class SamlConnectionAdminTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-saml-admin']);
        $this->admin = $this->makeUser('admin@carevance.test', 'admin', $this->organization);
    }

    private function makeUser(string $email, string $role, Organization $organization): User
    {
        return User::create([
            'name' => explode('@', $email)[0],
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    /** A real self-signed certificate, so openssl actually parses it. */
    private function certificate(): string
    {
        return require base_path('tests/Fixtures/SamlCertificate.php');
    }

    /** @param array<string, mixed> $overrides */
    private function payload(array $overrides = []): array
    {
        return array_merge([
            'name' => 'Entra',
            'idp_entity_id' => 'https://sts.windows.net/abc-123/',
            'idp_sso_url' => 'https://login.microsoftonline.com/abc-123/saml2',
            'idp_x509_cert' => $this->certificate(),
        ], $overrides);
    }

    public function test_an_admin_can_connect_an_identity_provider(): void
    {
        $this->actingAs($this->admin);

        $this->postJson('/api/saml-connections', $this->payload())->assertCreated();

        $this->assertDatabaseHas('saml_connections', [
            'organization_id' => $this->organization->id,
            'idp_entity_id' => 'https://sts.windows.net/abc-123/',
        ]);
    }

    public function test_it_refuses_a_certificate_that_cannot_be_parsed(): void
    {
        $this->actingAs($this->admin);

        // Checked at paste time rather than at first login: an unreadable
        // certificate does not degrade anything, it fails every sign-in.
        $this->postJson('/api/saml-connections', $this->payload([
            'idp_x509_cert' => 'this is not a certificate',
        ]))->assertStatus(422);

        $this->assertDatabaseCount('saml_connections', 0);
    }

    public function test_it_refuses_an_sso_url_that_is_not_https(): void
    {
        $this->actingAs($this->admin);

        // The browser follows this redirect to type a password into it.
        $this->postJson('/api/saml-connections', $this->payload([
            'idp_sso_url' => 'http://login.microsoftonline.com/abc-123/saml2',
        ]))->assertStatus(422);
    }

    public function test_it_refuses_an_issuer_another_workspace_has_already_claimed(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-saml-admin']);

        SamlConnection::withoutOrganizationScope()->create([
            'organization_id' => $other->id,
            'name' => 'Theirs',
            'idp_entity_id' => 'https://sts.windows.net/abc-123/',
            'idp_sso_url' => 'https://login.microsoftonline.com/abc-123/saml2',
            'idp_x509_cert' => $this->certificate(),
            'is_active' => true,
        ]);

        $this->actingAs($this->admin);

        /*
         * A response carries no tenant of its own, so it is matched to a
         * connection by issuer across every workspace. Two connections holding
         * the same issuer means one wins for both - and with provisioning on,
         * somebody signing in from their own provider lands in a stranger's
         * workspace.
         */
        $this->postJson('/api/saml-connections', $this->payload())
            ->assertStatus(422)
            ->assertJsonPath('errors.idp_entity_id.0', 'This identity provider is already connected.');

        $this->assertDatabaseMissing('saml_connections', ['organization_id' => $this->organization->id]);
    }

    public function test_the_certificate_never_comes_back_out_of_the_api(): void
    {
        $this->actingAs($this->admin);
        $this->postJson('/api/saml-connections', $this->payload())->assertCreated();

        $response = $this->getJson('/api/saml-connections')->assertOk();

        $this->assertArrayNotHasKey('idp_x509_cert', $response->json('data.0'));

        // What an admin actually needs instead: which certificate is loaded,
        // and the date every login in the organization stops working.
        $this->assertSame('idp.example.test', $response->json('data.0.certificate.subject'));
        $this->assertGreaterThan(0, $response->json('data.0.certificate.days_remaining'));
    }

    public function test_a_new_connection_starts_switched_off(): void
    {
        $this->actingAs($this->admin);

        $created = $this->postJson('/api/saml-connections', $this->payload())->assertCreated();

        /*
         * The column default, and worth asserting rather than leaving to
         * chance. Turning a connection on redirects every sign-in in the
         * organization to the identity provider, so a connection that went live
         * the moment it was saved would lock people out on a typo - before
         * anybody had a chance to test it.
         */
        $connection = SamlConnection::withoutOrganizationScope()->findOrFail($created->json('data.id'));
        $this->assertFalse($connection->is_active);
        $this->assertFalse($connection->isUsable());

        $this->putJson("/api/saml-connections/{$connection->id}", ['is_active' => true])->assertOk();

        $this->assertTrue($connection->fresh()->isUsable());
    }

    public function test_it_returns_the_values_an_admin_pastes_into_their_provider(): void
    {
        $this->actingAs($this->admin);

        $response = $this->getJson('/api/saml-connections')->assertOk();

        // Server-built: the audience check compares the entity ID
        // byte-for-byte, so a value assembled in the browser would differ
        // behind a proxy and every assertion would be rejected.
        $this->assertStringContainsString('/saml/metadata', $response->json('service_provider.entity_id'));
        $this->assertStringContainsString('/api/auth/saml/callback', $response->json('service_provider.acs_url'));
    }

    public function test_provisioning_cannot_be_pointed_at_an_administrator_role(): void
    {
        $this->actingAs($this->admin);

        /*
         * A provisioned account is created by whoever controls the identity
         * provider, with nobody here approving it. The ceiling on what that can
         * mint has to sit below the authority to configure this connection.
         */
        $this->postJson('/api/saml-connections', $this->payload([
            'provision_users' => true,
            'default_role' => 'admin',
        ]))->assertStatus(422);
    }

    public function test_a_non_admin_cannot_configure_single_sign_on(): void
    {
        $employee = $this->makeUser('kajal@carevance.test', 'employee', $this->organization);

        $this->actingAs($employee);

        // Whoever writes a connection decides which certificate is trusted to
        // assert who anybody here is.
        $this->postJson('/api/saml-connections', $this->payload())->assertForbidden();
        $this->getJson('/api/saml-connections')->assertForbidden();
    }

    public function test_another_workspaces_connection_is_not_reachable(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-saml-reach']);

        $theirs = SamlConnection::withoutOrganizationScope()->create([
            'organization_id' => $other->id,
            'name' => 'Theirs',
            'idp_entity_id' => 'https://sts.windows.net/zzz-999/',
            'idp_sso_url' => 'https://login.microsoftonline.com/zzz-999/saml2',
            'idp_x509_cert' => $this->certificate(),
            'is_active' => true,
        ]);

        $this->actingAs($this->admin);

        $this->deleteJson("/api/saml-connections/{$theirs->id}")->assertNotFound();

        $this->assertDatabaseHas('saml_connections', ['id' => $theirs->id]);
    }
}
