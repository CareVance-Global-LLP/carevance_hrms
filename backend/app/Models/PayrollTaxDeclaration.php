<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollTaxDeclaration extends Model
{
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'payroll_profile_id',
        'financial_year',
        'total_declared_amount',
        'total_verified_amount',
        'status',
        'submitted_at',
        'verified_at',
        'verified_by',
        'meta',
    ];

    protected $casts = [
        'total_declared_amount' => 'decimal:2',
        'total_verified_amount' => 'decimal:2',
        'submitted_at' => 'datetime',
        'verified_at' => 'datetime',
        'meta' => 'array',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function payrollProfile(): BelongsTo
    {
        return $this->belongsTo(PayrollProfile::class);
    }

    public function verifier(): BelongsTo
    {
        return $this->belongsTo(User::class, 'verified_by');
    }
}
