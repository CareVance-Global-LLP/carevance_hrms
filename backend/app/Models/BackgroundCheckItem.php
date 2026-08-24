<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One check within a background verification.
 *
 * `claimed` and `verified` are kept apart rather than collapsed into a note,
 * because "you said 2019, the university says 2018" is the sentence a
 * discrepancy has to be able to produce. A free-text note cannot be compared,
 * shown side by side, or handed to the person it is about.
 */
class BackgroundCheckItem extends Model
{
    use BelongsToOrganization;

    public const TYPES = ['identity', 'address', 'education', 'employment', 'criminal', 'reference', 'credit'];

    /** clear and discrepancy are both COMPLETE. Only a human decides what a discrepancy means. */
    public const STATUSES = ['pending', 'in_progress', 'clear', 'discrepancy', 'insufficient', 'skipped'];

    public const SETTLED = ['clear', 'discrepancy', 'insufficient', 'skipped'];

    protected $fillable = [
        'organization_id',
        'background_check_id',
        'type',
        'label',
        'status',
        'claimed',
        'verified',
        'notes',
        'evidence_path',
        'completed_by',
        'completed_at',
    ];

    protected $casts = ['completed_at' => 'datetime'];

    /**
     * Evidence paths are not broadcast.
     *
     * A storage key for a police verification or a degree certificate; anybody
     * holding one can ask for the file, so it goes out only through a
     * controller that checks who is asking.
     */
    protected $hidden = ['evidence_path'];

    public function check(): BelongsTo
    {
        return $this->belongsTo(BackgroundCheck::class, 'background_check_id');
    }

    public function isSettled(): bool
    {
        return in_array($this->status, self::SETTLED, true);
    }
}
