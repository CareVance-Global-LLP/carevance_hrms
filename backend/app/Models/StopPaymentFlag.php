<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class StopPaymentFlag extends Model
{
    protected $table = 'stop_payment_flags';

protected $fillable = [
        'organization_id', 'user_id', 'month_year', 'reason', 'raised_by',
        'is_active', 'resolved_at', 'resolved_by', 'hold_type',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'resolved_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function raisedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'raised_by');
    }

    public function resolvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }
}
