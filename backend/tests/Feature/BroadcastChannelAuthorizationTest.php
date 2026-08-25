<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Who is allowed to open a socket, and on whose channel.
 *
 * This is the whole tenancy story for real-time delivery. There is exactly one
 * channel shape — private-user.{id} — and one rule: it must be your own id.
 * Every test here exists because the failure it describes would be silent:
 * a socket that authorizes when it should not does not throw, it just starts
 * delivering somebody else's notifications.
 */
class BroadcastChannelAuthorizationTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        // The null broadcaster does no authorization at all, so every
        // assertion below would pass against anything. Reverb's broadcaster
        // performs the real channel check; signing an auth response is local
        // HMAC, so no network is involved.
        config([
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.key' => 'test-app-key',
            'broadcasting.connections.reverb.secret' => 'test-app-secret',
            'broadcasting.connections.reverb.app_id' => 'test-app-id',
        ]);

        /*
         * Re-register the channels against the driver we just switched to.
         *
         * Broadcast::channel() forwards to whichever connection is default AT
         * THE MOMENT IT RUNS, and routes/channels.php was loaded during boot,
         * when the test default was still 'null'. Without this line the reverb
         * broadcaster knows about no channels at all, so it refuses
         * everything — and the refusal tests below pass for entirely the wrong
         * reason while the authorization rule they claim to cover is never
         * executed. That is precisely how this file was wrong when first
         * written, and the "own channel" test is what caught it.
         *
         * This requires the real routes/channels.php rather than restating the
         * callback, so the rule under test is the one that ships.
         */
        require base_path('routes/channels.php');

        $this->organization = Organization::create([
            'name' => 'Channel Org',
            'slug' => 'channel-org',
        ]);
    }

    private function makeUser(string $email, array $overrides = []): User
    {
        return User::create(array_merge([
            'name' => 'User '.$email,
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ], $overrides));
    }

    private function authorize(array $headers, string $channel): \Illuminate\Testing\TestResponse
    {
        return $this->postJson('/api/broadcasting/auth', [
            'socket_id' => '1234.5678',
            'channel_name' => $channel,
        ], $headers);
    }

    public function test_a_user_can_authorize_their_own_channel(): void
    {
        $user = $this->makeUser('owner.channel@example.com');

        $this->authorize($this->apiHeadersFor($user), 'private-user.'.$user->id)
            ->assertOk()
            ->assertJsonStructure(['auth']);
    }

    /**
     * The one that matters. Nothing about the channel name is checked by the
     * transport — only this callback stands between a user and somebody else's
     * notification stream.
     */
    public function test_a_user_cannot_authorize_another_users_channel(): void
    {
        $user = $this->makeUser('intruder.channel@example.com');
        $victim = $this->makeUser('victim.channel@example.com');

        $this->authorize($this->apiHeadersFor($user), 'private-user.'.$victim->id)
            ->assertForbidden();
    }

    public function test_a_user_cannot_authorize_a_channel_in_another_organization(): void
    {
        $otherOrganization = Organization::create([
            'name' => 'Other Channel Org',
            'slug' => 'other-channel-org',
        ]);

        $user = $this->makeUser('tenant.channel@example.com');
        $stranger = User::create([
            'name' => 'Stranger',
            'email' => 'stranger.channel@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $otherOrganization->id,
        ]);

        $this->authorize($this->apiHeadersFor($user), 'private-user.'.$stranger->id)
            ->assertForbidden();
    }

    public function test_an_unauthenticated_caller_is_refused(): void
    {
        $user = $this->makeUser('anon.channel@example.com');

        $this->postJson('/api/broadcasting/auth', [
            'socket_id' => '1234.5678',
            'channel_name' => 'private-user.'.$user->id,
        ], ['Accept' => 'application/json'])->assertUnauthorized();
    }

    /**
     * The route sits inside the api.token group precisely so revocation and
     * deactivation apply to sockets as well as to requests. If it had been
     * registered at the framework default it would have used the session
     * guard, which no API caller populates.
     */
    public function test_a_revoked_token_cannot_authorize_a_channel(): void
    {
        $user = $this->makeUser('revoked.channel@example.com');
        $headers = $this->apiHeadersFor($user);

        DB::table('personal_access_tokens')
            ->where('tokenable_id', $user->id)
            ->delete();

        $this->authorize($headers, 'private-user.'.$user->id)->assertUnauthorized();
    }

    public function test_a_deactivated_user_cannot_authorize_a_channel(): void
    {
        $user = $this->makeUser('deactivated.channel@example.com');
        $headers = $this->apiHeadersFor($user);

        $user->forceFill(['deactivated_at' => now()])->save();

        $this->authorize($headers, 'private-user.'.$user->id)->assertForbidden();
    }
}
