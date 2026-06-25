<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class SalaryTemplate extends Model
{
    protected $fillable = [
        'organization_id',
        'name',
        'description',
        'currency',
        'basic_percentage',
        'hra_percentage',
        'conveyance_amount',
        'da_percentage',
        'cca_amount',
        'education_allowance',
        'internet_allowance',
        'meal_allowance',
        'transport_allowance',
        'uniform_allowance',
        'books_periodicals',
        'fuel_maintenance',
        'nps_percentage',
        'vpf_percentage',
        'other_earnings',
        'is_default',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'is_default' => 'boolean',
            'basic_percentage' => 'decimal:2',
            'hra_percentage' => 'decimal:2',
            'conveyance_amount' => 'decimal:2',
            'da_percentage' => 'decimal:2',
            'cca_amount' => 'decimal:2',
            'education_allowance' => 'decimal:2',
            'internet_allowance' => 'decimal:2',
            'meal_allowance' => 'decimal:2',
            'transport_allowance' => 'decimal:2',
            'uniform_allowance' => 'decimal:2',
            'books_periodicals' => 'decimal:2',
            'fuel_maintenance' => 'decimal:2',
            'nps_percentage' => 'decimal:2',
            'vpf_percentage' => 'decimal:2',
            'other_earnings' => 'array',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function components(): HasMany
    {
        return $this->hasMany(SalaryTemplateComponent::class)->orderBy('sort_order');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(EmployeeSalaryAssignment::class);
    }

    public function calculateBreakdown(float $annualCtc): array
    {
        $monthlyCtc = $annualCtc / 12;
        $basic = $monthlyCtc * ($this->basic_percentage / 100);
        $hra = $basic * ($this->hra_percentage / 100);
        $da = $monthlyCtc * ($this->da_percentage / 100);
        $nps = $basic * ($this->nps_percentage / 100);
        $vpf = $basic * ($this->vpf_percentage / 100);

        $otherEarningsMonthly = [];
        if (!empty($this->other_earnings) && is_array($this->other_earnings)) {
            foreach ($this->other_earnings as $item) {
                $name = $item['name'] ?? 'Other';
                $type = $item['type'] ?? 'fixed';
                $value = (float) ($item['value'] ?? 0);
                $amount = $type === 'percentage' ? $basic * ($value / 100) : $value;
                $otherEarningsMonthly[] = [
                    'name' => $name,
                    'amount' => round($amount, 2),
                ];
            }
        }

        $otherEarningsTotal = array_sum(array_column($otherEarningsMonthly, 'amount'));

        $monthlyGross = $basic + $hra + $this->conveyance_amount + $da
            + $this->cca_amount + $this->education_allowance + $this->internet_allowance
            + $this->meal_allowance + $this->transport_allowance + $this->uniform_allowance
            + $this->books_periodicals + $this->fuel_maintenance + $nps + $vpf
            + $otherEarningsTotal;

        return [
            'monthly' => [
                'basic' => round($basic, 2),
                'hra' => round($hra, 2),
                'conveyance' => round($this->conveyance_amount, 2),
                'da' => round($da, 2),
                'cca' => round($this->cca_amount, 2),
                'education' => round($this->education_allowance, 2),
                'internet' => round($this->internet_allowance, 2),
                'meal' => round($this->meal_allowance, 2),
                'transport' => round($this->transport_allowance, 2),
                'uniform' => round($this->uniform_allowance, 2),
                'books_periodicals' => round($this->books_periodicals, 2),
                'fuel_maintenance' => round($this->fuel_maintenance, 2),
                'nps' => round($nps, 2),
                'vpf' => round($vpf, 2),
                'other_earnings' => $otherEarningsMonthly,
                'gross' => round($monthlyGross, 2),
            ],
            'annual' => [
                'basic' => round($basic * 12, 2),
                'hra' => round($hra * 12, 2),
                'conveyance' => round($this->conveyance_amount * 12, 2),
                'da' => round($da * 12, 2),
                'cca' => round($this->cca_amount * 12, 2),
                'education' => round($this->education_allowance * 12, 2),
                'internet' => round($this->internet_allowance * 12, 2),
                'meal' => round($this->meal_allowance * 12, 2),
                'transport' => round($this->transport_allowance * 12, 2),
                'uniform' => round($this->uniform_allowance * 12, 2),
                'books_periodicals' => round($this->books_periodicals * 12, 2),
                'fuel_maintenance' => round($this->fuel_maintenance * 12, 2),
                'nps' => round($nps * 12, 2),
                'vpf' => round($vpf * 12, 2),
                'gross' => round($monthlyGross * 12, 2),
            ],
            'percentages' => [
                'basic_percentage' => $this->basic_percentage,
                'hra_percentage' => $this->hra_percentage,
                'da_percentage' => $this->da_percentage,
                'nps_percentage' => $this->nps_percentage,
                'vpf_percentage' => $this->vpf_percentage,
            ],
        ];
    }
}
