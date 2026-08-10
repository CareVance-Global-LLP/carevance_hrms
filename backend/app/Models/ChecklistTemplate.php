<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ChecklistTemplate extends Model
{
    use BelongsToOrganization;

    public const KIND_ONBOARDING = 'onboarding';
    public const KIND_OFFBOARDING = 'offboarding';

    protected $fillable = [
        'organization_id',
        'kind',
        'name',
        'description',
        'is_default',
        'is_active',
    ];

    protected $casts = [
        'is_default' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(ChecklistTemplateItem::class)->orderBy('sort_order');
    }

    /**
     * The template a new journey of this kind should use.
     *
     * Falls back to any active template rather than returning null, because a
     * journey with no checklist is worse than one built from the wrong list —
     * the first is invisible, the second is obvious and editable.
     */
    public static function defaultFor(int $organizationId, string $kind): ?self
    {
        return static::where('organization_id', $organizationId)
            ->where('kind', $kind)
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('id')
            ->first();
    }
}
