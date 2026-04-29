<?php

namespace App\Services\Auth;

use App\Models\User;
use Illuminate\Support\Facades\DB;

class ApiTokenService
{
    public function issue(User $user, string $name = 'auth-token', ?int $ttlMinutes = null): string
    {
        $plainToken = bin2hex(random_bytes(40));
        $ttlMinutes ??= (int) config('auth.api_tokens.ttl_minutes', 10080);

        DB::table('personal_access_tokens')->insert([
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
            'name' => $name,
            'token' => hash('sha256', $plainToken),
            'abilities' => json_encode(['*']),
            'last_used_at' => null,
            'expires_at' => $ttlMinutes > 0 ? now()->addMinutes($ttlMinutes) : null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $plainToken;
    }
}
