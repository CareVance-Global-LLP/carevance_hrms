<?php

namespace App\Http\Middleware;

use App\Models\ApiClient;
use App\Support\TenantContext;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Authenticates a customer's API key.
 *
 * Separate from AuthenticateApiToken, which authenticates a person. The two
 * are genuinely different: a user token acts as somebody and inherits their
 * permissions; an API key acts as an organisation and carries its own scopes.
 * Conflating them is how a machine credential quietly acquires the rights of
 * whoever created it.
 */
class AuthenticateApiClient
{
    /**
     * @param  string  $scope  the scope this route requires, e.g. 'employees.read'
     */
    public function handle(Request $request, Closure $next, string $scope): Response
    {
        $presented = $this->extractKey($request);

        if ($presented === null) {
            return $this->refuse('No API key supplied.', 'API_KEY_MISSING', 401);
        }

        $client = ApiClient::withoutOrganizationScope()
            ->where('key_hash', hash('sha256', $presented))
            ->first();

        if (! $client) {
            return $this->refuse('That API key is not recognised.', 'API_KEY_INVALID', 401);
        }

        if (! $client->isUsable()) {
            return $this->refuse(
                $client->revoked_at !== null ? 'That API key has been revoked.' : 'That API key has expired.',
                'API_KEY_INACTIVE',
                401,
            );
        }

        if (! $client->allows($scope)) {
            return $this->refuse(
                "This API key does not have the '{$scope}' scope.",
                'API_KEY_SCOPE',
                403,
            );
        }

        /*
         * Pin the tenant for the whole request.
         *
         * There is no authenticated user, so without this every scoped model
         * would query across all tenants — BelongsToOrganization treats a
         * missing user as "console command" and disables itself. This is the
         * single line that makes the public API safe.
         */
        TenantContext::pin((int) $client->organization_id);

        $request->attributes->set('api_client', $client);

        try {
            $response = $next($request);
        } finally {
            // Always cleared, including when the controller throws. A leaked
            // pin would silently scope the next request in the same process to
            // the wrong tenant.
            TenantContext::clear();
        }

        $this->touch($client);

        return $response;
    }

    /**
     * Record use, at most once a minute.
     *
     * The same reasoning as AuthenticateApiToken's activity touch: a write on
     * every request is the first thing to saturate the primary, and last-used
     * is only ever displayed to the minute.
     */
    private function touch(ApiClient $client): void
    {
        if ($client->last_used_at !== null && $client->last_used_at->greaterThan(now()->subMinute())) {
            return;
        }

        DB::table('api_clients')->where('id', $client->id)->update(['last_used_at' => now()]);
    }

    private function extractKey(Request $request): ?string
    {
        $header = (string) $request->header('Authorization', '');

        if (preg_match('/Bearer\s+(.+)/i', $header, $matches)) {
            $token = trim($matches[1]);

            // Only keys minted by ApiClientService carry this prefix. Without
            // the check, a user's session token presented here would be looked
            // up as an API key — failing, but after a needless query, and with
            // a confusing message.
            if (str_starts_with($token, 'cv_')) {
                return $token;
            }
        }

        $headerKey = trim((string) $request->header('X-API-Key', ''));

        return $headerKey !== '' ? $headerKey : null;
    }

    private function refuse(string $message, string $code, int $status): Response
    {
        return response()->json([
            'success' => false,
            'message' => $message,
            'error_code' => $code,
        ], $status);
    }
}
