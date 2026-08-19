<?php

namespace App\Services\Auth;

use App\Models\User;
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
     */
    public function issue(
        User $user,
        string $name = 'auth-token',
        ?int $ttlMinutes = null,
        array $abilities = ['*'],
    ): string {
        $plainToken = bin2hex(random_bytes(40));
        $ttlMinutes ??= (int) config('auth.api_tokens.ttl_minutes', 10080);

        DB::table('personal_access_tokens')->insert([
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
            'name' => $name,
            'token' => hash('sha256', $plainToken),
            'abilities' => json_encode($abilities === [] ? ['*'] : $abilities),
            'last_used_at' => null,
            'expires_at' => $ttlMinutes > 0 ? now()->addMinutes($ttlMinutes) : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $plainToken;
    }
}
