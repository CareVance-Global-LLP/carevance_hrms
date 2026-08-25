<?php

namespace App\Services\Uploads;

use App\Models\UploadSession;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * Large attachments, delivered in pieces.
 *
 * The problem this replaces: the interface offered 200 MB, the validator
 * agreed with `max:204800`, and PHP silently discarded anything over
 * upload_max_filesize — 2 MB on a stock dev box, 10 MB in production — BEFORE
 * Laravel ran. The request arrived with an empty files array, so the user was
 * told "no attachment" for a file they had visibly attached.
 *
 * Chunking does not raise that ceiling, it stops it mattering: no individual
 * request is ever large. Two consequences worth stating, because they are the
 * reason to prefer this over simply editing php.ini:
 *
 * - It works on a deployment nobody reconfigured. The server reports its own
 *   safe chunk size from its own ini, so the client sizes pieces to fit
 *   whatever it is talking to.
 * - A dropped connection resumes instead of restarting. At 2 MB nobody cares;
 *   at 200 MB over hotel Wi-Fi, restarting from zero means the upload never
 *   finishes at all.
 */
class ChunkedUploadService
{
    /**
     * The ceiling the product actually promises.
     *
     * Unlike the old one, this is enforceable: it is checked when the session
     * opens, again as bytes land, and finally against the assembled file.
     */
    public const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

    /** Never ask a client for pieces smaller than this; the overhead dominates. */
    private const MIN_CHUNK_BYTES = 256 * 1024;

    /** Nor larger — a bigger piece is a bigger thing to re-send on failure. */
    private const MAX_CHUNK_BYTES = 5 * 1024 * 1024;

    private const CHUNK_DISK = 'upload_chunks';

    /**
     * Abandoned sessions are normal — people close tabs mid-upload. These are
     * the largest files the system handles, so leaving them is not an option.
     */
    public const SESSION_TTL_HOURS = 24;

    /**
     * What the assembled file is allowed to be.
     *
     * Detected from the bytes, never taken from the client. A chunked upload
     * bypasses Laravel's `mimetypes` rule entirely, so if this list did not
     * exist the feature would quietly become an unrestricted file drop.
     *
     * @var array<int, string>
     */
    public const ALLOWED_MIMES = [
        'application/pdf',
        'text/plain',
        'text/csv',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'image/jpeg',
        'image/png',
        'image/webp',
        'application/zip',
        'application/x-zip-compressed',
        'application/x-rar-compressed',
        'application/x-tar',
        'application/gzip',
        'application/vnd.rar',
    ];

    /**
     * How big a piece this server can actually accept.
     *
     * Derived from the running configuration rather than assumed, because the
     * two environments disagree — 2 MB locally, 10 MB deployed — and a
     * hardcoded chunk size would work in one and fail invisibly in the other,
     * which is the exact bug being fixed.
     *
     * The 80% headroom covers the multipart envelope: the chunk is not the
     * whole request body, and a chunk sized exactly at the limit pushes the
     * request over it.
     */
    public function chunkSizeBytes(): int
    {
        $limits = array_filter([
            $this->iniBytes('upload_max_filesize'),
            $this->iniBytes('post_max_size'),
        ], static fn (int $value) => $value > 0);

        $ceiling = $limits === [] ? self::MIN_CHUNK_BYTES : min($limits);
        $usable = (int) floor($ceiling * 0.8);

        return max(self::MIN_CHUNK_BYTES, min($usable, self::MAX_CHUNK_BYTES));
    }

    /** @return array<string, int|array<int, string>> */
    public function limits(): array
    {
        return [
            'chunk_size' => $this->chunkSizeBytes(),
            'max_upload_bytes' => self::MAX_UPLOAD_BYTES,
            'allowed_mimes' => self::ALLOWED_MIMES,
        ];
    }

