<?php

namespace Tests\Feature;

use App\Events\NotificationCreated;
use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use App\Services\AppNotificationService;
use Tests\TestCase;

/**
 * Real-time delivery, and the ways it can quietly go wrong.
 *
 * The recurring theme: a broadcast must never disagree with the rows that were
 * written. If it reaches somebody who has no row, that is a leak; if it misses
 * somebody who has one, that person waits for the fallback poll and the
 * feature did nothing for them.
 */
class NotificationBroadcastTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'Broadcast Org',
            'slug' => 'broadcast-org',
        ]);
    }

    private function makeUser(string $email, array $settings = null, string $role = 'employee'): User
    {
        return User::create([
            'name' => 'User '.$email,
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
            'settings' => $settings,
        ]);
    }

    private function service(): AppNotificationService
    {
        return app(AppNotificationService::class);
    }

    public function test_a_notification_broadcasts_to_every_recipients_own_private_channel(): void
    {
        Event::fake([NotificationCreated::class]);

        $first = $this->makeUser('first.broadcast@example.com');
        $second = $this->makeUser('second.broadcast@example.com');

        $this->service()->sendToUsers(
            organizationId: (int) $this->organization->id,
            userIds: collect([$first->id, $second->id]),
            senderId: null,
            type: 'announcement',
            title: 'Fire drill',
            message: 'At 3pm',
        );

        Event::assertDispatched(NotificationCreated::class, function (NotificationCreated $event) use ($first, $second) {
            $channels = array_map(
                fn (PrivateChannel $channel) => (string) $channel,
                $event->broadcastOn()
            );

            sort($channels);
            $expected = ['private-user.'.$first->id, 'private-user.'.$second->id];
            sort($expected);

            return $channels === $expected;
        });
    }

    /**
     * The preference filter is the one thing a bolted-on broadcast usually
     * forgets: the rows respect it and the broadcast does not, so a muted user
     * stops getting the row and starts getting a live toast instead.
     */
    public function test_a_muted_recipient_receives_neither_a_row_nor_a_broadcast(): void
    {
        Event::fake([NotificationCreated::class]);

        $listening = $this->makeUser('listening.broadcast@example.com');
        $muted = $this->makeUser('muted.broadcast@example.com', [
            'notifications' => ['chat_messages' => false],
        ]);

        $this->service()->sendToUsers(
            organizationId: (int) $this->organization->id,
            userIds: collect([$listening->id, $muted->id]),
            senderId: null,
            type: 'chat_direct_message',
            title: 'New message',
            message: 'Hello',
        );

        $this->assertDatabaseHas('app_notifications', ['user_id' => $listening->id]);
        $this->assertDatabaseMissing('app_notifications', ['user_id' => $muted->id]);

        Event::assertDispatched(NotificationCreated::class, function (NotificationCreated $event) use ($listening, $muted) {
            return in_array((int) $listening->id, $event->recipientUserIds, true)
                && ! in_array((int) $muted->id, $event->recipientUserIds, true);
        });
    }

    public function test_no_broadcast_is_dispatched_when_every_recipient_is_muted(): void
    {
        Event::fake([NotificationCreated::class]);

        $muted = $this->makeUser('allmuted.broadcast@example.com', [
            'notifications' => ['in_app' => false],
        ]);

        $this->service()->sendToUsers(
            organizationId: (int) $this->organization->id,
            userIds: collect([$muted->id]),
            senderId: null,
            type: 'announcement',
            title: 'Nobody hears this',
            message: 'At all',
        );

        $this->assertDatabaseCount('app_notifications', 0);
        Event::assertNotDispatched(NotificationCreated::class);
    }

    /**
     * broadcast_id used to be set only by the publish endpoint, so chat and
     * every service-originated notification stored null. Real-time delivery
     * needs it on every publish: it is the only key that is identical across
     * all recipients, which is what lets one batched publish serve everybody
     * and lets mobile match a socket delivery against its Expo push.
     */
    public function test_a_broadcast_id_is_minted_when_the_caller_supplies_none(): void
    {
        Event::fake([NotificationCreated::class]);

        $user = $this->makeUser('minted.broadcast@example.com');

        $this->service()->sendToUsers(
            organizationId: (int) $this->organization->id,
            userIds: collect([$user->id]),
            senderId: null,
            type: 'chat_direct_message',
            title: 'New message',
            message: 'Hello',
        );

        $row = AppNotification::withoutOrganizationScope()->where('user_id', $user->id)->firstOrFail();

        $this->assertNotNull($row->broadcast_id, 'Every publish should carry a broadcast_id.');

        Event::assertDispatched(
            NotificationCreated::class,
            fn (NotificationCreated $event) => $event->broadcastId === $row->broadcast_id
        );
    }

    public function test_a_supplied_broadcast_id_is_preserved(): void
    {
        Event::fake([NotificationCreated::class]);

        $user = $this->makeUser('supplied.broadcast@example.com');

        $this->service()->sendToUsers(
            organizationId: (int) $this->organization->id,
            userIds: collect([$user->id]),
            senderId: null,
            type: 'announcement',
            title: 'Known id',
            message: 'Body',
            broadcastId: 'a-known-broadcast-id',
        );

        Event::assertDispatched(
            NotificationCreated::class,
            fn (NotificationCreated $event) => $event->broadcastId === 'a-known-broadcast-id'
        );
    }

    /**
     * The rows are already committed by the time the broadcast runs. A
     * transport misconfiguration — no Reverb, bad credentials, a bad driver
     * after a deploy — must not turn a completed write into a 500 at every
     * caller. The client's catch-up covers a dropped broadcast; nothing covers
     * a 500 on a notification that was already stored.
     */
    public function test_a_broadcasting_failure_does_not_fail_the_notification_write(): void
    {
        config(['broadcasting.default' => 'a-driver-that-does-not-exist']);

        $user = $this->makeUser('resilient.broadcast@example.com');

        $this->service()->sendToUsers(
            organizationId: (int) $this->organization->id,
            userIds: collect([$user->id]),
            senderId: null,
            type: 'announcement',
            title: 'Still stored',
            message: 'Even with broadcasting broken',
        );

        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $user->id,
            'title' => 'Still stored',
        ]);
    }

    public function test_the_event_payload_carries_no_per_recipient_identifiers(): void
    {
        Event::fake([NotificationCreated::class]);

        $first = $this->makeUser('payload.one@example.com');
        $second = $this->makeUser('payload.two@example.com');

        $this->service()->sendToUsers(
            organizationId: (int) $this->organization->id,
            userIds: collect([$first->id, $second->id]),
            senderId: null,
            type: 'announcement',
            title: 'Shared',
            message: 'Body',
        );

        Event::assertDispatched(NotificationCreated::class, function (NotificationCreated $event) {
            $payload = $event->broadcastWith();

            // Only what is identical for every recipient. A user_id => row_id
            // map would hand each recipient the others' notification ids.
            return array_keys($payload) === ['broadcast_id', 'type']
                && $payload['type'] === 'announcement';
        });
    }
}
