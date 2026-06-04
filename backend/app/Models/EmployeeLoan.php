<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeLoan extends Model
{
    protected $fillable = [
        'organization_id',
        'user_id',
        'loan_type',
        'amount',
        'emi_amount',
        'total_installments',
        'paid_installments',
        'remaining_amount',
        'purpose',
        'status',
        'approved_by',
        'approved_at',
        'disbursed_at',
        'rejection_reason',
        'notes',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'emi_amount' => 'decimal:2',
        'remaining_amount' => 'decimal:2',
        'approved_at' => 'datetime',
        'disbursed_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function scopeActive($query)
    {
        return $query->where('status', 'approved')->where('remaining_amount', '>', 0);
    }

    public function scopeForOrganization($query, int $organizationId)
    {
        return $query->where('organization_id', $organizationId);
    }

    public function isActive(): bool
    {
        return $this->status === 'approved' && $this->remaining_amount > 0;
    }

    public function getProgressPercentageAttribute(): float
    {
        if ($this->total_installments === 0) return 0;
        return round(($this->paid_installments / $this->total_installments) * 100, 2);
    }
}
