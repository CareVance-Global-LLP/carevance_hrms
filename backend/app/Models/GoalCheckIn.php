<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GoalCheckIn extends Model
{
    use HasFactory;

    protected $fillable = [
        'goal_id',
        'user_id',
        'progress_percentage',
        'note',
    ];

    protected $casts = [
        'progress_percentage' => 'integer',
    ];

    public function goal(): BelongsTo
    {
        return $this->belongsTo(PerformanceGoal::class, 'goal_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
