<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AuthApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_login_returns_token_and_logout_revokes_it(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $user = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();

        $loginResponse = $this->postJson('/api/auth/login', [
            'email' => 'admin@example.com',
            'password' => 'password123',
        ]);

        $loginResponse
            ->assertOk()
            ->assertJsonPath('user.id', $user->id)
            ->assertJsonStructure(['token', 'user', 'organization']);

        $token = (string) $loginResponse->json('token');
        $this->assertNotSame('', $token);

        $this->getJson('/api/auth/me', [
            'Authorization' => 'Bearer '.$token,
            'Accept' => 'application/json',
        ])->assertOk()->assertJsonPath('id', $user->id);

        $this->postJson('/api/auth/logout', [], [
            'Authorization' => 'Bearer '.$token,
            'Accept' => 'application/json',
        ])->assertOk();

        $this->assertDatabaseMissing('personal_access_tokens', [
            'token' => hash('sha256', $token),
        ]);

        $this->getJson('/api/auth/me', [
            'Authorization' => 'Bearer '.$token,
            'Accept' => 'application/json',
        ])->assertUnauthorized();
    }

    public function test_remember_me_controls_auth_cookie_lifetime(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $user = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();

        $sessionResponse = $this->postJson('/api/auth/login', [
            'email' => 'admin@example.com',
            'password' => 'password123',
            'remember' => false,
        ])->assertOk();

        $rememberedResponse = $this->postJson('/api/auth/login', [
            'email' => 'admin@example.com',
            'password' => 'password123',
            'remember' => true,
        ])->assertOk();

        $sessionCookie = collect($sessionResponse->headers->getCookies())
            ->first(fn ($cookie) => $cookie->getName() === 'carevance_api_token');
        $rememberedCookie = collect($rememberedResponse->headers->getCookies())
            ->first(fn ($cookie) => $cookie->getName() === 'carevance_api_token');

        $this->assertNotNull($sessionCookie);
        $this->assertNotNull($rememberedCookie);
        $this->assertSame(0, $sessionCookie->getExpiresTime());
        $this->assertGreaterThan(time(), $rememberedCookie->getExpiresTime());
    }

    public function test_protected_routes_require_a_valid_bearer_token(): void
    {
        $this->getJson('/api/settings/me')->assertUnauthorized();
        $this->getJson('/api/dashboard')->assertUnauthorized();

        DB::table('personal_access_tokens')->insert([
            'tokenable_type' => User::class,
            'tokenable_id' => 9999,
            'name' => 'bad-token',
            'token' => hash('sha256', 'invalid-token'),
            'abilities' => json_encode(['*']),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $this->getJson('/api/settings/me', [
            'Authorization' => 'Bearer invalid-token',
            'Accept' => 'application/json',
        ])->assertUnauthorized();
    }

    public function test_login_is_rate_limited_per_email_and_ip(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $user = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $user->forceFill(['email_verified_at' => now()])->save();

        foreach (range(1, 5) as $attempt) {
            $this->postJson('/api/auth/login', [
                'email' => 'admin@example.com',
                'password' => 'wrong-password',
            ])->assertStatus(422);
        }

        $this->postJson('/api/auth/login', [
            'email' => 'admin@example.com',
            'password' => 'wrong-password',
        ])->assertStatus(429);
    }

    public function test_login_rejects_unverified_email_after_account_creation(): void
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        User::create([
            'name' => 'Pending User',
            'email' => 'pending@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $this->postJson('/api/auth/login', [
            'email' => 'pending@example.com',
            'password' => 'password123',
        ])
            ->assertStatus(403)
            ->assertJsonPath('message', 'Please verify your email before signing in.')
            ->assertJsonPath('error_code', 'EMAIL_NOT_VERIFIED')
            ->assertJsonPath('email', 'pending@example.com');
    }
}
