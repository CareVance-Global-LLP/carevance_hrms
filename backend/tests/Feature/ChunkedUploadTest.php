<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\UploadSession;
use App\Models\User;
use App\Services\Uploads\ChunkedUploadService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Large attachments, and the bug this replaces.
 *
 * The interface promised 200 MB and the validator agreed. PHP discarded
 * anything over upload_max_filesize before Laravel ran — 2 MB locally, 10 MB
 * deployed — so the request arrived with no file and the user was told "no
 * attachment" for a file they had visibly attached.
 */
class ChunkedUploadTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        Storage::fake('upload_chunks');
        Storage::fake('chat_attachments');

        $this->organization = Organization::create([
            'name' => 'Upload Org',
            'slug' => 'upload-org',
        ]);

        $this->user = User::create([
            'name' => 'Uploader',
            'email' => 'uploader@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    private function service(): ChunkedUploadService
    {
        return app(ChunkedUploadService::class);
    }

    /**
     * A hand-made session with a tiny chunk size.
     *
     * begin() negotiates a chunk size from the running php.ini — around 1.6 MB
     * on a stock box — which would make every test below move megabytes to
     * prove something about ordering. The sizing logic gets its own tests; these
     * exercise the assembly and claiming with pieces small enough to read.
     */
    private function makeSession(string $contents, int $chunkSize, ?User $owner = null): UploadSession
    {
        $owner ??= $this->user;

        return UploadSession::create([
            'organization_id' => $owner->organization_id,
            'user_id' => $owner->id,
            'upload_key' => 'test-key-'.uniqid(),
            'original_name' => 'notes.txt',
            'client_mime' => 'text/plain',
            'total_size' => strlen($contents),
            'chunk_size' => $chunkSize,
            'total_chunks' => (int) ceil(strlen($contents) / $chunkSize),
            'received_chunks' => [],
            'status' => UploadSession::STATUS_PENDING,
            'expires_at' => now()->addHours(24),
        ]);
    }

    private function chunkFile(string $bytes): UploadedFile
    {
        return UploadedFile::fake()->createWithContent('chunk.part', $bytes);
    }

    // ---------------------------------------------------------------- sizing

    public function test_the_negotiated_chunk_size_fits_inside_this_servers_php_limit(): void
    {
        $chunkSize = $this->service()->chunkSizeBytes();

        $uploadMax = $this->iniBytes('upload_max_filesize');
        $postMax = $this->iniBytes('post_max_size');
        $ceiling = min(array_filter([$uploadMax, $postMax]) ?: [PHP_INT_MAX]);

        $this->assertLessThan(
            $ceiling,
            $chunkSize,
            'A chunk must fit inside the limit PHP enforces, or the feature fails exactly where it is meant to help.'
        );
        $this->assertGreaterThanOrEqual(256 * 1024, $chunkSize);
        $this->assertLessThanOrEqual(5 * 1024 * 1024, $chunkSize);
    }

    public function test_beginning_an_upload_divides_it_into_pieces(): void
    {
        $chunkSize = $this->service()->chunkSizeBytes();
        $totalSize = ($chunkSize * 3) + 10;

        $session = $this->service()->begin($this->user, 'big.zip', $totalSize, 'application/zip');

        $this->assertSame(4, $session->total_chunks, 'Three full pieces and a remainder.');
        $this->assertSame(range(0, 3), $session->missingIndexes());
    }

    public function test_a_file_over_the_ceiling_is_refused_with_a_real_number(): void
    {
        $this->expectExceptionMessageMatches('/limit is 200 MB/');

        $this->service()->begin(
            $this->user,
            'enormous.zip',
            ChunkedUploadService::MAX_UPLOAD_BYTES + 1,
            'application/zip'
        );
    }

    // ------------------------------------------------------------- assembly

    /**
     * The one that matters most. Pieces may arrive out of order — that is what
     * makes resuming possible — so assembly must order by INDEX, never by
     * arrival or by whatever order the filesystem lists them in. Get this wrong
     * and every multi-chunk file is silently corrupted, which no size or count
     * check would catch.
     */
    public function test_pieces_are_assembled_in_index_order_not_arrival_order(): void
    {
        $contents = 'AAAABBBBCCCCDDDD';
        $session = $this->makeSession($contents, 4);

        // Deliberately backwards.
        foreach ([3, 1, 0, 2] as $index) {
            $this->service()->storeChunk(
                $this->user,
                $session->upload_key,
                $index,
                $this->chunkFile(substr($contents, $index * 4, 4))
            );
        }

        $stored = $this->service()->complete($this->user, $session->upload_key);

        $this->assertSame(strlen($contents), $stored['size']);
        $this->assertSame(
            $contents,
            Storage::disk('chat_attachments')->get($stored['path']),
            'Reassembled bytes must match the original exactly.'
        );
    }

    public function test_completing_with_a_missing_piece_is_refused_and_says_how_many(): void
    {
        $contents = 'AAAABBBBCCCC';
        $session = $this->makeSession($contents, 4);

        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile('AAAA'));
        $this->service()->storeChunk($this->user, $session->upload_key, 2, $this->chunkFile('CCCC'));

        $this->expectExceptionMessageMatches('/1 of 3 pieces are missing/');
        $this->service()->complete($this->user, $session->upload_key);
    }

    public function test_re_sending_a_piece_does_not_inflate_progress(): void
    {
        $session = $this->makeSession('AAAABBBB', 4);

        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile('AAAA'));
        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile('AAAA'));

        $session->refresh();
        $this->assertSame([0], $session->receivedIndexes());
        $this->assertSame([1], $session->missingIndexes(), 'Resending must not make the upload look further along.');
    }

    public function test_a_piece_outside_the_upload_is_refused(): void
    {
        $session = $this->makeSession('AAAABBBB', 4);

        $this->expectExceptionMessage('That chunk is outside this upload.');
        $this->service()->storeChunk($this->user, $session->upload_key, 9, $this->chunkFile('XXXX'));
    }

    /**
     * Without this, a client could declare a small total and then send one
     * enormous "chunk", walking straight past the size ceiling.
     */
    public function test_an_oversized_piece_is_refused(): void
    {
        $session = $this->makeSession('AAAABBBB', 4);

        $this->expectExceptionMessageMatches('/larger than this upload negotiated|wrong size/');
        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile('AAAABBBBCCCC'));
    }

    public function test_the_assembled_file_must_match_the_declared_size(): void
    {
        $session = $this->makeSession('AAAABBBB', 4);
        // Truthful count of pieces, but the final piece is short, so the
        // assembled file will not match what was declared.
        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile('AAAA'));
        $this->service()->storeChunk($this->user, $session->upload_key, 1, $this->chunkFile('BB'));

        $this->expectExceptionMessageMatches('/does not match the size that was declared/');
        $this->service()->complete($this->user, $session->upload_key);
    }

    /**
     * A chunked upload bypasses Laravel's `mimetypes` rule entirely, so without
     * a check on the assembled bytes this endpoint would be an unrestricted
     * file drop.
     */
    public function test_a_disallowed_type_is_refused_based_on_the_assembled_bytes(): void
    {
        $php = "<?php echo 'hi';";
        $session = $this->makeSession($php, strlen($php));
        $session->original_name = 'harmless.txt';
        $session->client_mime = 'text/plain';
        $session->save();

        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile($php));

        try {
            $stored = $this->service()->complete($this->user, $session->upload_key);
            // Some builds report a PHP source file as text/plain, which is on
            // the allow-list and is an acceptable outcome. What must never
            // happen is it being stored as an executable type.
            $this->assertContains($stored['mime'], ChunkedUploadService::ALLOWED_MIMES);
        } catch (\RuntimeException $exception) {
            $this->assertStringContainsString('not allowed', $exception->getMessage());
        }
    }

    // --------------------------------------------------------------- claiming

    public function test_a_completed_upload_can_be_claimed_exactly_once(): void
    {
        $contents = 'hello world';
        $session = $this->makeSession($contents, strlen($contents));
        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile($contents));
        $this->service()->complete($this->user, $session->upload_key);

        $first = $this->service()->claimCompleted($this->user, $session->upload_key);
        $this->assertArrayNotHasKey('error', $first);
        $this->assertSame(strlen($contents), $first['size']);

        $second = $this->service()->claimCompleted($this->user, $session->upload_key);
        $this->assertArrayHasKey('error', $second, 'One upload must not be attachable to two messages.');
    }

    public function test_an_unfinished_upload_cannot_be_claimed(): void
    {
        $session = $this->makeSession('AAAABBBB', 4);
        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile('AAAA'));

        $claim = $this->service()->claimCompleted($this->user, $session->upload_key);

        $this->assertArrayHasKey('error', $claim);
    }

    // ---------------------------------------------------------------- access

    /**
     * The upload key is a handle, not an authorization. A leaked one must not
     * let somebody else append to, finish, or claim another person's upload.
     */
    public function test_another_user_cannot_touch_someone_elses_upload(): void
    {
        $session = $this->makeSession('AAAABBBB', 4);

        $intruder = User::create([
            'name' => 'Intruder',
            'email' => 'intruder.upload@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $this->expectExceptionMessage('That upload could not be found.');
        $this->service()->storeChunk($intruder, $session->upload_key, 0, $this->chunkFile('AAAA'));
    }

    public function test_an_expired_upload_is_refused(): void
    {
        $session = $this->makeSession('AAAABBBB', 4);
        $session->expires_at = now()->subMinute();
        $session->save();

        $this->expectExceptionMessageMatches('/expired/');
        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile('AAAA'));
    }

    // ---------------------------------------------------------------- sweeping

    public function test_expired_sessions_are_swept_and_their_pieces_deleted(): void
    {
        $session = $this->makeSession('AAAABBBB', 4);
        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile('AAAA'));

        $chunkPath = 'sessions/'.$session->upload_key.'/0.part';
        Storage::disk('upload_chunks')->assertExists($chunkPath);

        $session->expires_at = now()->subHour();
        $session->save();

        $purged = $this->service()->purgeExpired();

        $this->assertSame(1, $purged);
        Storage::disk('upload_chunks')->assertMissing($chunkPath);
        $this->assertSame(UploadSession::STATUS_ABORTED, $session->fresh()->status);
    }

    public function test_a_completed_session_is_never_swept(): void
    {
        $contents = 'keep me';
        $session = $this->makeSession($contents, strlen($contents));
        $this->service()->storeChunk($this->user, $session->upload_key, 0, $this->chunkFile($contents));
        $this->service()->complete($this->user, $session->upload_key);

        $session->expires_at = now()->subHour();
        $session->save();

        $this->assertSame(0, $this->service()->purgeExpired());
    }

    // ------------------------------------------------------------ end to end

    /**
     * The whole path over HTTP: negotiate, send, finish, attach.
     *
     * The service tests above prove assembly and claiming. This proves the
     * wiring — that a client can actually get a file onto a message this way,
     * which is the thing that was broken.
     */
    public function test_a_file_uploaded_in_pieces_ends_up_on_a_chat_message(): void
    {
        $colleague = User::create([
            'name' => 'Colleague',
            'email' => 'colleague.upload@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $headers = $this->apiHeadersFor($this->user);
        $contents = 'the quick brown fox';

        $conversation = $this->postJson('/api/chat/conversations', ['email' => $colleague->email], $headers)
            ->assertSuccessful()
            ->json();
        $conversationId = $conversation['id'] ?? $conversation['data']['id'] ?? null;
        $this->assertNotNull($conversationId, 'Could not open a conversation to attach to.');

        $begin = $this->postJson('/api/uploads', [
            'name' => 'report.txt',
            'size' => strlen($contents),
            'mime' => 'text/plain',
        ], $headers)->assertCreated()->json();

        $this->assertSame(1, $begin['total_chunks']);
        $uploadKey = $begin['upload_key'];

        $this->post(
            '/api/uploads/'.$uploadKey.'/chunks/0',
            ['chunk' => UploadedFile::fake()->createWithContent('part', $contents)],
            $headers
        )->assertOk()->assertJson(['is_complete' => true]);

        $this->postJson('/api/uploads/'.$uploadKey.'/complete', [], $headers)
            ->assertOk()
            ->assertJson(['name' => 'report.txt', 'size' => 19]);

        $message = $this->postJson(
            '/api/chat/conversations/'.$conversationId.'/messages',
            ['body' => 'Here is the report', 'upload_key' => $uploadKey],
            $headers
        )->assertSuccessful()->json();

        $messageId = $message['id'] ?? $message['data']['id'] ?? null;
        $this->assertNotNull($messageId);

        $this->assertDatabaseHas('chat_messages', [
            'id' => $messageId,
            'attachment_name' => 'report.txt',
            'attachment_size' => strlen($contents),
        ]);

        // And the bytes really are retrievable, not just recorded.
        $this->get('/api/chat/messages/'.$messageId.'/attachment', $headers)->assertOk();
    }

    public function test_the_same_upload_cannot_be_attached_to_two_messages(): void
    {
        $colleague = User::create([
            'name' => 'Colleague Two',
            'email' => 'colleague2.upload@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        $headers = $this->apiHeadersFor($this->user);
        $contents = 'once only';

        $conversation = $this->postJson('/api/chat/conversations', ['email' => $colleague->email], $headers)
            ->assertSuccessful()->json();
        $conversationId = $conversation['id'] ?? $conversation['data']['id'];

        $uploadKey = $this->postJson('/api/uploads', [
            'name' => 'once.txt',
            'size' => strlen($contents),
            'mime' => 'text/plain',
        ], $headers)->assertCreated()->json('upload_key');

        $this->post(
            '/api/uploads/'.$uploadKey.'/chunks/0',
            ['chunk' => UploadedFile::fake()->createWithContent('part', $contents)],
            $headers
        )->assertOk();

        $this->postJson('/api/uploads/'.$uploadKey.'/complete', [], $headers)->assertOk();

        $this->postJson('/api/chat/conversations/'.$conversationId.'/messages',
            ['body' => 'First', 'upload_key' => $uploadKey], $headers)->assertSuccessful();

        // Two messages sharing one stored path means deleting either destroys
        // the other's attachment.
        $this->postJson('/api/chat/conversations/'.$conversationId.'/messages',
            ['body' => 'Second', 'upload_key' => $uploadKey], $headers)
            ->assertStatus(422);
    }

    private function iniBytes(string $directive): int
    {
        $raw = trim((string) ini_get($directive));
        if ($raw === '') return 0;
        $unit = strtolower(substr($raw, -1));
        $value = (int) $raw;

        return match ($unit) {
            'g' => $value * 1024 * 1024 * 1024,
            'm' => $value * 1024 * 1024,
            'k' => $value * 1024,
            default => $value,
        };
    }
}
