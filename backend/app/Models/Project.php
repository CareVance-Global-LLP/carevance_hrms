<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Project extends Model
{
    use BelongsToOrganization;

    /** Colours a project can be given. Also the fallback ramp for older rows. */
    public const COLOR_PALETTE = ['#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6', '#EC4899', '#6366F1', '#14B8A6'];

    protected $fillable = [
        'organization_id',
        'group_id',
        'name',
        'description',
        'color',
        'budget',
        'budget_type',
        'hourly_rate',
        'deadline',
        'status',
    ];

    protected $casts = [
        'budget' => 'decimal:2',
        'hourly_rate' => 'decimal:2',
        'deadline' => 'date:Y-m-d',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    public function timeEntries(): HasMany
    {
        return $this->hasMany(TimeEntry::class);
    }

    public function assignedUsers(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'project_user')
            ->withTimestamps();
    }

    /**
     * A stored colour wins; rows created before the column existed keep the
     * palette entry they have always rendered with, so upgrading does not
     * recolour anybody's board.
     */
    public function getColorAttribute(): string
    {
        $stored = $this->attributes['color'] ?? null;
        if (is_string($stored) && $stored !== '') {
            return $stored;
        }

        return self::COLOR_PALETTE[$this->id % count(self::COLOR_PALETTE)];
    }
}
