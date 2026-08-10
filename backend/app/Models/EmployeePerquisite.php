<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeePerquisite extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'user_id',
        'perquisite_type',
        'description',
        'annual_value',
        'taxable_value',
        'financial_year',
        'status',
    ];

    protected $casts = [
        'annual_value' => 'decimal:2',
        'taxable_value' => 'decimal:2',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('status', 'active');
    }

    public function scopeForFinancialYear(Builder $query, string $year): Builder
    {
        return $query->where('financial_year', $year);
    }
}
