<?php

namespace Tests\Feature;

use App\Events\SessionRevoked;
use App\Models\Organization;
use App\Models\User;
use App\Services\Auth\ScimProvisioningService;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Taking access away has to reach an open socket, not just the next request.
 *
 * Channel authorization runs ONCE, at subscribe time. Deleting somebody's
 * bearer token therefore stops their next HTTP call and does nothing at all to
 * a WebSocket they already hold — a leaver with a tab open would keep
 * receiving live notifications after being deprovisioned. That is the same
 * failure the tokens-not-flags rule exists to prevent, so introducing a
 * real-time transport without this would be a regression against it.
 */
class SessionRevokedBroadcastTest extends TestCase
{
    use RefreshDatabase;

    public function test_scim_deactivation_tears_down_the_users_socket(): void
    {
        Event::fake([SessionRevoked::class]);

        $organization = Organization::create([
            'name' => 'Revoke Org',
            'slug' => 'revoke-org',
        ]);

        $leaver = User::create([
            'name' => 'Leaver',
            'email' => 'leaver.revoke@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        app(ScimProvisioningService::class)->deactivate($leaver);

        Event::assertDispatched(SessionRevoked::class, function (SessionRevoked $event) use ($leaver) {
            $channels = array_map(fn (PrivateChannel $channel) => (string) $channel, $event->broadcastOn());

            return $event->userId === (int) $leaver->id
                && $event->reason === SessionRevoked::REASON_DEACTIVATED
                && $channels === ['private-user.'.$leaver->id];
        });
    }

    /**
     * The teardown must not reach anybody else. It signs the recipient out, so
     * a channel list that was even slightly too wide would sign out colleagues
     * who are still employed.
     */
    public function test_the_teardown_reaches_only_the_deactivated_user(): void
    {
        Event::fake([SessionRevoked::class]);

        $organization = Organization::create([
            'name' => 'Narrow Org',
            'slug' => 'narrow-org',
        ]);

        $leaver = User::create([
            'name' => 'Leaver',
            'email' => 'leaver.narrow@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $colleague = User::create([
            'name' => 'Colleague',
            'email' => 'colleague.narrow@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        app(ScimProvisioningService::class)->deactivate($leaver);

        Event::assertDispatched(SessionRevoked::class, function (SessionRevoked $event) use ($colleague) {
            return $event->userId !== (int) $colleague->id;
        });

        Event::assertDispatchedTimes(SessionRevoked::class, 1);
    }
}
