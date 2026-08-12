<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class EmployeeTaxDeclaration extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'user_id',
        'financial_year',
        'status',
        'proof_status',
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

    /**
     * Store the financial year in one canonical shape, whatever was passed.
     *
     * The column was found holding four spellings of the same thing —
     * '2025-26', '2026-2027', '2026' and '2026-27' — because each write path
     * formatted it however it liked and nothing reconciled them. The tax
     * engine looks declarations up with an exact string match on 'YYYY-YY', so
     * 17 of 102 rows could not be found at all. A declaration that cannot be
     * found contributes no exemptions, and the employee is taxed as though
     * they had declared nothing.
     *
     * A mutator rather than validation at each call site: there are several
     * write paths and a mutator covers the ones nobody remembers.
     *
     * @see \App\Services\PayrollCalculatorService::financialYearKey()
     */
    public function setFinancialYearAttribute(?string $value): void
    {
        $this->attributes['financial_year'] = $value === null
            ? null
            : \App\Services\PayrollCalculatorService::financialYearKey($value);
    }

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
