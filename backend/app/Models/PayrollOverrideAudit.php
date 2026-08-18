<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One immutable line in an override's history.
 *
 * Append-only is enforced by never writing anything else: there is no update
 * path, no delete path, and no updated_at column for one to hide in. Every
 * transition — including the engine's own 'applied' — records the override's
 * state either side of it, so a single row answers "what changed" without
 * replaying the rest.
 */
class PayrollOverrideAudit extends Model
{
    use BelongsToOrganization;

    public const ACTION_CREATED = 'created';
    public const ACTION_APPROVED = 'approved';
    public const ACTION_REJECTED = 'rejected';
    public const ACTION_CANCELLED = 'cancelled';
    public const ACTION_APPLIED = 'applied';

    /**
     * created_at is written explicitly on insert. Laravel's timestamp handling
     * would otherwise also maintain updated_at, and this table deliberately has
     * no such column.
     */
    public $timestamps = false;

    protected $fillable = [
        'organization_id',
        'payroll_override_id',
        'action',
        'actor_id',
        'before_json',
        'after_json',
        'note',
        'created_at',
    ];

    protected $casts = [
        'before_json' => 'array',
        'after_json' => 'array',
        'created_at' => 'datetime',
    ];

    public function override(): BelongsTo
    {
        return $this->belongsTo(PayrollOverride::class, 'payroll_override_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
