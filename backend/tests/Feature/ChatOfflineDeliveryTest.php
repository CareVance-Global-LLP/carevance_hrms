<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A message reaches somebody who was not there when it was sent.
 *
 * Delivery must never depend on the recipient having the tracker, the browser
 * or anything else open. The socket added for real-time notifications is
 * exactly the kind of change that can quietly introduce that dependency — an
 * event published to nobody looking like a message that was never sent — so
 * these pin the behaviour rather than trusting it.
 *
 * The rule: the ROW is the message. Everything else — socket, push, toast — is
 * an alert about a row that already exists and will still be there tomorrow.
 */
class ChatOfflineDeliveryTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $sender;
    private User $recipient;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'Offline Org',
            'slug' => 'offline-org',
        ]);

        $this->sender = User::create([
            'name' => 'Sender',
            'email' => 'sender.offline@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        // Never signed in, never seen: as offline as an account can be.
        $this->recipient = User::create([
            'name' => 'Recipient',
            'email' => 'recipient.offline@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
            'last_seen_at' => null,
        ]);
    }

    private function openConversation(): int
    {
        $response = $this->postJson(
            '/api/chat/conversations',
            ['email' => $this->recipient->email],
            $this->apiHeadersFor($this->sender)
        )->assertSuccessful()->json();

        return (int) ($response['id'] ?? $response['data']['id']);
    }

    public function test_a_message_to_someone_who_has_never_been_online_is_still_stored(): void
    {
        $conversationId = $this->openConversation();

        $this->postJson(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['body' => 'Are you there?'],
            $this->apiHeadersFor($this->sender)
        )->assertSuccessful();

        $this->assertDatabaseHas('chat_messages', [
            'conversation_id' => $conversationId,
            'sender_id' => $this->sender->id,
            'body' => 'Are you there?',
        ]);
    }

    public function test_the_offline_recipient_gets_a_notification_row_waiting_for_them(): void
    {
        $conversationId = $this->openConversation();

        $this->postJson(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['body' => 'Ping'],
            $this->apiHeadersFor($this->sender)
        )->assertSuccessful();

        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $this->recipient->id,
            'type' => 'chat_direct_message',
            'is_read' => false,
        ]);
    }

    /**
     * The whole point: they sign in later and it is all there.
     */
    public function test_the_message_is_waiting_when_they_finally_come_online(): void
    {
        $conversationId = $this->openConversation();

        foreach (['First', 'Second', 'Third'] as $body) {
            $this->postJson(
                '/api/chat/conversations/'.$conversationId.'/messages',
                ['body' => $body],
                $this->apiHeadersFor($this->sender)
            )->assertSuccessful();
        }

        $bodies = array_map(
            fn ($row) => $row['body'],
            $this->getJson('/api/chat/conversations/'.$conversationId.'/messages', $this->apiHeadersFor($this->recipient))
                ->assertOk()
                ->json()
        );

        $this->assertSame(['First', 'Second', 'Third'], $bodies);

        $unread = $this->getJson('/api/chat/unread-summary', $this->apiHeadersFor($this->recipient))
            ->assertOk()
            ->json('unread_messages');

        $this->assertSame(3, $unread);
    }

    /**
     * The regression this file mostly exists to prevent.
     *
     * If broadcasting is misconfigured, down, or simply has nobody subscribed,
     * the message must still be written. A transport failure turning into a
     * lost message would be far worse than the 30-second delay this whole
     * feature set replaced.
     */
    public function test_a_broken_realtime_transport_does_not_lose_the_message(): void
    {
        config(['broadcasting.default' => 'a-driver-that-does-not-exist']);

        $conversationId = $this->openConversation();

        $this->postJson(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['body' => 'Sent while the socket was broken'],
            $this->apiHeadersFor($this->sender)
        )->assertSuccessful();

        $this->assertDatabaseHas('chat_messages', [
            'conversation_id' => $conversationId,
            'body' => 'Sent while the socket was broken',
        ]);

        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $this->recipient->id,
            'type' => 'chat_direct_message',
        ]);
    }

    /**
     * Nor does a failing push service. Same principle, different side effect:
     * an Expo outage must not stop a message being stored.
     */
    public function test_a_message_is_stored_even_with_no_device_tokens_registered(): void
    {
        $conversationId = $this->openConversation();

        $this->assertDatabaseCount('device_tokens', 0);

        $this->postJson(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['body' => 'No devices anywhere'],
            $this->apiHeadersFor($this->sender)
        )->assertSuccessful();

        $this->assertDatabaseHas('chat_messages', ['body' => 'No devices anywhere']);
    }
}
