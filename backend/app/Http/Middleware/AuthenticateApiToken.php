<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

class AuthenticateApiToken
{
    public function handle(Request $request, Closure $next): Response
    {
        $plainToken = $this->extractToken($request);
        if ($plainToken === null) {
            return $this->unauthorizedResponse();
        }

        $tokenRecord = DB::table('personal_access_tokens')
            ->where('token', hash('sha256', $plainToken))
            ->where(function ($query) {
                $query->whereNull('expires_at')
                    ->orWhere('expires_at', '>', now());
            })
            ->first();

        if (!$tokenRecord || $tokenRecord->tokenable_type !== User::class) {
            return $this->unauthorizedResponse();
        }

        $user = User::find($tokenRecord->tokenable_id);
        if (!$user) {
            return $this->unauthorizedResponse();
        }

        // Enforce trial expiry on every API call
        $organization = $user->organization;
        if ($organization && $organization->subscription_status === 'trial' && $user->isTrialExpired()) {
            $organization->update([
                'subscription_status' => 'expired',
                'subscription_expires_at' => now()->toDateString(),
            ]);
        }

        // Block API access if subscription is expired (allow billing/settings endpoints)
        if ($organization && $organization->subscription_status === 'expired') {
            $allowedPaths = ['billing', 'settings', 'auth', 'logout', 'payment'];
            $path = $request->path();
            $isAllowed = collect($allowedPaths)->some(fn ($allowed) => str_contains($path, $allowed));
            if (!$isAllowed) {
                return response()->json([
                    'success' => false,
                    'message' => 'Your free trial has expired. Please upgrade to continue using CareVance.',
                    'error_code' => 'TRIAL_EXPIRED',
                    'subscription_status' => 'expired',
                ], 403);
            }
        }

        Auth::setUser($user);
        $request->setUserResolver(fn () => $user);
        $request->attributes->set('access_token', $tokenRecord);

        DB::table('personal_access_tokens')
            ->where('id', $tokenRecord->id)
            ->update([
                'last_used_at' => now(),
                'updated_at' => now(),
            ]);

        DB::table('users')
            ->where('id', $user->id)
            ->update([
                'last_seen_at' => now(),
            ]);

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

    private function unauthorizedResponse(): Response
    {
        return response()->json([
            'success' => false,
            'message' => 'Unauthenticated.',
            'error_code' => 'UNAUTHORIZED',
        ], 401);
    }
}
