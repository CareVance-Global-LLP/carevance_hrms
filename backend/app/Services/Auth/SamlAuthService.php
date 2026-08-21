<?php

namespace App\Services\Auth;

use App\Models\SamlConnection;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use OneLogin\Saml2\Auth as OneLoginAuth;
use OneLogin\Saml2\Utils as OneLoginUtils;
use RuntimeException;

/**
 * SAML single sign-on.
 *
 * Signature validation is delegated to onelogin/php-saml, deliberately. XML
 * signature verification is the entire security boundary here — an assertion is
 * trusted because it is signed by the key matching the stored certificate — and
 * it is full of subtleties (canonicalisation, XML signature wrapping, comment
 * injection in NameID) that have produced real authentication bypasses in
 * hand-rolled implementations. This class owns configuration, tenant resolution
 * and replay protection; it owns none of the cryptography.
 *
 * What this class is responsible for, and the library is not:
 *
 *   1. Which connection a response belongs to. The library validates a response
 *      against whatever config it is handed, so handing it the wrong one would
 *      cheerfully authenticate somebody against another customer's IdP.
 *   2. Replay. An assertion is a bearer credential; the library checks its
 *      timestamps, but only we can know whether we have already seen this one.
 *   3. Whether an authenticated stranger becomes a user at all.
 */
class SamlAuthService
{
    /**
     * Where the IdP posts its response, and what we call ourselves.
     *
     * Both are compared byte-for-byte by the IdP and by the library's audience
     * check, so they are derived from one place rather than typed twice.
     */
    public function serviceProviderEntityId(): string
    {
        return rtrim(config('app.url'), '/').'/saml/metadata';
    }

    public function assertionConsumerUrl(): string
    {
        return rtrim(config('app.url'), '/').'/api/auth/saml/callback';
    }

    /** @return array<string, mixed> */
    public function settingsFor(SamlConnection $connection): array
    {
        return [
            'strict' => true,
            'debug' => false,
            'baseurl' => rtrim(config('app.url'), '/'),
            'sp' => [
                'entityId' => $this->serviceProviderEntityId(),
                'assertionConsumerService' => [
                    'url' => $this->assertionConsumerUrl(),
                    'binding' => 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST',
                ],
                'NameIDFormat' => 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
            ],
            'idp' => [
                'entityId' => $connection->idp_entity_id,
                'singleSignOnService' => [
                    'url' => $connection->idp_sso_url,
                    'binding' => 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect',
                ],
                'x509cert' => $this->normaliseCertificate($connection->idp_x509_cert),
            ],
            'security' => [
                /*
                 * Every one of these must stay true.
                 *
                 * An unsigned assertion is an unauthenticated one: anybody who
                 * can POST to the callback could claim to be anybody. IdPs
                 * differ in whether they sign the response, the assertion, or
                 * both, so we require the assertion — the part that actually
                 * carries the identity — and accept a signed response too.
                 */
                'wantAssertionsSigned' => true,
                'wantMessagesSigned' => false,
                'wantNameId' => true,
                'requestedAuthnContext' => false,
                'rejectUnsolicitedResponsesWithInResponseTo' => false,
                'signatureAlgorithm' => 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
            ],
        ];
    }

    /** Where to send somebody to log in. */
    public function loginUrl(SamlConnection $connection, ?string $relayState = null): string
    {
        $auth = new OneLoginAuth($this->settingsFor($connection));

        return $auth->login($relayState, [], false, false, true);
    }

    /**
     * Validate a response and return the person it is about.
     *
     * @param  string  $samlResponse  raw base64 SAMLResponse from the IdP
     * @return array{user: User, connection: SamlConnection}
     *
     * @throws RuntimeException when the response cannot be trusted
     */
    public function authenticate(string $samlResponse): array
    {
        $connection = $this->connectionForResponse($samlResponse);

        if (! $connection || ! $connection->isUsable()) {
            // Deliberately vague to the caller: which issuers we know is not
            // something an unauthenticated request should be able to enumerate.
            throw new RuntimeException('Single sign-on is not configured for this identity provider.');
        }

        /*
         * The library reads the response out of $_POST rather than an argument,
         * so it has to be there. Set explicitly instead of relying on whatever
         * the request lifecycle left behind, so this cannot pick up a different
         * response than the one we resolved the connection from.
         */
        $_POST['SAMLResponse'] = $samlResponse;

        $auth = new OneLoginAuth($this->settingsFor($connection));
        $auth->processResponse();

        $errors = $auth->getErrors();
        if (! empty($errors)) {
            Log::warning('SAML response rejected', [
                'connection_id' => $connection->id,
                'errors' => $errors,
                'reason' => $auth->getLastErrorReason(),
            ]);

            throw new RuntimeException('That single sign-on response could not be verified.');
        }

        if (! $auth->isAuthenticated()) {
            throw new RuntimeException('That single sign-on response could not be verified.');
        }

        $this->rejectReplay($auth->getLastAssertionId(), $auth->getLastAssertionNotOnOrAfter());

        $attributes = $auth->getAttributes();
        $email = $this->resolveEmail($auth->getNameId(), $attributes, $connection);

        if (! $email) {
            throw new RuntimeException('The identity provider did not send an email address.');
        }

        $user = $this->resolveUser($connection, $email, $attributes);

        $connection->forceFill(['last_login_at' => now()])->save();

        return ['user' => $user, 'connection' => $connection];
    }