    public function begin(User $user, string $originalName, int $totalSize, ?string $clientMime): UploadSession
    {
        if ($totalSize <= 0) {
            throw new RuntimeException('An empty file cannot be uploaded.');
        }

        if ($totalSize > self::MAX_UPLOAD_BYTES) {
            throw new RuntimeException(sprintf(
                'That file is %s. The limit is %s.',
                $this->humanBytes($totalSize),
                $this->humanBytes(self::MAX_UPLOAD_BYTES)
            ));
        }

        $chunkSize = $this->chunkSizeBytes();

        return UploadSession::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'upload_key' => (string) Str::uuid(),
            // Stored for display and for the download filename only. It never
            // touches a path — see chunkDirectory().
            'original_name' => $this->sanitiseName($originalName),
            'client_mime' => $clientMime,
            'total_size' => $totalSize,
            'chunk_size' => $chunkSize,
            'total_chunks' => (int) max(1, ceil($totalSize / $chunkSize)),
            'received_chunks' => [],
            'status' => UploadSession::STATUS_PENDING,
            'expires_at' => now()->addHours(self::SESSION_TTL_HOURS),
        ]);
    }

    /**
     * Find a session this user is allowed to touch.
     *
     * Scoped by user as well as by key. The key is an opaque handle, not an
     * authorization — a leaked one must not let somebody else append to,
     * finish, or read another person's upload.
     */
    public function locate(User $user, string $uploadKey): UploadSession
    {
        $session = UploadSession::where('upload_key', $uploadKey)
            ->where('user_id', $user->id)
            ->first();

        if (! $session) {
            throw new RuntimeException('That upload could not be found.');
        }

        if ($session->isExpired()) {
            throw new RuntimeException('That upload expired. Start it again.');
        }

        return $session;
    }

    public function storeChunk(User $user, string $uploadKey, int $index, UploadedFile $chunk): UploadSession
    {
        $session = $this->locate($user, $uploadKey);

        if ($session->status !== UploadSession::STATUS_PENDING) {
            throw new RuntimeException('That upload is no longer accepting data.');
        }

        if ($index < 0 || $index >= $session->total_chunks) {
            throw new RuntimeException('That chunk is outside this upload.');
        }

        $size = (int) $chunk->getSize();

        // The last piece is legitimately short; every other one must be
        // exactly the negotiated size. Without this a client could send one
        // oversized "chunk" and walk straight past the total-size check.
        $isFinalChunk = $index === $session->total_chunks - 1;
        if (! $isFinalChunk && $size !== $session->chunk_size) {
            throw new RuntimeException('That chunk is the wrong size.');
        }
        if ($size > $session->chunk_size) {
            throw new RuntimeException('That chunk is larger than this upload negotiated.');
        }

        $chunk->storeAs($this->chunkDirectory($session), $index.'.part', self::CHUNK_DISK);

        // Re-sending a chunk is a normal part of resuming, so recording it
        // twice must not make the session look further along than it is.
        $received = $session->receivedIndexes();
        if (! in_array($index, $received, true)) {
            $received[] = $index;
            sort($received);
            $session->received_chunks = $received;
            $session->save();
        }

        return $session;
    }

    /**
     * Stitch the pieces together and hand back a stored attachment.
     *
     * Everything that could not be trusted earlier is checked here, against
     * the bytes rather than against anything the client said: the real size,
     * and the real type.
     *
     * @return array{path: string, name: string, mime: string, size: int}
     */
    public function complete(User $user, string $uploadKey): array
    {
        $session = $this->locate($user, $uploadKey);

        if ($session->status === UploadSession::STATUS_COMPLETED) {
            throw new RuntimeException('That upload has already been completed.');
        }

        $missing = $session->missingIndexes();
        if ($missing !== []) {
            throw new RuntimeException(sprintf(
                'That upload is incomplete — %d of %d pieces are missing.',
                count($missing),
                $session->total_chunks
            ));
        }

        $assembledPath = $this->assemble($session);

        try {
            $actualSize = filesize($assembledPath);

            if ($actualSize !== $session->total_size) {
                throw new RuntimeException('The assembled file does not match the size that was declared.');
            }

            $mime = $this->detectMime($assembledPath) ?? 'application/octet-stream';

            if (! in_array($mime, self::ALLOWED_MIMES, true)) {
                throw new RuntimeException('That file type is not allowed.');
            }

            // Streamed rather than read into memory: the whole point is that
            // this file may be far larger than memory_limit, and file_get_contents
            // on a 200 MB attachment would fatal where the upload just succeeded.
            $handle = fopen($assembledPath, 'rb');
            if ($handle === false) {
                throw new RuntimeException('The assembled file could not be read.');
            }

            try {
                $storedName = Str::uuid()->toString();
                Storage::disk('chat_attachments')->writeStream($storedName, $handle);
            } finally {
                if (is_resource($handle)) {
                    fclose($handle);
                }
            }

            DB::transaction(function () use ($session, $storedName) {
                $session->status = UploadSession::STATUS_COMPLETED;
                $session->assembled_path = $storedName;
                $session->save();
            });

            return [
                'path' => $storedName,
                'name' => $session->original_name,
                'mime' => $mime,
                'size' => $actualSize,
            ];
        } finally {
            // The chunks have served their purpose whether or not the checks
            // above passed. Leaving them behind on the failure path is how a
            // disk fills with the largest files the system handles.
            @unlink($assembledPath);
            $this->discardChunks($session);
        }
    }

    /**
     * Hand a finished upload to whatever is attaching it, exactly once.
     *
     * Returns `['error' => ...]` rather than throwing because its caller
     * (ChatService) already speaks that shape and turns it into a 422.
     *
     * The claim is a CONDITIONAL update, not a read-then-write. Two requests
     * quoting the same key at the same moment would both pass a plain status
     * check and both attach the same stored file; the second update matches no
     * row and is refused. Sharing one path between two messages means deleting
     * either one destroys the other's attachment.
     *
     * @return array{path: string, name: string, mime: string, size: int}|array{error: string}
     */
    public function claimCompleted(User $user, string $uploadKey): array
    {
        $session = UploadSession::where('upload_key', $uploadKey)
            ->where('user_id', $user->id)
            ->first();

        if (! $session) {
            return ['error' => 'That upload could not be found.'];
        }

        if ($session->status === UploadSession::STATUS_CLAIMED) {
            return ['error' => 'That upload has already been attached to a message.'];
        }

        if ($session->status !== UploadSession::STATUS_COMPLETED || ! $session->assembled_path) {
            return ['error' => 'That upload has not finished yet.'];
        }

        $claimed = UploadSession::where('id', $session->id)
            ->where('status', UploadSession::STATUS_COMPLETED)
            ->update(['status' => UploadSession::STATUS_CLAIMED]);

        if ($claimed === 0) {
            return ['error' => 'That upload has already been attached to a message.'];
        }

        return [
            'path' => $session->assembled_path,
            'name' => $session->original_name,
            // Re-detected at completion from the assembled bytes, never the
            // client's claim — see complete().
            'mime' => $this->storedMime($session),
            'size' => $session->total_size,
        ];
    }

    /**
     * The type recorded when the file was assembled.
     *
     * Read back off the stored file rather than kept on the session, so it
     * cannot drift from what is actually on disk.
     */
    private function storedMime(UploadSession $session): string
    {
        $disk = Storage::disk('chat_attachments');

        try {
            $detected = $disk->mimeType($session->assembled_path);
            if (is_string($detected) && $detected !== '') {
                return $detected;
            }
        } catch (\Throwable) {
            // Falls through to the safe default below.
        }

        return 'application/octet-stream';
    }

    public function abort(User $user, string $uploadKey): void
    {
        $session = $this->locate($user, $uploadKey);

        $this->discardChunks($session);

        $session->status = UploadSession::STATUS_ABORTED;
        $session->save();
    }

    /**
     * Sweep sessions nobody finished.
     *
     * Driven from the scheduler. Aborted and expired sessions both leave chunk
     * directories behind, and these are the biggest files on the disk.
     */
    public function purgeExpired(): int
    {
        $purged = 0;

        UploadSession::withoutOrganizationScope()
            ->where('status', '!=', UploadSession::STATUS_COMPLETED)
            ->where('expires_at', '<', now())
            ->cursor()
            ->each(function (UploadSession $session) use (&$purged) {
                $this->discardChunks($session);
                $session->status = UploadSession::STATUS_ABORTED;
                $session->save();
                $purged++;
            });

        return $purged;
    }

    private function assemble(UploadSession $session): string
    {
        $directory = Storage::disk(self::CHUNK_DISK)->path($this->chunkDirectory($session));
        $target = $directory.DIRECTORY_SEPARATOR.'assembled.bin';

        $out = fopen($target, 'wb');
        if ($out === false) {
            throw new RuntimeException('The upload could not be assembled.');
        }

        try {
            for ($index = 0; $index < $session->total_chunks; $index++) {
                $partPath = $directory.DIRECTORY_SEPARATOR.$index.'.part';

                $in = fopen($partPath, 'rb');
                if ($in === false) {
                    throw new RuntimeException(sprintf('Piece %d of this upload is missing.', $index));
                }

                try {
                    // Ordered by index, not by arrival. Chunks may land out of
                    // order — that is what makes resuming and any future
                    // parallel upload possible — so the loop, not the
                    // filesystem, decides the order the bytes go back together.
                    stream_copy_to_stream($in, $out);
                } finally {
                    fclose($in);
                }
            }
        } finally {
            fclose($out);
        }

        return $target;
    }

    /**
     * Where a session's pieces live.
     *
     * Derived from the upload key, which this service generated, and never
     * from the file name, which the user supplied. A name is display text; the
     * moment it reaches a path it becomes a traversal.
     */
    private function chunkDirectory(UploadSession $session): string
    {
        return 'sessions/'.$session->upload_key;
    }

    private function discardChunks(UploadSession $session): void
    {
        Storage::disk(self::CHUNK_DISK)->deleteDirectory($this->chunkDirectory($session));
    }

    private function detectMime(string $path): ?string
    {
        if (function_exists('mime_content_type')) {
            $detected = @mime_content_type($path);
            if (is_string($detected) && $detected !== '') {
                return $detected;
            }
        }

        return null;
    }

    private function sanitiseName(string $name): string
    {
        // basename() first: a name arriving as "../../etc/passwd" should become
        // "passwd" and be treated as an ordinary, badly-chosen file name.
        $base = basename(str_replace('\\', '/', $name));
        $base = trim($base) !== '' ? trim($base) : 'attachment';

        return Str::limit($base, 180, '');
    }

    private function iniBytes(string $directive): int
    {
        $raw = trim((string) ini_get($directive));
        if ($raw === '') {
            return 0;
        }

        $unit = strtolower(substr($raw, -1));
        $value = (int) $raw;

        return match ($unit) {
            'g' => $value * 1024 * 1024 * 1024,
            'm' => $value * 1024 * 1024,
            'k' => $value * 1024,
            default => $value,
        };
    }

    private function humanBytes(int $bytes): string
    {
        if ($bytes >= 1024 * 1024 * 1024) {
            return round($bytes / (1024 * 1024 * 1024), 1).' GB';
        }

        if ($bytes >= 1024 * 1024) {
            return round($bytes / (1024 * 1024), 1).' MB';
        }

        return round($bytes / 1024, 1).' KB';
    }
}
