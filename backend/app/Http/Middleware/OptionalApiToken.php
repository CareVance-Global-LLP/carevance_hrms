<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Resolves the authenticated user when a valid API token is present, but does
 * NOT reject the request when the token is missing or invalid. Used for
 * endpoints that are available to both logged-in users and public visitors
 * (e.g. the AI assistant, which appears on the public landing page).
 */
class OptionalApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $plainToken = $this->extractToken($request);
        if ($plainToken === null) {
            return $next($request);
        }

        $tokenRecord = DB::table('personal_access_tokens')
            ->where('token', hash('sha256', $plainToken))
            ->where(function ($query) {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->first();

        if (!$tokenRecord || $tokenRecord->tokenable_type !== User::class) {
            return $next($request);
        }

        $user = User::find($tokenRecord->tokenable_id);
        if (!$user) {
            return $next($request);
        }

        Auth::setUser($user);
        $request->setUserResolver(fn () => $user);
        $request->attributes->set('access_token', $tokenRecord);

        return $next($request);
    }

    private function extractToken(Request $request): ?string
    {
        $header = (string) $request->header('Authorization', '');
        if (preg_match('/Bearer\s+(.+)/i', $header, $matches)) {
            $plainToken = trim($matches[1]);
            if ($plainToken !== '') {
                return $plainToken;
            }
        }

        $cookieName = (string) config('carevance.auth.api_auth_cookie.name', 'carevance_api_token');
        $cookieToken = trim((string) $request->cookie($cookieName, ''));

        return $cookieToken !== '' ? $cookieToken : null;
    }
}
