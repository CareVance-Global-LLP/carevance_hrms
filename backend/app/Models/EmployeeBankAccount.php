<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeBankAccount extends Model
{
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
