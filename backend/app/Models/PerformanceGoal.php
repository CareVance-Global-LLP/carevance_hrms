<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PerformanceGoal extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'employee_id',
        'manager_id',
        'scope',
        'parent_goal_id',
        'group_id',
        'title',
        'description',
        'category',
        'start_date',
        'end_date',
        'target_metrics',
        'weight',
        'progress_percentage',
        'status',
    ];

    protected $casts = [
        'start_date' => 'date:Y-m-d',
        'end_date' => 'date:Y-m-d',
        'target_metrics' => 'array',
        'progress_percentage' => 'integer',
        'weight' => 'integer',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'employee_id');
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_id');
    }

    public function reviews(): HasMany
    {
        return $this->hasMany(PerformanceReview::class, 'goal_id');
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_goal_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(self::class, 'parent_goal_id');
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class, 'group_id');
    }

    public function checkIns(): HasMany
    {
        return $this->hasMany(GoalCheckIn::class, 'goal_id');
    }

    public function scopeActive($query)
    {
        return $query->where('status', 'active');
    }

    public function scopeCompleted($query)
    {
        return $query->where('status', 'completed');
    }
}
