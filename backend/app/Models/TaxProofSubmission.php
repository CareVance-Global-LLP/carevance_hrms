<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TaxProofSubmission extends Model
{
    protected $table = 'tax_proof_submissions';

    protected $fillable = [
        'organization_id', 'user_id', 'declaration_item_id', 'financial_year',
        'declaration_type', 'description', 'amount', 'proof_file_path', 'proof_filename',
        'status', 'reviewed_by', 'reviewed_at', 'review_notes',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'reviewed_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function declarationItem(): BelongsTo
    {
        return $this->belongsTo(EmployeeTaxDeclarationItem::class, 'declaration_item_id');
    }

    public function reviewedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewed_by');
    }
}
