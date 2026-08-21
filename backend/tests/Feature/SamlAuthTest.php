<?php

namespace Tests\Feature;

use App\Models\LegalEntity;
use App\Models\Organization;
use App\Models\SamlConnection;
use App\Models\User;
use App\Services\Auth\SamlAuthService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * Enterprise single sign-on.
 *
 * These tests are almost entirely about refusal. The happy path is one
 * assertion; everything else here is a way an attacker or a misconfiguration
 * could get somebody signed in as the wrong person, into the wrong tenant, or
 * after they were supposed to have lost access.
 *
 * XML signature verification itself is onelogin/php-saml's job and is not
 * re-tested here — that library is audited and hand-rolling the checks is how
 * authentication bypasses happen. What IS tested is everything around it, which
 * the library cannot know: which customer a response belongs to, whether we
 * have seen it before, and who is allowed to become a user.
 */
class SamlAuthTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-saml']);
    }

    private function connection(array $overrides = []): SamlConnection
    {
        return SamlConnection::query()->create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => 'Okta',
            'idp_entity_id' => 'http://www.okta.com/exk123',
            'idp_sso_url' => 'https://bigcorp.okta.com/app/sso/saml',
            'idp_x509_cert' => 'MIIDpDCCAoygAwIBAgIGAV2ka+55MA0GCSqGSIb3DQEBCwUAMIGSMQswCQYDVQQGEwJVUzETMBEG',
            'is_active' => true,
            // Stated rather than relying on the column default: an unsaved
            // model reads null for it, which is falsy but not `false`.
            'provision_users' => false,
        ], $overrides));
    }

    private function employee(string $email = 'kajal@bigcorp.com', array $overrides = []): User
    {
        return User::create(array_merge([
            'name' => 'Kajal',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ], $overrides));
    }

    public function test_the_service_provider_publishes_metadata_an_admin_can_hand_to_their_idp(): void
    {
        $response = $this->get('/api/auth/saml/metadata');

        $response->assertOk();
        $this->assertStringContainsString('WantAssertionsSigned="true"', $response->getContent());
        $this->assertStringContainsString('AssertionConsumerService', $response->getContent());
    }

    public function test_assertions_must_be_signed(): void
    {
        /*
         * The single most important setting. An unsigned assertion is an
         * unauthenticated one - anybody able to POST to the callback could
         * claim to be anybody at all.
         */
        $settings = app(SamlAuthService::class)->settingsFor($this->connection());

        $this->assertTrue($settings['security']['wantAssertionsSigned']);
        $this->assertTrue($settings['strict'], 'strict mode off makes the library tolerate invalid responses');
    }

    public function test_a_connection_without_a_certificate_is_unusable(): void
    {
        // The certificate is the entire trust anchor. Without one there is
        // nothing to verify against, so the connection must not be usable.
        $connection = $this->connection(['idp_x509_cert' => '']);

        $this->assertFalse($connection->isUsable());
    }

    public function test_an_inactive_connection_is_unusable(): void
    {
        $this->assertFalse($this->connection(['is_active' => false])->isUsable());
    }

    public function test_a_response_from_an_unknown_issuer_is_refused(): void
    {
        $this->connection();

        $this->expectException(RuntimeException::class);

        app(SamlAuthService::class)->authenticate(base64_encode(
            '<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" '
            .'xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion">'
            .'<saml:Issuer>http://evil.example.com/idp</saml:Issuer></samlp:Response>'
        ));
    }

    public function test_a_garbage_response_is_refused_rather_than_crashing(): void
    {
        $this->connection();

        $this->expectException(RuntimeException::class);

        app(SamlAuthService::class)->authenticate('not-base64-and-not-xml');
    }

    public function test_an_assertion_cannot_be_replayed(): void
    {
        /*
         * A SAML assertion is a bearer credential: anybody holding a valid one
         * can present it. The library checks the validity window; only we can
         * know whether this exact assertion has already been accepted. Without
         * this, one captured from a browser or a proxy log is reusable until it
         * expires.
         */
        $service = app(SamlAuthService::class);
        $method = new \ReflectionMethod($service, 'rejectReplay');

        // First use is accepted.
        $method->invoke($service, '_assertion_abc123', now()->addMinutes(5)->timestamp);
        $this->assertSame(1, DB::table('saml_used_assertions')->where('assertion_id', '_assertion_abc123')->count());

        // The same one again is not.
        $this->expectException(RuntimeException::class);
        $method->invoke($service, '_assertion_abc123', now()->addMinutes(5)->timestamp);
    }

    public function test_an_assertion_with_no_id_is_refused(): void
    {
        // Without an id there is nothing to remember, so replay protection
        // cannot work - which makes accepting it worse than refusing it.
        $service = app(SamlAuthService::class);
        $method = new \ReflectionMethod($service, 'rejectReplay');

        $this->expectException(RuntimeException::class);
        $method->invoke($service, null, now()->addMinutes(5)->timestamp);
    }

    public function test_a_user_is_resolved_within_the_connections_tenant_only(): void
    {
        /*
         * `users.email` currently has a GLOBAL unique index, so an address
         * exists in at most one tenant today and an unscoped lookup would find
         * the same person. The scope is defence in depth: the moment that index
         * is relaxed - which multi-tenant products eventually do, because one
         * person legitimately works for two customers - an unscoped lookup
         * would let one customer's IdP authenticate somebody into another
         * customer's payroll.
         *
         * Asserted by pointing a connection at a DIFFERENT organization and
         * checking it refuses, rather than by creating a duplicate email the
         * database will not accept.
         */
        $this->employee('shared@example.com');

        $otherOrg = Organization::create(['name' => 'Other', 'slug' => 'other-saml']);
        $foreignConnection = SamlConnection::query()->create([
            'organization_id' => $otherOrg->id,
            'name' => 'Their Okta',
            'idp_entity_id' => 'http://www.okta.com/other',
            'idp_sso_url' => 'https://other.okta.com/app/sso/saml',
            'idp_x509_cert' => 'MIIDpDCCAoygAwIBAgIGAV2ka+55MA0GCSqGSIb3DQEBCwUAMIGS',
            'is_active' => true,
            'provision_users' => false,
        ]);

        $service = app(SamlAuthService::class);
        $method = new \ReflectionMethod($service, 'resolveUser');

        // Our employee exists, but not in THIS connection's organization.
        $this->expectException(RuntimeException::class);
        $method->invoke($service, $foreignConnection, 'shared@example.com', []);
    }

    public function test_a_user_in_the_connections_own_tenant_is_found(): void
    {
        // The other half: the scope must not refuse somebody who is legitimately
        // there, or SSO simply never works.
        $connection = $this->connection();
        $ours = $this->employee('kajal@bigcorp.com');

        $service = app(SamlAuthService::class);
        $method = new \ReflectionMethod($service, 'resolveUser');

        $this->assertSame($ours->id, $method->invoke($service, $connection, 'kajal@bigcorp.com', [])->id);
    }

    public function test_a_deactivated_person_cannot_sign_back_in(): void
    {
        /*
         * Offboarding is one of the main reasons customers want SSO. It would
         * be an odd feature that let somebody who had been deactivated back
         * into payroll because their IdP account still existed.
         */
        $connection = $this->connection();
        // forceFill: deactivated_at is not fillable, so passing it to create()
        // silently does nothing and the person is never actually deactivated.
        $this->employee('gone@bigcorp.com')->forceFill(['deactivated_at' => now()->subDay()])->save();

        $service = app(SamlAuthService::class);
        $method = new \ReflectionMethod($service, 'resolveUser');

        $this->expectException(RuntimeException::class);
        $method->invoke($service, $connection, 'gone@bigcorp.com', []);
    }

    public function test_provisioning_is_off_by_default(): void
    {
        /*
         * Just-in-time provisioning on an HRMS means an assertion can create a
         * person, in a system holding payroll. Turning it on is a decision an
         * admin makes knowingly.
         */
        $connection = $this->connection();
        $this->assertFalse($connection->provision_users);

        $service = app(SamlAuthService::class);
        $method = new \ReflectionMethod($service, 'resolveUser');

        $this->expectException(RuntimeException::class);
        $method->invoke($service, $connection, 'stranger@bigcorp.com', []);
    }

    public function test_provisioning_when_enabled_creates_somebody_in_the_right_tenant(): void
    {
        $entity = LegalEntity::query()->create([
            'organization_id' => $this->organization->id,
            'name' => 'CareVance Global LLP',
            'is_primary' => true,
        ]);

        $connection = $this->connection(['provision_users' => true, 'legal_entity_id' => $entity->id]);

        $service = app(SamlAuthService::class);
        $method = new \ReflectionMethod($service, 'resolveUser');
        $user = $method->invoke($service, $connection, 'newjoiner@bigcorp.com', ['displayName' => ['New Joiner']]);

        $this->assertSame('New Joiner', $user->name);
        $this->assertSame($this->organization->id, (int) $user->organization_id);
        $this->assertSame($entity->id, (int) $user->legal_entity_id, 'a provisioned user was not bound to the entity');
    }

    public function test_a_provisioned_account_has_no_usable_password(): void
    {
        // It authenticates through the IdP and nowhere else; a guessable or
        // shared local password would be a second, weaker way in.
        $connection = $this->connection(['provision_users' => true]);

        $service = app(SamlAuthService::class);
        $method = new \ReflectionMethod($service, 'resolveUser');
        $user = $method->invoke($service, $connection, 'newjoiner@bigcorp.com', []);

        $this->assertFalse(Hash::check('password', $user->password));
        $this->assertFalse(Hash::check('', $user->password));
    }

    public function test_the_email_is_read_from_entra_style_claim_uris(): void
    {
        // Entra sends a schemas.xmlsoap.org URI rather than "email", and
        // guessing wrong means every login fails with "no email in assertion".
        $connection = $this->connection();

        $service = app(SamlAuthService::class);
        $method = new \ReflectionMethod($service, 'resolveEmail');

        $email = $method->invoke($service, null, [
            'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress' => ['Kajal@BigCorp.com'],
        ], $connection);

        $this->assertSame('kajal@bigcorp.com', $email, 'the email should be found and normalised');
    }

    public function test_discovery_does_not_reveal_whether_an_account_exists(): void
    {
        /*
         * This endpoint is reachable by anybody. If it distinguished "no such
         * user" from "user exists but has no SSO", it would be a user
         * enumeration oracle for every customer at once.
         */
        $this->connection();
        $this->employee('real@bigcorp.com');

        $unknown = $this->postJson('/api/auth/saml/discover', ['email' => 'nobody@bigcorp.com'])->assertOk()->json();
        $noSso = $this->postJson('/api/auth/saml/discover', ['email' => 'real@example.org'])->assertOk()->json();

        $this->assertSame(['sso' => false], $unknown);
        $this->assertSame(['sso' => false], $noSso);
    }

    public function test_the_certificate_never_appears_in_a_serialised_connection(): void
    {
        // Public-key material rather than a secret, but publishing which key we
        // trust hands an attacker the one thing worth attacking.
        $connection = $this->connection();

        $this->assertArrayNotHasKey('idp_x509_cert', $connection->toArray());
    }
}
