<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Chat\AttachmentPresenter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * What an attachment looks like before you open it.
 *
 * Chat notifications said "Sent an attachment" for everything, so a photo, a
 * payslip and a 40 MB archive were indistinguishable and the only way to find
 * out what somebody sent was to open the app — the opposite of a notification's
 * purpose.
 */
class ChatAttachmentPreviewTest extends TestCase
{
    use RefreshDatabase;

    private function presenter(): AttachmentPresenter
    {
        return app(AttachmentPresenter::class);
    }

    // ------------------------------------------------------------ the summary

    /**
     * A caption always wins.
     *
     * If the sender typed something, that IS the message — replacing it with
     * "Photo" would discard the actual content in favour of a label we made up.
     */
    public function test_a_caption_outranks_the_generated_label(): void
    {
        $this->assertSame(
            '📷 Here is the signed form',
            $this->presenter()->summary('Here is the signed form', 'IMG_20260824.jpg', 'image/jpeg')
        );
    }

    /**
     * Media is labelled, not named: "IMG_20260824_113045.jpg" tells a reader
     * nothing that "Photo" does not.
     */
    public function test_media_without_a_caption_is_labelled_by_kind(): void
    {
        $presenter = $this->presenter();

        $this->assertSame('📷 Photo', $presenter->summary('', 'IMG_20260824_113045.jpg', 'image/jpeg'));
        $this->assertSame('🎥 Video', $presenter->summary(null, 'VID_0091.mp4', 'video/mp4'));
        $this->assertSame('🎵 Audio', $presenter->summary('', 'rec.m4a', 'audio/mp4'));
    }

    /**
     * A document is named, because the name is the useful part: knowing it is
     * "invoice-March.pdf" decides whether you open it now.
     */
    public function test_a_document_without_a_caption_shows_its_filename(): void
    {
        $this->assertSame(
            '📄 invoice-March.pdf',
            $this->presenter()->summary('', 'invoice-March.pdf', 'application/pdf')
        );
    }

    public function test_an_archive_is_recognised_as_its_own_kind(): void
    {
        $presenter = $this->presenter();

        $this->assertSame(AttachmentPresenter::KIND_ARCHIVE, $presenter->kind('application/zip'));
        $this->assertSame('🗜️ logs.zip', $presenter->summary(null, 'logs.zip', 'application/zip'));
    }

    public function test_an_unknown_type_degrades_to_document_rather_than_failing(): void
    {
        $presenter = $this->presenter();

        $this->assertSame(AttachmentPresenter::KIND_DOCUMENT, $presenter->kind('application/x-who-knows'));
        $this->assertSame('📄 mystery.bin', $presenter->summary('', 'mystery.bin', 'application/x-who-knows'));
    }

    public function test_only_images_claim_a_thumbnail(): void
    {
        $presenter = $this->presenter();

        $this->assertTrue($presenter->hasThumbnail('image/png'));
        $this->assertFalse($presenter->hasThumbnail('application/pdf'));
        $this->assertFalse($presenter->hasThumbnail('video/mp4'));
    }

    // ------------------------------------------------- end to end over the API

