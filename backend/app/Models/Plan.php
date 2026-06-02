<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class Plan extends Model
{
    use HasFactory;

    protected $fillable = [
        'code',
        'name',
        'description',
        'price_monthly',
        'price_yearly',
        'max_employees',
        'features',
        'is_active',
        'is_popular',
        'display_order',
    ];

    protected $casts = [
        'price_monthly' => 'decimal:2',
        'price_yearly' => 'decimal:2',
        'features' => 'array',
        'is_active' => 'boolean',
        'is_popular' => 'boolean',
    ];

    /**
     * Get formatted price
     */
    public function getFormattedPriceAttribute(): string
    {
        return '₹' . number_format($this->price_monthly);
    }

    /**
     * Get formatted yearly price
     */
    public function getFormattedYearlyPriceAttribute(): ?string
    {
        if (!$this->price_yearly) {
            return null;
        }
        return '₹' . number_format($this->price_yearly);
    }

    /**
     * Get max employees label
     */
    public function getMaxEmployeesLabelAttribute(): string
    {
        if ($this->max_employees === -1) {
            return 'Unlimited';
        }
        return $this->max_employees . ' employees';
    }

    /**
     * Check if plan has a specific feature
     */
    public function hasFeature(string $feature): bool
    {
        $features = $this->features ?? [];
        return in_array($feature, $features);
    }

    /**
     * Scope active plans
     */
    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    /**
     * Scope ordered by display order
     */
    public function scopeOrdered($query)
    {
        return $query->orderBy('display_order')->orderBy('price_monthly');
    }
}
