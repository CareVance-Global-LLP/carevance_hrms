<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PayGroup extends Model
{
    protected $fillable = [
        'organization_id', 'name', 'code', 'description', 'pay_frequency',
        'pay_day', 'pay_day_type', 'statutory_rules', 'salary_template_id', 'is_active',
    ];

    protected $casts = [
        'statutory_rules' => 'array',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function salaryTemplate(): BelongsTo
    {
        return $this->belongsTo(SalaryTemplate::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(PayGroupAssignment::class);
    }

    public function filingDetails(): HasMany
    {
        return $this->hasMany(PayGroupFilingDetail::class);
    }

    public function getFilingDetailForState(string $stateCode): ?PayGroupFilingDetail
    {
        return $this->filingDetails()->where('state_code', $stateCode)->first();
    }
}
