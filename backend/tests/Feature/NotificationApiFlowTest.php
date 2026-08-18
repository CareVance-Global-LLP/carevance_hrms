<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class NotificationApiFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_notifications_publish_filter_and_read_flow(): void
    {
        $organization = Organization::create([
            'name' => 'Notifications Org',
            'slug' => 'notifications-org',
        ]);

        $otherOrganization = Organization::create([
            'name' => 'Other Notifications Org',
            'slug' => 'other-notifications-org',
        ]);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin.notifications@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager.notifications@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);

        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee.notifications@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $outsider = User::create([
            'name' => 'Outsider',
            'email' => 'outsider.notifications@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $otherOrganization->id,
        ]);

        $adminHeaders = $this->apiHeadersFor($admin);
        $employeeHeaders = $this->apiHeadersFor($employee);

        $this->postJson('/api/notifications/publish', [
            'type' => 'announcement',
            'title' => 'Deployment Notice',
            'message' => 'Production maintenance tonight.',
            'recipient_user_ids' => [$employee->id, $outsider->id],
        ], $adminHeaders)->assertCreated();

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'title' => 'Deployment Notice',
        ]);

        $this->assertDatabaseMissing('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $outsider->id,
            'title' => 'Deployment Notice',
        ]);

        $listResponse = $this->getJson('/api/notifications?unread_only=1&type=announcement&q=Deployment', $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('unread_count', 1)
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.meta.route', '/notifications');

        $notificationId = (int) $listResponse->json('data.0.id');
        $this->assertGreaterThan(0, $notificationId);

        $this->postJson("/api/notifications/{$notificationId}/read", [], $employeeHeaders)
            ->assertOk();

        $this->getJson('/api/notifications?unread_only=1', $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('unread_count', 0)
            ->assertJsonCount(0, 'data');

        $this->postJson('/api/notifications/publish', [
            'type' => 'news',
            'title' => 'Weekly Digest',
            'message' => 'Here is the weekly summary.',
        ], $adminHeaders)->assertCreated();

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            'title' => 'Weekly Digest',
        ]);

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $manager->id,
            'title' => 'Weekly Digest',
        ]);

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'title' => 'Weekly Digest',
        ]);

        AppNotification::create([
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'sender_id' => $admin->id,
            /*
             * The type ChatService actually emits.
             *
             * This said 'message', which the app has never produced and which
             * NotificationController's chat list therefore does not exclude —
             * so the fixture was not testing the exclusion at all, it was
             * creating an ordinary notification and expecting it to vanish.
             * The read-all call below already names the real types.
             */
            'type' => 'chat_direct_message',
            'title' => 'New message from Admin',
            'message' => 'Chat belongs in the chat area.',
            'meta' => ['route' => '/chat'],
            'is_read' => false,
        ]);

        /*
         * Chat notifications ARE returned unless the caller excludes them.
         *
         * This asserted the opposite — that the endpoint hides them by
         * default. It must not: Layout.tsx fetches one list and splits it into
         * a chat bucket and a general bucket client-side, so a server that
         * withheld chat rows would leave the chat bucket permanently empty.
         * The separation is the caller's to make, and the caller makes it.
         */
        $this->getJson('/api/notifications', $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('unread_count', 2)
            ->assertJsonFragment(['title' => 'New message from Admin']);

        // ...and excluding them is what actually keeps them out of the bell.
        $this->getJson('/api/notifications?'.http_build_query([
            'exclude_types' => ['chat_direct_message', 'chat_group_message'],
        ]), $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('unread_count', 1)
            ->assertJsonMissing(['title' => 'New message from Admin']);

        $this->postJson('/api/notifications/read-all', [
            'exclude_types' => ['chat_direct_message', 'chat_group_message'],
        ], $employeeHeaders)->assertOk();

        // Read-all excluded the chat types, so the chat message is still
        // unread — marking the bell read must not silently read your messages.
        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'type' => 'chat_direct_message',
            'is_read' => false,
        ]);

        // Unread, excluding chat: nothing left. The chat row above survives.
        $this->getJson('/api/notifications?'.http_build_query([
            'unread_only' => 1,
            'exclude_types' => ['chat_direct_message', 'chat_group_message'],
        ]), $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('unread_count', 0)
            ->assertJsonCount(0, 'data');

        $this->postJson('/api/notifications/read-all', [], $employeeHeaders)
            ->assertOk();

        $this->getJson('/api/notifications?unread_only=1', $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('unread_count', 0)
            ->assertJsonCount(0, 'data');

        $this->getJson('/api/notifications?unread_only=false', $employeeHeaders)
            ->assertOk();
    }

    public function test_employee_cannot_publish_notifications(): void
    {
        $organization = Organization::create([
            'name' => 'Notification Role Org',
            'slug' => 'notification-role-org',
        ]);

        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee.role.notifications@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $this->postJson('/api/notifications/publish', [
            'type' => 'announcement',
            'title' => 'Unauthorized Publish',
            'message' => 'This should be blocked.',
        ], $this->apiHeadersFor($employee))->assertForbidden();
    }
}
