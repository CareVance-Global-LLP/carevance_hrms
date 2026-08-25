<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UploadSession extends Model
{
    use BelongsToOrganization;

    public const STATUS_PENDING = 'pending';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_ABORTED = 'aborted';

    /**
     * Assembled AND attached to something.
     *
     * Separate from `completed` because an upload is single-use: once a message
     * carries it, re-quoting the key must not attach the same stored file to a
     * second message. Two messages sharing one path means deleting either one
     * takes the other's attachment with it.
     */
    public const STATUS_CLAIMED = 'claimed';

    protected $fillable = [
        'organization_id',
        'user_id',
        'upload_key',
        'original_name',
        'client_mime',
        'total_size',
        'chunk_size',
        'total_chunks',
        'received_chunks',
        'status',
        'assembled_path',
        'expires_at',
    ];

    protected function casts(): array
    {
        return [
            'received_chunks' => 'array',
            'total_size' => 'integer',
            'chunk_size' => 'integer',
            'total_chunks' => 'integer',
            'expires_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** @return array<int, int> */
    public function receivedIndexes(): array
    {
        return array_values(array_unique(array_map('intval', $this->received_chunks ?? [])));
    }

    /**
     * Which pieces are still outstanding.
     *
     * This is what a resuming client asks for. Returning the MISSING set rather
     * than the received set keeps the client honest: it sends what the server
     * says is absent instead of computing the difference itself and possibly
     * disagreeing about it.
     *
     * @return array<int, int>
     */
    public function missingIndexes(): array
    {
        $received = array_flip($this->receivedIndexes());

        return array_values(array_filter(
            range(0, max(0, $this->total_chunks - 1)),
            static fn (int $index) => ! isset($received[$index])
        ));
    }

    public function isComplete(): bool
    {
        return count($this->receivedIndexes()) >= $this->total_chunks;
    }

    public function isExpired(): bool
    {
        return $this->expires_at !== null && $this->expires_at->isPast();
    }

    public function progressPercent(): float
    {
        if ($this->total_chunks <= 0) {
            return 0.0;
        }

        return round((count($this->receivedIndexes()) / $this->total_chunks) * 100, 2);
    }
}
