<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Uploads\ChunkedUploadService;
use Illuminate\Http\Request;
use RuntimeException;

/**
 * Resumable uploads for files too large to arrive in one request.
 *
 * The flow is deliberately explicit rather than clever: begin, send pieces,
 * complete. The client is told the chunk size rather than choosing it, because
 * the safe size is a property of THIS server's php.ini and differs between
 * environments — 2 MB locally, 10 MB deployed. A client that picked its own
 * would work in one and fail in the other.
 */
class UploadController extends Controller
{
    public function __construct(private readonly ChunkedUploadService $uploads)
    {
    }

    /**
     * What this server can accept, before anybody tries.
     *
     * Lets the composer refuse an oversized file with a real number instead of
     * discovering the limit by failing halfway through.
     */
    public function limits()
    {
        return response()->json($this->uploads->limits());
    }

    public function begin(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'size' => 'required|integer|min:1',
            'mime' => 'nullable|string|max:255',
        ]);

        try {
            $session = $this->uploads->begin(
                $request->user(),
                $validated['name'],
                (int) $validated['size'],
                $validated['mime'] ?? null,
            );
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'upload_key' => $session->upload_key,
            'chunk_size' => $session->chunk_size,
            'total_chunks' => $session->total_chunks,
            'missing_chunks' => $session->missingIndexes(),
            'expires_at' => $session->expires_at,
        ], 201);
    }

    /**
     * Where a resuming client starts from.
     *
     * Returns the MISSING pieces rather than the received ones so the client
     * sends exactly what the server says is absent, instead of computing the
     * difference and possibly disagreeing about it.
     */
    public function status(Request $request, string $uploadKey)
    {
        try {
            $session = $this->uploads->locate($request->user(), $uploadKey);
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 404);
        }

        return response()->json([
            'upload_key' => $session->upload_key,
            'status' => $session->status,
            'chunk_size' => $session->chunk_size,
            'total_chunks' => $session->total_chunks,
            'missing_chunks' => $session->missingIndexes(),
            'progress_percent' => $session->progressPercent(),
        ]);
    }

    public function storeChunk(Request $request, string $uploadKey, int $index)
    {
        $request->validate(['chunk' => 'required|file']);

        try {
            $session = $this->uploads->storeChunk(
                $request->user(),
                $uploadKey,
                $index,
                $request->file('chunk'),
            );
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'received' => count($session->receivedIndexes()),
            'total_chunks' => $session->total_chunks,
            'progress_percent' => $session->progressPercent(),
            'is_complete' => $session->isComplete(),
        ]);
    }

    /**
     * Assemble, verify and store.
     *
     * Returns only the upload key. The assembled file is claimed by whatever
     * is attaching it — a chat message today — rather than being handed to the
     * client as a path it could then quote for something else.
     */
    public function complete(Request $request, string $uploadKey)
    {
        try {
            $stored = $this->uploads->complete($request->user(), $uploadKey);
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'upload_key' => $uploadKey,
            'name' => $stored['name'],
            'mime' => $stored['mime'],
            'size' => $stored['size'],
        ]);
    }

    public function abort(Request $request, string $uploadKey)
    {
        try {
            $this->uploads->abort($request->user(), $uploadKey);
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 404);
        }

        return response()->json(['message' => 'Upload cancelled.']);
    }
}
