<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PerformanceReview extends Model
{
    use Auditable;
    use BelongsToOrganization;
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'employee_id',
        'reviewer_id',
        'goal_id',
        'review_cycle_id',
        'review_type',
        'review_period_start',
        'review_period_end',
        'overall_rating',
        'strengths',
        'areas_for_improvement',
        'goals',
        'comments',
        'is_confidential',
        'status',
    ];

    protected $casts = [
        'review_period_start' => 'date:Y-m-d',
        'review_period_end' => 'date:Y-m-d',
        'strengths' => 'array',
        'areas_for_improvement' => 'array',
        'goals' => 'array',
        'is_confidential' => 'boolean',
        'overall_rating' => 'integer',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'employee_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewer_id');
    }

    public function goal(): BelongsTo
    {
        return $this->belongsTo(PerformanceGoal::class, 'goal_id');
    }

    public function cycle(): BelongsTo
    {
        return $this->belongsTo(ReviewCycle::class, 'review_cycle_id');
    }

    public function competencyRatings()
    {
        return $this->hasMany(ReviewCompetencyRating::class, 'review_id');
    }

    public function scopeCompleted($query)
    {
        return $query->where('status', 'completed');
    }

    public function scopeDraft($query)
    {
        return $query->where('status', 'draft');
    }
}