    /**
     * Which customer this response is from.
     *
     * Read from the response's Issuer WITHOUT trusting it: it only selects
     * which certificate to verify against. If the issuer is forged, the
     * signature check against that customer's certificate then fails. Choosing
     * the connection some other way — a tenant in the URL, say — would let a
     * valid assertion from customer A be presented to customer B's endpoint.
     */
    private function connectionForResponse(string $samlResponse): ?SamlConnection
    {
        $xml = base64_decode($samlResponse, true);
        if ($xml === false || $xml === '') {
            return null;
        }

        try {
            $document = new \DOMDocument();
            // Entity loading disabled: parsing untrusted XML with entities
            // enabled is how XXE happens, and this runs before any validation.
            $previous = libxml_use_internal_errors(true);
            $document->loadXML($xml, LIBXML_NONET | LIBXML_NOENT);
            libxml_use_internal_errors($previous);

            $issuers = $document->getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion', 'Issuer');
            $issuer = $issuers->length > 0 ? trim($issuers->item(0)->textContent) : null;
        } catch (\Throwable) {
            return null;
        }

        if (! $issuer) {
            return null;
        }

        return SamlConnection::withoutOrganizationScope()
            ->where('idp_entity_id', $issuer)
            ->where('is_active', true)
            ->first();
    }

    /**
     * Refuse an assertion we have already accepted.
     *
     * An assertion is a bearer credential — anybody holding a valid one can
     * present it. The library checks that it is inside its validity window;
     * only we can know whether it has been used. Without this, an assertion
     * captured from a browser, a proxy log or a shared machine can be replayed
     * until it expires.
     */
    private function rejectReplay(?string $assertionId, ?int $notOnOrAfter): void
    {
        if (! $assertionId) {
            throw new RuntimeException('That single sign-on response could not be verified.');
        }

        // Kept until the assertion expires, plus a margin for clock skew.
        $expiresAt = $notOnOrAfter
            ? Carbon::createFromTimestamp($notOnOrAfter)->addMinutes(10)
            : now()->addHours(2);

        try {
            DB::table('saml_used_assertions')->insert([
                'assertion_id' => $assertionId,
                'expires_at' => $expiresAt,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable) {
            // The unique index rejected it, so we have seen this one before.
            Log::warning('SAML assertion replay refused', ['assertion_id' => $assertionId]);

            throw new RuntimeException('That single sign-on response has already been used.');
        }
    }

    /**
     * @param  array<string, mixed>  $attributes
     */
    private function resolveEmail(?string $nameId, array $attributes, SamlConnection $connection): ?string
    {
        $candidates = array_filter([
            $connection->email_attribute,
            'email',
            'mail',
            'urn:oid:0.9.2342.19200300.100.1.3',
            // Entra's default, which is the one people are usually surprised by.
            'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
        ]);

        foreach ($candidates as $key) {
            $value = $attributes[$key][0] ?? null;
            if (is_string($value) && filter_var($value, FILTER_VALIDATE_EMAIL)) {
                return strtolower(trim($value));
            }
        }

        // NameID last: many IdPs put the email there, but many put an opaque
        // identifier instead, so an attribute is the better answer when present.
        if (is_string($nameId) && filter_var($nameId, FILTER_VALIDATE_EMAIL)) {
            return strtolower(trim($nameId));
        }

        return null;
    }

    /**
     * The person this assertion is about.
     *
     * Scoped to the connection's organization.
     *
     * `users.email` currently carries a GLOBAL unique index, so in practice an
     * address exists in at most one tenant and an unscoped lookup would find
     * the same row. This is deliberate defence in depth rather than dead code:
     * the moment that index is relaxed — which is what every multi-tenant
     * product eventually does, because one person legitimately works for two
     * customers — an unscoped lookup here would silently let one customer's
     * identity provider authenticate somebody into another customer's payroll.
     * The scope costs nothing and removes that entire class of future bug.
     *
     * @param  array<string, mixed>  $attributes
     */
    private function resolveUser(SamlConnection $connection, string $email, array $attributes): User
    {
        $user = User::query()
            ->where('organization_id', $connection->organization_id)
            ->whereRaw('LOWER(email) = ?', [$email])
            ->first();

        if ($user) {
            /*
             * Somebody who has been deactivated must not be able to sign back
             * in because their IdP account still exists. Offboarding is one of
             * the main reasons customers want SSO, and it would be an odd
             * feature that let a departed employee back into payroll.
             */
            if ($user->deactivated_at) {
                throw new RuntimeException('That account is no longer active.');
            }

            return $user;
        }

        if (! $connection->provision_users) {
            throw new RuntimeException('No account here matches that sign-in. Ask an administrator to add you first.');
        }

        return User::create([
            'name' => $this->resolveName($attributes, $connection) ?: $email,
            'email' => $email,
            // A password is required by the column but must never be usable:
            // this account authenticates through the IdP and nowhere else.
            'password' => bcrypt(bin2hex(random_bytes(32))),
            'role' => $connection->default_role ?: 'employee',
            'organization_id' => $connection->organization_id,
            'legal_entity_id' => $connection->legal_entity_id,
            'email_verified_at' => now(),
        ]);
    }

    /** @param  array<string, mixed>  $attributes */
    private function resolveName(array $attributes, SamlConnection $connection): ?string
    {
        $candidates = array_filter([
            $connection->name_attribute,
            'displayName',
            'name',
            'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
        ]);

        foreach ($candidates as $key) {
            $value = $attributes[$key][0] ?? null;
            if (is_string($value) && trim($value) !== '') {
                return trim($value);
            }
        }

        return null;
    }

    /** Accept a certificate with or without PEM armour, which is how admins paste them. */
    private function normaliseCertificate(string $certificate): string
    {
        return OneLoginUtils::formatCert($certificate, false);
    }
}
