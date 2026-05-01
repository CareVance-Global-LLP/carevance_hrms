<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ChatApiFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_direct_and_group_chat_flows_cover_unread_typing_and_access_controls(): void
    {
        $primaryOrg = Organization::create([
            'name' => 'Primary Org',
            'slug' => 'primary-org',
        ]);

        $otherOrg = Organization::create([
            'name' => 'Other Org',
            'slug' => 'other-org',
        ]);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin.chat@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $primaryOrg->id,
        ]);

        $employee = User::create([
            'name' => 'Employee User',
            'email' => 'employee.chat@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $primaryOrg->id,
        ]);

        $outsider = User::create([
            'name' => 'Outsider User',
            'email' => 'outsider.chat@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $otherOrg->id,
        ]);

        $adminHeaders = $this->apiHeadersFor($admin);
        $employeeHeaders = $this->apiHeadersFor($employee);
        $outsiderHeaders = $this->apiHeadersFor($outsider);

        $conversationResponse = $this->postJson('/api/chat/conversations', [
            'email' => $employee->email,
        ], $adminHeaders)
            ->assertCreated()
            ->assertJsonPath('other_user.id', $employee->id);

        $conversationId = (int) $conversationResponse->json('id');
        $this->assertGreaterThan(0, $conversationId);

        $directMessageId = (int) $this->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'body' => 'Daily sync complete',
        ], $adminHeaders)
            ->assertCreated()
            ->assertJsonPath('body', 'Daily sync complete')
            ->assertJsonPath('sender.id', $admin->id)
            ->json('id');

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $primaryOrg->id,
            'user_id' => $employee->id,
            'type' => 'chat_direct_message',
            'title' => 'New message from Admin User',
        ]);

        $directNotification = AppNotification::query()
            ->where('organization_id', $primaryOrg->id)
            ->where('user_id', $employee->id)
            ->where('type', 'chat_direct_message')
            ->latest('id')
            ->first();
        $this->assertNotNull($directNotification);
        $this->assertSame("/chat?threadType=direct&threadId={$conversationId}", data_get($directNotification?->meta, 'route'));

        $this->patchJson("/api/chat/conversations/{$conversationId}/messages/{$directMessageId}", [
            'body' => 'Daily sync completed and shared',
        ], $adminHeaders)
            ->assertOk()
            ->assertJsonPath('body', 'Daily sync completed and shared')
            ->assertJsonPath('is_edited', true);

        $this->postJson("/api/chat/conversations/{$conversationId}/messages/{$directMessageId}/reactions", [
            'emoji' => "\u{1F44D}",
        ], $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('reactions.0.emoji', "\u{1F44D}")
            ->assertJsonPath('reactions.0.count', 1)
            ->assertJsonPath('reactions.0.reacted_by_me', true);

        $this->postJson("/api/chat/conversations/{$conversationId}/messages/{$directMessageId}/reactions", [
            'emoji' => "\u{1F602}",
        ], $employeeHeaders)
            ->assertOk()
            ->assertJsonCount(1, 'reactions')
            ->assertJsonPath('reactions.0.emoji', "\u{1F602}")
            ->assertJsonPath('reactions.0.count', 1)
            ->assertJsonPath('reactions.0.reacted_by_me', true);

        $this->getJson('/api/chat/unread-summary', $employeeHeaders)
            ->assertOk()
            ->assertJson([
                'unread_messages' => 1,
                'unread_conversations' => 1,
                'unread_senders' => 1,
            ]);

        $this->getJson("/api/chat/conversations/{$conversationId}/messages", $employeeHeaders)
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.body', 'Daily sync completed and shared')
            ->assertJsonPath('0.is_edited', true)
            ->assertJsonCount(1, '0.reactions')
            ->assertJsonPath('0.reactions.0.emoji', "\u{1F602}")
            ->assertJsonPath('0.reactions.0.count', 1)
            ->assertJsonPath('0.reactions.0.reacted_by_me', true);

        $this->postJson("/api/chat/conversations/{$conversationId}/messages/{$directMessageId}/reactions", [
            'emoji' => "\u{1F602}",
        ], $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('reactions', []);

        $this->patchJson("/api/chat/conversations/{$conversationId}/messages/{$directMessageId}", [
            'body' => 'Employee should not edit admin message',
        ], $employeeHeaders)
            ->assertForbidden()
            ->assertJsonPath('message', 'You can only edit your own messages.');

        $this->deleteJson("/api/chat/conversations/{$conversationId}/messages/{$directMessageId}", [], $employeeHeaders)
            ->assertForbidden()
            ->assertJsonPath('message', 'You can only delete your own messages.');

        $this->deleteJson("/api/chat/conversations/{$conversationId}/messages/{$directMessageId}", [], $adminHeaders)
            ->assertOk()
            ->assertJsonPath('message', 'Message deleted.');

        $this->assertDatabaseMissing('chat_messages', [
            'id' => $directMessageId,
        ]);

        $this->postJson("/api/chat/conversations/{$conversationId}/typing", [
            'is_typing' => true,
        ], $employeeHeaders)->assertOk();

        $this->getJson("/api/chat/conversations/{$conversationId}/typing", $adminHeaders)
            ->assertOk()
            ->assertJsonFragment([
                'id' => $employee->id,
                'email' => $employee->email,
            ]);

        $this->postJson("/api/chat/conversations/{$conversationId}/read", [], $employeeHeaders)
            ->assertOk();

        $this->getJson('/api/chat/unread-summary', $employeeHeaders)
            ->assertOk()
            ->assertJson([
                'unread_messages' => 0,
                'unread_conversations' => 0,
                'unread_senders' => 0,
            ]);

        $this->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'body' => 'This should fail',
        ], $outsiderHeaders)->assertNotFound();

        $replacementDirectMessageId = (int) $this->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'body' => 'Replacement direct message',
        ], $adminHeaders)
            ->assertCreated()
            ->json('id');

        $this->postJson("/api/chat/conversations/{$conversationId}/read", [], $employeeHeaders)
            ->assertOk();

        $groupResponse = $this->postJson('/api/chat/groups', [
            'name' => 'Ops Team',
            'user_ids' => [$employee->id],
        ], $adminHeaders)->assertCreated();

        $groupId = (int) $groupResponse->json('id');
        $this->assertGreaterThan(0, $groupId);

        $groupMessageId = (int) $this->postJson("/api/chat/groups/{$groupId}/messages", [
            'body' => 'Group update',
        ], $adminHeaders)
            ->assertCreated()
            ->json('id');

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $primaryOrg->id,
            'user_id' => $employee->id,
            'type' => 'chat_group_message',
            'title' => 'Admin User sent a message in Ops Team',
        ]);

        $groupNotification = AppNotification::query()
            ->where('organization_id', $primaryOrg->id)
            ->where('user_id', $employee->id)
            ->where('type', 'chat_group_message')
            ->latest('id')
            ->first();
        $this->assertNotNull($groupNotification);
        $this->assertSame("/chat?threadType=group&threadId={$groupId}", data_get($groupNotification?->meta, 'route'));

        $this->patchJson("/api/chat/groups/{$groupId}/messages/{$groupMessageId}", [
            'body' => 'Updated group announcement',
        ], $adminHeaders)
            ->assertOk()
            ->assertJsonPath('body', 'Updated group announcement')
            ->assertJsonPath('is_edited', true);

        $this->postJson("/api/chat/groups/{$groupId}/messages/{$groupMessageId}/reactions", [
            'emoji' => "\u2764\uFE0F",
        ], $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('reactions.0.emoji', "\u2764\uFE0F")
            ->assertJsonPath('reactions.0.count', 1)
            ->assertJsonPath('reactions.0.reacted_by_me', true);

        $this->postJson("/api/chat/groups/{$groupId}/messages/{$groupMessageId}/reactions", [
            'emoji' => "\u{1F389}",
        ], $employeeHeaders)
            ->assertOk()
            ->assertJsonCount(1, 'reactions')
            ->assertJsonPath('reactions.0.emoji', "\u{1F389}")
            ->assertJsonPath('reactions.0.count', 1)
            ->assertJsonPath('reactions.0.reacted_by_me', true);

        $this->getJson('/api/chat/unread-summary', $employeeHeaders)
            ->assertOk()
            ->assertJson([
                'unread_messages' => 1,
                'unread_conversations' => 1,
                'unread_senders' => 1,
            ]);

        $this->postJson("/api/chat/groups/{$groupId}/read", [], $employeeHeaders)
            ->assertOk();

        $this->getJson('/api/chat/unread-summary', $employeeHeaders)
            ->assertOk()
            ->assertJson([
                'unread_messages' => 0,
                'unread_conversations' => 0,
                'unread_senders' => 0,
            ]);

        $this->getJson('/api/chat/groups', $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('0.id', $groupId)
            ->assertJsonPath('0.member_count', 2);

        $this->getJson("/api/chat/groups/{$groupId}/messages", $employeeHeaders)
            ->assertOk()
            ->assertJsonPath('0.body', 'Updated group announcement')
            ->assertJsonPath('0.is_edited', true)
            ->assertJsonCount(1, '0.reactions')
            ->assertJsonPath('0.reactions.0.emoji', "\u{1F389}")
            ->assertJsonPath('0.reactions.0.count', 1)
            ->assertJsonPath('0.reactions.0.reacted_by_me', true);

        $this->deleteJson("/api/chat/groups/{$groupId}/messages/{$groupMessageId}", [], $employeeHeaders)
            ->assertForbidden()
            ->assertJsonPath('message', 'You can only delete your own messages.');

        $this->deleteJson("/api/chat/groups/{$groupId}/messages/{$groupMessageId}", [], $adminHeaders)
            ->assertOk()
            ->assertJsonPath('message', 'Message deleted.');

        $this->assertDatabaseMissing('chat_group_messages', [
            'id' => $groupMessageId,
        ]);

        $this->getJson("/api/chat/conversations/{$conversationId}/messages", $employeeHeaders)
            ->assertOk()
            ->assertJsonCount(1)
            ->assertJsonPath('0.id', $replacementDirectMessageId);

        $this->postJson('/api/chat/groups', [
            'name' => 'Invalid Group',
            'user_ids' => [$outsider->id],
        ], $adminHeaders)
            ->assertStatus(422)
            ->assertJsonPath('message', 'All group members must belong to your organization.');
    }

    public function test_message_requires_body_or_attachment_and_rejects_blank_edits(): void
    {
        $organization = Organization::create([
            'name' => 'Chat Validation Org',
            'slug' => 'chat-validation-org',
        ]);

        $sender = User::create([
            'name' => 'Sender',
            'email' => 'sender.chat@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $receiver = User::create([
            'name' => 'Receiver',
            'email' => 'receiver.chat@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $senderHeaders = $this->apiHeadersFor($sender);

        $conversationId = (int) $this->postJson('/api/chat/conversations', [
            'email' => $receiver->email,
        ], $senderHeaders)
            ->assertCreated()
            ->json('id');

        $this->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'body' => '   ',
        ], $senderHeaders)
            ->assertStatus(422)
            ->assertJsonPath('message', 'Message or attachment is required.');

        $messageId = (int) $this->postJson("/api/chat/conversations/{$conversationId}/messages", [
            'body' => 'Editable',
        ], $senderHeaders)
            ->assertCreated()
            ->json('id');

        $this->patchJson("/api/chat/conversations/{$conversationId}/messages/{$messageId}", [
            'body' => '   ',
        ], $senderHeaders)
            ->assertStatus(422)
            ->assertJsonPath('errors.body.0', 'The body field is required.');
    }

    public function test_chat_attachments_reject_html_and_download_safe_files_as_attachments(): void
    {
        Storage::fake('chat_attachments');

        $organization = Organization::create([
            'name' => 'Chat Attachments Org',
            'slug' => 'chat-attachments-org',
        ]);

        $sender = User::create([
            'name' => 'Sender',
            'email' => 'sender.attachments@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $receiver = User::create([
            'name' => 'Receiver',
            'email' => 'receiver.attachments@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $senderHeaders = $this->apiHeadersFor($sender);
        $conversationId = (int) $this->postJson('/api/chat/conversations', [
            'email' => $receiver->email,
        ], $senderHeaders)
            ->assertCreated()
            ->json('id');

        $this->post("/api/chat/conversations/{$conversationId}/messages", [
            'attachment' => UploadedFile::fake()->createWithContent('xss.html', '<script>alert(1)</script>'),
        ], $senderHeaders)
            ->assertStatus(422)
            ->assertJsonPath('errors.attachment.0', 'The attachment field must be a file of type: application/pdf, text/plain, text/csv, application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/vnd.ms-excel, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, image/jpeg, image/png, image/webp.');

        $messageId = (int) $this->post("/api/chat/conversations/{$conversationId}/messages", [
            'attachment' => UploadedFile::fake()->createWithContent('Payroll Proof.txt', 'approved'),
        ], $senderHeaders)
            ->assertCreated()
            ->json('id');

        $this->get("/api/chat/messages/{$messageId}/attachment", $this->apiHeadersFor($receiver))
            ->assertOk()
            ->assertHeader('Content-Disposition', 'attachment; filename="payroll-proof.txt"')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
    }
}
