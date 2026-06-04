<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class EmployeeTaxDeclaration extends Model
{
    protected $fillable = [
        'organization_id',
        'user_id',
        'financial_year',
        'status',
        'total_declared_amount',
        'approved_amount',
        'submitted_at',
        'approved_by',
        'approved_at',
        'remarks',
    ];

    protected $casts = [
        'total_declared_amount' => 'decimal:2',
        'approved_amount' => 'decimal:2',
        'submitted_at' => 'datetime',
        'approved_at' => 'datetime',
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

    public function items(): HasMany
    {
        return $this->hasMany(EmployeeTaxDeclarationItem::class, 'declaration_id');
    }

    public function recalculateTotals(): void
    {
        $this->total_declared_amount = $this->items()->sum('declared_amount');
        $this->approved_amount = $this->items()->sum('approved_amount');
        $this->save();
    }
}
