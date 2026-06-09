<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BreakTime extends Model
{
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'break_date',
        'start_at',
        'end_at',
        'duration_seconds',
        'reason',
    ];

    protected $casts = [
        'break_date' => 'date',
        'start_at' => 'datetime',
        'end_at' => 'datetime',
        'duration_seconds' => 'integer',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function scopeActive($query)
    {
        return $query->whereNull('end_at');
    }

    public function scopeForDate($query, $userId, $date)
    {
        return $query->where('user_id', $userId)->where('break_date', $date);
    }
}
