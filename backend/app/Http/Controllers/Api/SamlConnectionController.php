<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SamlConnection;
use App\Services\Auth\SamlAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use OneLogin\Saml2\Utils as SamlUtils;

/**
 * Configuring single sign-on.
 *
 * Admin-only, and the reason is not squeamishness: whoever can write a
 * connection here decides which certificate is trusted to assert who anybody in
 * this organization is. Someone able to point a connection at their own
 * identity provider can sign in as the payroll administrator.
 *
 * Distinct from SamlAuthController, which is the unauthenticated login path.
 */
class SamlConnectionController extends Controller
{
    public function __construct(
        private readonly SamlAuthService $saml,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $connections = SamlConnection::query()
            ->where('organization_id', $request->user()->organization_id)
            ->orderBy('name')
            ->get()
            ->map(fn (SamlConnection $connection) => array_merge($connection->toArray(), [
                // Never the certificate itself - it is $hidden on the model.
                // What an admin needs is which one is loaded and when it dies.
                'certificate' => $connection->certificateSummary(),
                'is_usable' => $connection->isUsable(),
            ]));

        return response()->json([
            'data' => $connections,
            /*
             * The three values an admin types into Entra or Okta. Returned by
             * the server rather than assembled in the browser because the
             * audience check compares the entity ID byte-for-byte: a value
             * built from window.location would silently differ behind a proxy
             * and every assertion would be rejected as being for someone else.
             */
            'service_provider' => [
                'entity_id' => $this->saml->serviceProviderEntityId(),
                'acs_url' => $this->saml->assertionConsumerUrl(),
                'metadata_url' => rtrim(config('app.url'), '/').'/api/auth/saml/metadata',
            ],
        ]);
    }

    public function store(Request $request): JsonResponse
    {
        $validated = $this->validated($request);

        if ($refusal = $this->refuseDuplicateIssuer($validated['idp_entity_id'])) {
            return $refusal;
        }

        $connection = SamlConnection::query()->create($validated + [
            'organization_id' => $request->user()->organization_id,
        ]);

        return response()->json(['data' => $connection], 201);
    }

    public function update(Request $request, SamlConnection $samlConnection): JsonResponse
    {
        if ((int) $samlConnection->organization_id !== (int) $request->user()->organization_id) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $validated = $this->validated($request, $samlConnection);

        if (isset($validated['idp_entity_id'])
            && ($refusal = $this->refuseDuplicateIssuer($validated['idp_entity_id'], $samlConnection))) {
            return $refusal;
        }

        $samlConnection->update($validated);

        return response()->json(['data' => $samlConnection->fresh()]);
    }

    public function destroy(Request $request, SamlConnection $samlConnection): JsonResponse
    {
        if ((int) $samlConnection->organization_id !== (int) $request->user()->organization_id) {
            return response()->json(['message' => 'Not found.'], 404);
        }

        $samlConnection->delete();

        return response()->json(['message' => 'Connection removed.']);
    }

    /**
     * Refuse an issuer already claimed by another workspace.
     *
     * A response is matched to a connection by its Issuer, across tenants,
     * because the browser posting it carries no tenant of its own. If two
     * organizations registered the same issuer, one of them would win that
     * lookup for BOTH - and with user provisioning on, somebody signing in from
     * their own identity provider would be created inside a stranger's
     * workspace. The database index on idp_entity_id is not unique, so this
     * check is what holds the line.
     */
    private function refuseDuplicateIssuer(string $issuer, ?SamlConnection $ignore = null): ?JsonResponse
    {
        $taken = SamlConnection::withoutOrganizationScope()
            ->where('idp_entity_id', $issuer)
            ->when($ignore, fn ($query) => $query->whereKeyNot($ignore->id))
            ->exists();

        if (! $taken) {
            return null;
        }

        return response()->json([
            'message' => 'That identity provider is already connected to a workspace. '
                .'If it is yours, remove the existing connection first.',
            'errors' => ['idp_entity_id' => ['This identity provider is already connected.']],
        ], 422);
    }

    /** @return array<string, mixed> */
    private function validated(Request $request, ?SamlConnection $existing = null): array
    {
        $presence = $existing ? 'sometimes' : 'required';

        $validated = $request->validate([
            'name' => 'sometimes|nullable|string|max:255',
            'idp_entity_id' => $presence.'|string|max:255',
            /*
             * https only. The redirect carries an AuthnRequest and the browser
             * follows it; over http, anything on the path can rewrite where
             * somebody is sent to type their password.
             */
            'idp_sso_url' => [$presence, 'url', 'starts_with:https://', 'max:2048'],
            'idp_slo_url' => ['sometimes', 'nullable', 'url', 'starts_with:https://', 'max:2048'],
            'idp_x509_cert' => $presence.'|string|max:20000',
            'email_attribute' => 'sometimes|nullable|string|max:255',
            'name_attribute' => 'sometimes|nullable|string|max:255',
            'provision_users' => 'sometimes|boolean',
            /*
             * Never admin. A provisioned account is created by whoever controls
             * the identity provider, without anybody here approving it - so the
             * ceiling on what that can mint has to be lower than the authority
             * to change this connection.
             */
            'default_role' => ['sometimes', 'nullable', Rule::in(['employee', 'manager', 'hr'])],
            'legal_entity_id' => 'sometimes|nullable|integer|exists:legal_entities,id',
            'is_active' => 'sometimes|boolean',
        ]);

        if (isset($validated['idp_x509_cert'])) {
            $validated['idp_x509_cert'] = $this->assertParseableCertificate($validated['idp_x509_cert']);
        }

        return $validated;
    }

    /**
     * Refuse a certificate that cannot be read.
     *
     * Checked at the point of paste rather than at first login. An unreadable
     * certificate does not degrade anything - it fails every sign-in
     * completely, in front of a person who cannot get in and cannot tell why.
     * The admin pasting it is the only one who can still fix it cheaply, and
     * only while they are still looking at this screen.
     */
    private function assertParseableCertificate(string $certificate): string
    {
        $normalised = trim($certificate);

        if ($normalised === '') {
            abort(422, 'A signing certificate is required.');
        }

        if (! @openssl_x509_parse(SamlUtils::formatCert($normalised, true))) {
            abort(422, 'That does not look like an X.509 certificate. Copy the signing certificate '
                .'from your identity provider - the block beginning BEGIN CERTIFICATE.');
        }

        // Stored unarmoured, which is the form the library settings expect.
        return SamlUtils::formatCert($normalised, false);
    }
}