    private function seedPair(): array
    {
        $organization = Organization::create(['name' => 'Preview Org', 'slug' => 'preview-org']);

        $sender = User::create([
            'name' => 'Sender', 'email' => 'sender.preview@example.com',
            'password' => Hash::make('password123'), 'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $recipient = User::create([
            'name' => 'Recipient', 'email' => 'recipient.preview@example.com',
            'password' => Hash::make('password123'), 'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $conversation = $this->postJson('/api/chat/conversations', ['email' => $recipient->email], $this->apiHeadersFor($sender))
            ->assertSuccessful()->json();

        return [$sender, $recipient, (int) ($conversation['id'] ?? $conversation['data']['id'])];
    }

    public function test_a_photo_notification_carries_a_preview_summary_and_metadata(): void
    {
        Storage::fake('chat_attachments');
        [$sender, $recipient, $conversationId] = $this->seedPair();

        $this->post(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['attachment' => UploadedFile::fake()->image('holiday.jpg', 40, 40)],
            $this->apiHeadersFor($sender)
        )->assertSuccessful();

        $notification = \App\Models\AppNotification::where('user_id', $recipient->id)->latest('id')->firstOrFail();

        $this->assertSame('📷 Photo', $notification->message, 'The old text was "Sent an attachment".');
        $this->assertSame('photo', $notification->meta['attachment']['kind']);
        $this->assertSame('holiday.jpg', $notification->meta['attachment']['name']);
        $this->assertTrue($notification->meta['attachment']['has_thumbnail']);
        $this->assertSame('direct', $notification->meta['attachment']['thread']);
    }

    public function test_a_message_without_an_attachment_is_unchanged(): void
    {
        [$sender, $recipient, $conversationId] = $this->seedPair();

        $this->postJson(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['body' => 'Just words'],
            $this->apiHeadersFor($sender)
        )->assertSuccessful();

        $notification = \App\Models\AppNotification::where('user_id', $recipient->id)->latest('id')->firstOrFail();

        $this->assertSame('Just words', $notification->message);
        $this->assertArrayNotHasKey('attachment', $notification->meta ?? []);
    }

    public function test_the_thumbnail_renders_a_square_jpeg(): void
    {
        Storage::fake('chat_attachments');
        [$sender, $recipient, $conversationId] = $this->seedPair();

        $message = $this->post(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['attachment' => UploadedFile::fake()->image('wide.jpg', 400, 100)],
            $this->apiHeadersFor($sender)
        )->assertSuccessful()->json();

        $messageId = $message['id'] ?? $message['data']['id'];

        $response = $this->get('/api/chat/messages/'.$messageId.'/thumbnail', $this->apiHeadersFor($recipient))
            ->assertOk();

        $this->assertSame('image/jpeg', $response->headers->get('Content-Type'));
        // Rendered, not downloaded.
        $this->assertStringContainsString('inline', (string) $response->headers->get('Content-Disposition'));
    }

    /**
     * A preview is still the content. It cannot be less protected than the
     * file it previews.
     *
     * Two different refusals, and the difference is deliberate:
     *
     * - Another TENANT gets 404. ChatMessage carries the organization scope, so
     *   the row is not visible at all — and answering 403 would confirm that a
     *   message with that id exists, which is more than a stranger should learn.
     * - A colleague in the SAME tenant who is not in the conversation gets 403.
     *   The row is visible to the scope; membership is what refuses them.
     */
    public function test_another_tenant_cannot_even_see_that_the_message_exists(): void
    {
        Storage::fake('chat_attachments');
        [$sender, , $conversationId] = $this->seedPair();

        $outsider = User::create([
            'name' => 'Outsider', 'email' => 'outsider.preview@example.com',
            'password' => Hash::make('password123'), 'role' => 'employee',
            'organization_id' => Organization::create(['name' => 'Other', 'slug' => 'other-preview'])->id,
        ]);

        $message = $this->post(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['attachment' => UploadedFile::fake()->image('private.jpg', 40, 40)],
            $this->apiHeadersFor($sender)
        )->assertSuccessful()->json();

        $messageId = $message['id'] ?? $message['data']['id'];

        $this->get('/api/chat/messages/'.$messageId.'/thumbnail', $this->apiHeadersFor($outsider))
            ->assertNotFound();
    }

    public function test_a_colleague_outside_the_conversation_is_refused(): void
    {
        Storage::fake('chat_attachments');
        [$sender, $recipient, $conversationId] = $this->seedPair();

        $colleague = User::create([
            'name' => 'Colleague', 'email' => 'colleague.preview@example.com',
            'password' => Hash::make('password123'), 'role' => 'employee',
            'organization_id' => $sender->organization_id,
        ]);

        $message = $this->post(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['attachment' => UploadedFile::fake()->image('private.jpg', 40, 40)],
            $this->apiHeadersFor($sender)
        )->assertSuccessful()->json();

        $messageId = $message['id'] ?? $message['data']['id'];

        $this->get('/api/chat/messages/'.$messageId.'/thumbnail', $this->apiHeadersFor($colleague))
            ->assertForbidden();
    }

    /**
     * Not an error — a PDF simply has no preview, and the client falls back to
     * an icon. Answering 500 here would make an ordinary case look broken.
     */
    public function test_a_non_image_attachment_reports_no_preview_rather_than_failing(): void
    {
        Storage::fake('chat_attachments');
        [$sender, $recipient, $conversationId] = $this->seedPair();

        $message = $this->post(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['attachment' => UploadedFile::fake()->create('report.pdf', 8, 'application/pdf')],
            $this->apiHeadersFor($sender)
        )->assertSuccessful()->json();

        $messageId = $message['id'] ?? $message['data']['id'];

        $this->get('/api/chat/messages/'.$messageId.'/thumbnail', $this->apiHeadersFor($recipient))
            ->assertNotFound();
    }
}
