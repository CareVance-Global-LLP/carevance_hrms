<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A single-use recovery code.
 *
 * Spent codes are kept rather than deleted so the trail can show that one was
 * used and when — a recovery code being spent is exactly the event a security
 * reviewer wants to see.
 */
class UserRecoveryCode extends Model
{
    protected $fillable = [
        'user_id',
        'code_hash',
        'used_at',
    ];

    protected function casts(): array
    {
        return [
            'used_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
