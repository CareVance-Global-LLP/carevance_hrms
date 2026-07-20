<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SalaryRevisionLetter extends Model
{
    protected $table = 'salary_revision_letters';

    protected $fillable = [
        'organization_id', 'user_id', 'old_ctc', 'new_ctc', 'arrear_amount',
        'revision_percentage', 'revision_type', 'effective_from', 'reason',
        'old_breakdown', 'new_breakdown', 'letter_file_path', 'status',
        'accepted_at', 'rejected_at', 'rejection_reason', 'generated_by',
    ];

    protected $casts = [
        'old_ctc' => 'decimal:2',
        'new_ctc' => 'decimal:2',
        'arrear_amount' => 'decimal:2',
        'revision_percentage' => 'decimal:2',
        'effective_from' => 'date',
        'old_breakdown' => 'array',
        'new_breakdown' => 'array',
        'accepted_at' => 'datetime',
        'rejected_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function generatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by');
    }
}
