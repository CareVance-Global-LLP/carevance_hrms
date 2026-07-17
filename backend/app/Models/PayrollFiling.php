<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollFiling extends Model
{
    protected $table = 'payroll_filings';

    protected $fillable = [
        'organization_id', 'type', 'period_type', 'period_month', 'period_quarter',
        'period_year', 'status', 'portal_status', 'file_path', 'original_filename',
        'acknowledgment_number', 'generated_at', 'submitted_at', 'approved_at',
        'filed_at', 'acknowledged_at', 'generated_by', 'submitted_by', 'approved_by',
        'filed_by', 'reviewer_user_id', 'review_note', 'meta_data', 'notes',
    ];

    protected $casts = [
        'generated_at' => 'datetime',
        'submitted_at' => 'datetime',
        'approved_at' => 'datetime',
        'filed_at' => 'datetime',
        'acknowledged_at' => 'datetime',
        'meta_data' => 'array',
    ];

    const TYPES = [
        'pf_ecr', 'esi_challan', 'esi_return', 'form_24q', 'form_26q',
        'form_16', 'form_12ba', 'pt_return', 'lwf_return', 'bonus_form_c', 'bonus_form_d',
    ];

    // Filing workflow: generated -> submitted -> approved -> filed -> acknowledged
    const STATUSES = ['draft', 'generated', 'submitted', 'approved', 'filed', 'acknowledged', 'error'];

    // Portal-side state for the semi-auto "upload to portal" flow.
    const PORTAL_STATUSES = ['pending_upload', 'uploaded', 'paid', 'error'];

    /**
     * Statuses where the filing is still in the internal maker-checker pipeline
     * (not yet filed by the human). Used to gate the "Upload to portal" button.
     */
    const REVIEW_STATUSES = ['generated', 'submitted', 'approved'];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function generatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by');
    }

    public function filedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'filed_by');
    }

    public function submittedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function isReadyToUpload(): bool
    {
        return in_array($this->status, self::REVIEW_STATUSES) && ! empty($this->file_path);
    }

    public function isFiled(): bool
    {
        return in_array($this->status, ['filed', 'acknowledged']);
    }

    public function scopeOfType($query, string $type)
    {
        return $query->where('type', $type);
    }

    public function scopeForPeriod($query, string $periodType, $year, $month = null, $quarter = null)
    {
        $query->where('period_type', $periodType)->where('period_year', $year);
        if ($month) {
            $query->where('period_month', $month);
        }
        if ($quarter) {
            $query->where('period_quarter', $quarter);
        }

        return $query;
    }
}
