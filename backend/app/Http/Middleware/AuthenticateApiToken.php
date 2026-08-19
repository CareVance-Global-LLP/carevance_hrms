<?php

namespace App\Http\Middleware;

use App\Models\User;
use Carbon\Carbon;
use Carbon\CarbonInterface;
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

        // A deactivated account is refused even if it still presents a valid
        // bearer. Deleting tokens at revocation is not enough on its own —
        // anything that mints a new one later would hand access straight back.
        if ($user->deactivated_at !== null) {
            return response()->json([
                'success' => false,
                'message' => 'This account is no longer active.',
                'error_code' => 'ACCOUNT_DEACTIVATED',
            ], 403);
        }

        // Enforce trial expiry on every API call
        $organization = $user->organization;
        if ($organization && $organization->subscription_status === 'trial' && $user->isTrialExpired()) {
            $organization->update([
                'subscription_status' => 'expired',
                'subscription_expires_at' => now()->toDateString(),
            ]);
        }

        // Enforce *paid* expiry too. This used to look only at trials, so a paid
        // plan past its renewal date kept full access indefinitely. The daily
        // billing:roll-cycle command does the same reconciliation; doing it here
        // as well means a day the scheduler misses cannot hand out free access.
        if ($organization && in_array($organization->subscription_status, ['active', 'past_due'], true)) {
            app(\App\Services\Billing\SubscriptionCycleService::class)->reconcile($organization);
        }

        // Block API access if subscription is expired (allow billing/settings endpoints)
        if ($organization && $organization->subscription_status === 'expired') {
            $allowedPaths = ['billing', 'settings', 'auth', 'logout', 'payment'];
            $path = $request->path();
            $isAllowed = collect($allowedPaths)->some(fn ($allowed) => str_contains($path, $allowed));
            if (!$isAllowed) {
                // A paid plan that lapsed is not an expired trial, and telling
                // the customer it was one sends them to the wrong screen.
                $wasTrial = $organization->subscription_intent === 'trial' || !$organization->last_renewal_at;

                return response()->json([
                    'success' => false,
                    'message' => $wasTrial
                        ? 'Your free trial has expired. Please upgrade to continue using CareVance.'
                        : 'Your subscription has lapsed. Renew to restore full access — your data is untouched.',
                    'error_code' => $wasTrial ? 'TRIAL_EXPIRED' : 'SUBSCRIPTION_EXPIRED',
                    'subscription_status' => 'expired',
                ], 403);
            }
        }

        // A break-glass token acts as the customer's employee, which is what
        // makes it useful and what makes an unmarked one indistinguishable
        // from the employee themselves. Resolve the session before the request
        // proceeds so the audit observer can stamp every write with it — and
        // refuse immediately if the customer has since revoked it, rather than
        // waiting for the token's own expiry to catch up.
        $breakGlass = $this->resolveBreakGlassSession($tokenRecord);

        if ($breakGlass !== null) {
            if (! $breakGlass->isUsable()) {
                return response()->json([
                    'success' => false,
                    'message' => $breakGlass->unusableReason(),
                    'error_code' => 'BREAK_GLASS_ENDED',
                ], 403);
            }

            $request->attributes->set('break_glass_session_id', $breakGlass->id);
        }

        Auth::setUser($user);
        $request->setUserResolver(fn () => $user);
        $request->attributes->set('access_token', $tokenRecord);

        $this->touchActivity($tokenRecord, $user);

        return $next($request);
    }

    /**
     * The break-glass session a token belongs to, or null for an ordinary one.
     *
     * The session id travels in the token's abilities as "break_glass:41", so
     * an ordinary login token — abilities ["*"] — costs nothing here: no query
     * runs unless the marker is present.
     */
    private function resolveBreakGlassSession(object $tokenRecord): ?\App\Models\BreakGlassSession
    {
        $abilities = json_decode((string) ($tokenRecord->abilities ?? '[]'), true);

        if (! is_array($abilities)) {
            return null;
        }

        foreach ($abilities as $ability) {
            if (! is_string($ability) || ! str_starts_with($ability, 'break_glass:')) {
                continue;
            }

            $sessionId = (int) substr($ability, strlen('break_glass:'));

            if ($sessionId <= 0) {
                continue;
            }

            // Without the scope: at this point in the request no user is
            // authenticated yet, and the session belongs to the customer's
            // tenant rather than the vendor's.
            return \App\Models\BreakGlassSession::withoutOrganizationScope()
                ->find($sessionId);
        }

        return null;
    }

    /**
     * Record token/user activity, at most once per minute.
     *
     * These two writes previously ran on EVERY authenticated request, so a
     * read-only API call still cost two row updates. At any real request rate
     * that is the first thing to saturate the primary. Minute granularity is
     * all `last_used_at` / `last_seen_at` are ever displayed at.
     */
    private function touchActivity(object $tokenRecord, User $user): void
    {
        $now = now();
        $staleAfter = $now->copy()->subMinute();

        // The token row comes from the query builder, so timestamps arrive as
        // raw strings rather than Carbon instances — parse before comparing.
        if ($this->isStale($tokenRecord->last_used_at ?? null, $staleAfter)) {
            DB::table('personal_access_tokens')
                ->where('id', $tokenRecord->id)
                ->update([
                    'last_used_at' => $now,
                    'updated_at' => $now,
                ]);
        }

        if ($this->isStale($user->last_seen_at, $staleAfter)) {
            DB::table('users')
                ->where('id', $user->id)
                ->update(['last_seen_at' => $now]);
        }
    }

    /**
     * True when $value is absent, unparseable, or older than $threshold.
     * Unparseable values fall through to "stale" so a malformed timestamp
     * gets corrected rather than freezing updates forever.
     */
    private function isStale(mixed $value, CarbonInterface $threshold): bool
    {
        if ($value === null || $value === '') {
            return true;
        }

        try {
            return Carbon::parse($value)->lessThan($threshold);
        } catch (\Throwable) {
            return true;
        }
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
