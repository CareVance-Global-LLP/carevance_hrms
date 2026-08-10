<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReviewCycleParticipant extends Model
{
    use HasFactory;

    protected $fillable = [
        'review_cycle_id',
        'employee_id',
        'self_review_id',
        'manager_review_id',
        'shared_at',
        'acknowledged_at',
    ];

    protected $casts = [
        'shared_at' => 'datetime',
        'acknowledged_at' => 'datetime',
    ];

    public function cycle(): BelongsTo
    {
        return $this->belongsTo(ReviewCycle::class, 'review_cycle_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'employee_id');
    }

    public function selfReview(): BelongsTo
    {
        return $this->belongsTo(PerformanceReview::class, 'self_review_id');
    }

    public function managerReview(): BelongsTo
    {
        return $this->belongsTo(PerformanceReview::class, 'manager_review_id');
    }
}
