<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\ExpoPushService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * A delivered message must never be reported to the sender as a failure.
 *
 * Observed in production: the device_tokens table was missing, so push dispatch
 * threw *after* the chat message and the in-app notification rows were already
 * committed — the message appeared in the thread *and* the composer showed
 * "Server error." That ordering is what these tests reproduce: the stub throws
 * where ExpoPushService does, not before sendToUsers() has done any work, so
 * the in-app row is asserted present rather than absent.
 *
 * The guard itself lives in AppNotificationService::sendToUsers(), which is why
 * ChatService no longer carries one of its own — see NotificationPushFailureTest
 * for the same guarantee at a non-chat caller.
 */
class ChatNotificationFailureTest extends TestCase
{
    use RefreshDatabase;

    public function test_direct_message_is_delivered_when_push_dispatch_throws(): void
    {
        [$sender, $recipient] = $this->twoColleagues('direct');

        $senderHeaders = $this->apiHeadersFor($sender);
        $conversationId = (int) $this->postJson('/api/chat/conversations', [
            'email' => $recipient->email,
        ], $senderHeaders)->assertCreated()->json('id');

        Log::spy();
        $this->bindThrowingPushService();

        $this->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'body' => 'Deploy is green',
        ], $senderHeaders)
            ->assertCreated()
            ->assertJsonPath('body', 'Deploy is green');

        $this->assertDatabaseHas('chat_messages', [
            'conversation_id' => $conversationId,
            'sender_id' => $sender->id,
            'body' => 'Deploy is green',
        ]);

        // Push is the only thing that failed. The in-app notification was
        // written before the throw and must still be there — the recipient
        // sees the message in the bell even with no working push provider.
        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $recipient->id,
            'type' => 'chat_direct_message',
            'title' => 'New message from Sender User',
        ]);

        $this->assertPushFailureLogged('chat_direct_message', (int) $recipient->id);
    }

    public function test_group_message_is_delivered_when_push_dispatch_throws(): void
    {
        [$sender, $member] = $this->twoColleagues('group');

        $senderHeaders = $this->apiHeadersFor($sender);
        $groupId = (int) $this->postJson('/api/chat/groups', [
            'name' => 'Release Crew',
            'user_ids' => [$member->id],
        ], $senderHeaders)->assertCreated()->json('id');

        Log::spy();
        $this->bindThrowingPushService();

        $this->postJson("/api/chat/groups/{$groupId}/messages", [
            'body' => 'Tagging the build',
        ], $senderHeaders)
            ->assertCreated()
            ->assertJsonPath('body', 'Tagging the build');

        $this->assertDatabaseHas('chat_group_messages', [
            'group_id' => $groupId,
            'sender_id' => $sender->id,
            'body' => 'Tagging the build',
        ]);

        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $member->id,
            'type' => 'chat_group_message',
        ]);

        $this->assertPushFailureLogged('chat_group_message', (int) $member->id);
    }

    private function assertPushFailureLogged(string $type, int $recipientId): void
    {
        Log::shouldHaveReceived('warning')
            ->withArgs(function ($message, $context) use ($type, $recipientId) {
                return $message === 'Push notification dispatch failed.'
                    && ($context['type'] ?? null) === $type
                    && ($context['recipient_user_ids'] ?? null) === [$recipientId]
                    && ($context['exception'] ?? null) === \RuntimeException::class
                    && str_contains((string) ($context['message'] ?? ''), 'device_tokens');
            })
            ->once();
    }

    /** @return array{0: User, 1: User} */
    private function twoColleagues(string $suffix): array
    {
        $organization = Organization::create([
            'name' => 'Notify Org '.$suffix,
            'slug' => 'notify-org-'.$suffix,
        ]);

        $sender = User::create([
            'name' => 'Sender User',
            'email' => "sender.{$suffix}@example.com",
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $recipient = User::create([
            'name' => 'Recipient User',
            'email' => "recipient.{$suffix}@example.com",
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        return [$sender, $recipient];
    }

    /**
     * Throws where the production failure did: inside push dispatch, after
     * AppNotificationService has already inserted the in-app rows.
     */
    private function bindThrowingPushService(): void
    {
        $this->app->bind(ExpoPushService::class, fn () => new class extends ExpoPushService {
            public function sendToUsers(iterable $users, string $title, string $body, array $data = []): void
            {
                throw new \RuntimeException('SQLSTATE[42S02]: Base table or view not found: device_tokens');
            }
        });
    }
}
