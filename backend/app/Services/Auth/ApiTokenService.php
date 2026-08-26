<?php

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class ApiTokenService
{
    /**
     * Mint an API token.
     *
     * This is the only place a token is created. SuperAdminController used to
     * call `$user->createToken()` instead — a Sanctum method on a model that
     * does not use Sanctum, in an application that does not install it — so
     * that endpoint threw a fatal error on every call and had evidently never
     * been run. Anything needing a token comes through here.
     *
     * @param  array<int, string>  $abilities  Defaults to full access. Pass a
     *                                         narrower list to mark a token as
     *                                         belonging to a governed session,
     *                                         e.g. ['break_glass:41'].
     * @param  Request|null  $request  The sign-in that is creating this session.
     *                                 Passed so the IP and user agent are
     *                                 captured HERE, in the one place a token
     *                                 is ever created, rather than at each of
     *                                 the call sites — a second capture site is
     *                                 a column that is silently NULL for
     *                                 whichever sign-in route nobody
     *                                 remembered. Null is honest: the row
     *                                 renders as "Unknown device", never as a
     *                                 guess.
     */
    public function issue(
        User $user,
        string $name = 'auth-token',
        ?int $ttlMinutes = null,
        array $abilities = ['*'],
        ?Request $request = null,
    ): string {
        $plainToken = bin2hex(random_bytes(40));
        $ttlMinutes ??= (int) config('auth.api_tokens.ttl_minutes', 10080);

        $ip = $request?->ip();
        $userAgent = $request?->userAgent();

        DB::table('personal_access_tokens')->insert([
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
            'name' => $name,
            'token' => hash('sha256', $plainToken),
            'abilities' => json_encode($abilities === [] ? ['*'] : $abilities),
            'created_ip' => $ip,
            // Truncated rather than refused. A user agent longer than the
            // column is still a real sign-in, and losing the session row to
            // protect a display string would be the wrong trade.
            'created_user_agent' => $userAgent === null ? null : mb_substr($userAgent, 0, 512),
            // Seeded from the sign-in so a session that has never made a second
            // request still shows where it is, rather than an empty cell that
            // reads as a defect.
            'last_ip' => $ip,
            'last_used_at' => null,
            'expires_at' => $ttlMinutes > 0 ? now()->addMinutes($ttlMinutes) : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $plainToken;
    }
}
