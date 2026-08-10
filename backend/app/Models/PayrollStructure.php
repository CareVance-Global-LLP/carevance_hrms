<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An employee's salary structure for a period.
 *
 * The payroll_structures table has existed since 2026_03_05, but this model was
 * missing, so every consumer referencing App\Models\PayrollStructure fataled.
 */
class PayrollStructure extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'basic_salary',
        'currency',
        'effective_from',
        'effective_to',
        'is_active',
    ];

    protected $casts = [
        'basic_salary' => 'decimal:2',
        'effective_from' => 'date',
        'effective_to' => 'date',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** Structures in force on a given date. */
    public function scopeEffectiveOn($query, string $date)
    {
        return $query
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $date)
            ->where(function ($q) use ($date) {
                $q->whereNull('effective_to')->orWhereDate('effective_to', '>=', $date);
            });
    }
}
