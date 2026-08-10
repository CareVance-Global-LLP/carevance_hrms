<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ReviewCycle extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    public const PHASES = ['draft', 'self', 'manager', 'shared', 'closed'];

    protected $fillable = [
        'organization_id',
        'name',
        'period_start',
        'period_end',
        'self_due',
        'manager_due',
        'share_date',
        'phase',
        'anonymize_peer',
    ];

    protected $casts = [
        'period_start' => 'date',
        'period_end' => 'date',
        'self_due' => 'date',
        'manager_due' => 'date',
        'share_date' => 'date',
        'anonymize_peer' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function participants(): HasMany
    {
        return $this->hasMany(ReviewCycleParticipant::class);
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(PerformanceReview::class);
    }

    public function scopeActive($query)
    {
        return $query->whereIn('phase', ['self', 'manager']);
    }
}
