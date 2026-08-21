<?php

namespace Tests;

use App\Models\User;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

abstract class TestCase extends BaseTestCase
{
    use CreatesApplication;

    /**
     * Start every test with an empty cache.
     *
     * RefreshDatabase rolls the database back but leaves the cache alone, and
     * the array store lives for the whole PHP process — so cached values
     * outlive the rows they were computed from. That is not a theoretical leak:
     * report caches are keyed on user id and date range, and RefreshDatabase
     * restarts identity columns at 1, so "user 1, this week" from one test is
     * served verbatim to a completely different user 1 in the next. Nine
     * ReportWorkingTimeTest cases failed only in a full run and passed alone,
     * for exactly this reason.
     *
     * The cost is one flush per test; the alternative is a suite whose result
     * depends on the order it happened to run in, which is a suite you cannot
     * use to tell whether a change was safe.
     */
    protected function setUp(): void
    {
        parent::setUp();

        Cache::flush();
    }

    protected function issueApiToken(User $user, string $name = 'test-token'): string
    {
        $plainToken = bin2hex(random_bytes(40));

        DB::table('personal_access_tokens')->insert([
            'tokenable_type' => User::class,
            'tokenable_id' => $user->id,
            'name' => $name,
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

    protected function apiHeadersFor(User $user): array
    {
        return [
            'Authorization' => 'Bearer '.$this->issueApiToken($user),
            'Accept' => 'application/json',
        ];
    }

    /**
     * Make actingAs() work against the API as well as the session guard.
     *
     * Every /api route is behind the custom `api.token` middleware, which reads
     * a Bearer token and ignores the session guard entirely. So a test that
     * called actingAs($user) and then hit an API route got a 401 — the user was
     * "logged in" in a way the API could not see. Issuing a token here and
     * pinning it as a default header makes the two agree, which is what anyone
     * writing actingAs() in an API test already assumes.
     */
    public function actingAs(\Illuminate\Contracts\Auth\Authenticatable $user, $guard = null)
    {
        parent::actingAs($user, $guard);

        if ($user instanceof User) {
            $this->withHeaders($this->apiHeadersFor($user));
        }

        return $this;
    }
}
