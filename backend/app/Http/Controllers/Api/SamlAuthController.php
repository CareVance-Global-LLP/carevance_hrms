<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\SamlConnection;
use App\Models\User;
use App\Services\Auth\SamlAuthService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Signing in through a customer's own identity provider.
 *
 * These routes are unauthenticated by necessity — somebody signing in does not
 * yet have a session, and the identity provider posts the response directly
 * from the browser. Everything that stands in for authentication lives in
 * SamlAuthService: signature verification against the stored certificate,
 * replay refusal, and tenant resolution from the assertion's issuer.
 */
class SamlAuthController extends Controller
{
    public function __construct(
        private readonly SamlAuthService $saml,
    ) {
    }

    /**
     * Whether an email address should be sent to an IdP, and which one.
     *
     * Deliberately answers only yes/no plus a redirect. It does NOT confirm
     * whether the account exists: an unauthenticated endpoint that
     * distinguishes "no such user" from "user exists, use SSO" is a user
     * enumeration oracle, and this one is reachable by anybody.
     */
    public function discover(Request $request): JsonResponse
    {
        $validated = $request->validate(['email' => 'required|string|email|max:255']);

        $domain = strtolower(substr(strrchr($validated['email'], '@') ?: '', 1));
        if ($domain === '') {
            return response()->json(['sso' => false]);
        }

        $user = User::query()->whereRaw('LOWER(email) = ?', [strtolower($validated['email'])])->first();
        if (! $user) {
            return response()->json(['sso' => false]);
        }

        $connection = SamlConnection::withoutOrganizationScope()
            ->where('organization_id', $user->organization_id)
            ->where('is_active', true)
            // An entity-specific connection wins over the organization-wide one.
            ->orderByRaw('CASE WHEN legal_entity_id IS NULL THEN 1 ELSE 0 END')
            ->when($user->legal_entity_id, fn ($query) => $query->where(function ($scope) use ($user) {
                $scope->whereNull('legal_entity_id')->orWhere('legal_entity_id', $user->legal_entity_id);
            }))
            ->first();

        if (! $connection || ! $connection->isUsable()) {
            return response()->json(['sso' => false]);
        }

        return response()->json([
            'sso' => true,
            'redirect_url' => $this->saml->loginUrl($connection),
        ]);
    }

    /** Start a login against a named connection. */
    public function redirect(Request $request, int $connectionId): RedirectResponse|JsonResponse
    {
        $connection = SamlConnection::withoutOrganizationScope()->find($connectionId);

        if (! $connection || ! $connection->isUsable()) {
            return response()->json(['message' => 'Single sign-on is not available.'], 404);
        }

        return redirect()->away($this->saml->loginUrl($connection));
    }

    /**
     * Where the identity provider posts its response.
     *
     * Ends in a browser redirect rather than JSON, because the browser arrives
     * here by form POST from the IdP and a person is looking at it. The token
     * travels in the fragment so it stays out of server logs and out of the
     * Referer header on the next navigation.
     */
    public function callback(Request $request): RedirectResponse
    {
        $samlResponse = (string) $request->input('SAMLResponse', '');

        if ($samlResponse === '') {
            return $this->failure('missing_response');
        }

        try {
            ['user' => $user] = $this->saml->authenticate($samlResponse);
        } catch (RuntimeException $exception) {
            Log::info('SAML sign-in refused', ['message' => $exception->getMessage()]);

            return $this->failure('rejected');
        } catch (\Throwable $exception) {
            report($exception);

            return $this->failure('error');
        }

        $token = $this->issueToken($user);

        return redirect()->away(rtrim(config('app.frontend_url', config('app.url')), '/').'/auth/sso#token='.$token);
    }

    /** The service provider metadata an admin hands to their IdP. */
    public function metadata(): \Illuminate\Http\Response
    {
        $entityId = $this->saml->serviceProviderEntityId();
        $acs = $this->saml->assertionConsumerUrl();

        $xml = <<<XML
        <?xml version="1.0"?>
        <EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="{$entityId}">
          <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
            <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
            <AssertionConsumerService index="1" Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="{$acs}"/>
          </SPSSODescriptor>
        </EntityDescriptor>
        XML;

        return response($xml, 200)->header('Content-Type', 'application/samlmetadata+xml');
    }

    /**
     * A Sanctum-shaped token, issued the same way the password path issues one.
     *
     * Written directly rather than through createToken so the hashing and
     * expiry match the rest of the API exactly — two token formats would mean
     * one of them eventually drifts out of whatever the middleware expects.
     */
    private function issueToken(User $user): string
    {
        $plainToken = bin2hex(random_bytes(40));

        DB::table('personal_access_tokens')->insert([
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
            'name' => 'saml-sso',
            'token' => hash('sha256', $plainToken),
            'abilities' => json_encode(['*']),
            'last_used_at' => null,
            'expires_at' => config('auth.api_tokens.ttl_minutes') > 0
                ? now()->addMinutes((int) config('auth.api_tokens.ttl_minutes'))
                : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $plainToken;
    }

    /**
     * One opaque reason code, whatever went wrong.
     *
     * The detail is in the log, not the URL: distinguishing "no such account"
     * from "signature invalid" to an unauthenticated browser tells an attacker
     * which half of their attempt worked.
     */
    private function failure(string $reason): RedirectResponse
    {
        return redirect()->away(
            rtrim(config('app.frontend_url', config('app.url')), '/').'/login?sso_error='.$reason
        );
    }
}
