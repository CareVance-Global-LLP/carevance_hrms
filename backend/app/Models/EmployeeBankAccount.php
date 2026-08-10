<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeBankAccount extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'account_holder_name',
        'bank_name',
        'account_number',
        'ifsc_swift',
        'branch',
        'account_type',
        'upi_id',
        'payment_email',
        'payout_method',
        'is_default',
        'verification_status',
        'employee_document_id',
        'notes',
        'meta',
    ];

    protected function casts(): array
    {
        return [
            'is_default' => 'boolean',
            'meta' => 'array',
        ];
    }

    /**
     * Alias for `ifsc_swift`, the column that actually holds the code.
     *
     * Four places read `->ifsc_code` — the bank transfer file
     * (BankIntegrationService), the payslip PDF, and the payroll register in
     * two spots. There is no such column, so Eloquent returned null and each
     * one quietly emitted a blank IFSC. A NEFT line with no IFSC is rejected by
     * the bank, and nothing in the app said why.
     *
     * Aliasing rather than renaming the four call sites: the same mistake is
     * easy to make again, and the column name (ifsc_swift — it holds a SWIFT
     * code for foreign accounts) is not what anyone reaching for an IFSC will
     * guess.
     */
    public function getIfscCodeAttribute(): ?string
    {
        return $this->attributes['ifsc_swift'] ?? null;
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(EmployeeDocument::class, 'employee_document_id');
    }
}
