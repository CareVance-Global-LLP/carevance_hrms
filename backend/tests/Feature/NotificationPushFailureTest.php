<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\User;
use App\Services\AppNotificationService;
use App\Services\ExpoPushService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Push is a side effect of an in-app notification, never a precondition for one.
 *
 * AppNotificationService::sendToUsers() writes the app_notifications rows and
 * then hands the same payload to ExpoPushService. The production failure — a
 * missing device_tokens table — threw in the *second* step, after the rows were
 * already committed, so every one of the ~18 call sites turned a completed
 * write into a 500. The guard therefore belongs here, around the push dispatch,
 * not around each caller.
 *
 * Two things this deliberately does NOT swallow, and each has a test below:
 *  - a failed in-app insert, which is a real data problem;
 *  - anything thrown while composing the push payload, which is a bug in this
 *    method rather than a provider outage.
 */
class NotificationPushFailureTest extends TestCase
{
    use RefreshDatabase;

    public function test_in_app_rows_survive_a_push_dispatch_failure(): void
    {
        [$sender, $recipient] = $this->twoColleagues('service');

        Log::spy();
        $this->bindThrowingPushService();

        app(AppNotificationService::class)->sendToUsers(
            organizationId: (int) $sender->organization_id,
            userIds: Collection::make([(int) $recipient->id]),
            senderId: (int) $sender->id,
            type: 'announcement',
            title: 'Office closed Friday',
            message: 'Diwali holiday.',
        );

        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $recipient->id,
            'type' => 'announcement',
            'title' => 'Office closed Friday',
        ]);

        Log::shouldHaveReceived('warning')
            ->withArgs(function ($message, $context) use ($recipient) {
                return $message === 'Push notification dispatch failed.'
                    && ($context['type'] ?? null) === 'announcement'
                    && ($context['recipient_user_ids'] ?? null) === [$recipient->id]
                    && ($context['exception'] ?? null) === \RuntimeException::class
                    && str_contains((string) ($context['message'] ?? ''), 'device_tokens');
            })
            ->once();
    }

    /**
     * A non-chat caller, to prove the guard moved rather than being duplicated.
     * publish() shares nothing with ChatService except sendToUsers().
     */
    public function test_publish_endpoint_returns_201_when_push_dispatch_fails(): void
    {
        [$admin, $recipient] = $this->twoColleagues('publish');

        $this->bindThrowingPushService();

        $this->postJson('/api/notifications/publish', [
            'type' => 'announcement',
            'title' => 'Payroll released',
            'message' => 'August payslips are available.',
            'recipient_user_ids' => [$recipient->id],
        ], $this->apiHeadersFor($admin))
            ->assertCreated()
            ->assertJsonPath('broadcast_id', fn ($id) => is_string($id) && $id !== '');

        $this->assertDatabaseHas('app_notifications', [
            'user_id' => $recipient->id,
            'type' => 'announcement',
            'title' => 'Payroll released',
        ]);
    }

    /**
     * The opposite guarantee: a write that genuinely cannot land must still be
     * a 500. Guarding the whole block instead of the dispatch would hide it.
     */
    public function test_failed_in_app_insert_is_not_swallowed(): void
    {
        [$sender, $recipient] = $this->twoColleagues('insert');

        Schema::drop('app_notifications');

        $this->expectException(\Illuminate\Database\QueryException::class);

        app(AppNotificationService::class)->sendToUsers(
            organizationId: (int) $sender->organization_id,
            userIds: Collection::make([(int) $recipient->id]),
            senderId: (int) $sender->id,
            type: 'announcement',
            title: 'Never stored',
            message: 'The table is gone.',
        );
    }

    /**
     * Composing the payload happens once, before any write and outside the
     * guard. A closure-style guard wrapped around the argument expressions as
     * well as the call would downgrade this to a log line and report success.
     */
    public function test_push_payload_construction_failure_is_not_swallowed(): void
    {
        [$sender, $recipient] = $this->twoColleagues('payload');

        $this->bindThrowingPushService();

        $threw = false;

        try {
            app(AppNotificationService::class)->sendToUsers(
                organizationId: (int) $sender->organization_id,
                userIds: Collection::make([(int) $recipient->id]),
                senderId: (int) $sender->id,
                type: 'chat_direct_message',
                title: 'Broken meta',
                message: 'The route builder casts this to int.',
                // resolveMeta() runs sprintf('%d', (int) $meta['conversation_id'])
                // on this, which cannot cast an object.
                meta: ['conversation_id' => new \stdClass()],
            );
        } catch (\Throwable) {
            $threw = true;
        }

        $this->assertTrue($threw, 'A broken notification payload must not be swallowed.');

        // And it threw early enough that nothing half-formed was written.
        $this->assertSame(0, AppNotification::query()->count());
    }

    public function test_no_in_app_rows_means_no_push_attempt(): void
    {
        [$sender, $recipient] = $this->twoColleagues('optout');

        // Opting out of in-app notifications drops every row, so there is
        // nothing to push about either.
        $recipient->forceFill(['settings' => ['notifications' => ['in_app' => false]]])->save();

        $this->bindThrowingPushService();

        app(AppNotificationService::class)->sendToUsers(
            organizationId: (int) $sender->organization_id,
            userIds: Collection::make([(int) $recipient->id]),
            senderId: (int) $sender->id,
            type: 'announcement',
            title: 'Unheard',
            message: 'Nobody wants this.',
        );

        $this->assertSame(0, AppNotification::query()->count());
    }

    /** @return array{0: User, 1: User} */
    private function twoColleagues(string $suffix): array
    {
        $organization = Organization::create([
            'name' => 'Push Org '.$suffix,
            'slug' => 'push-org-'.$suffix,
        ]);

        $sender = User::create([
            'name' => 'Sender User',
            'email' => "push.sender.{$suffix}@example.com",
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $recipient = User::create([
            'name' => 'Recipient User',
            'email' => "push.recipient.{$suffix}@example.com",
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        return [$sender, $recipient];
    }

    /** Stand in for the missing device_tokens table the production failure came from. */
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
