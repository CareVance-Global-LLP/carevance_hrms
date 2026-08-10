<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollFiling extends Model
{
    use BelongsToOrganization;

    protected $table = 'payroll_filings';

    protected $fillable = [
        'organization_id', 'type', 'period_type', 'period_month', 'period_quarter',
        'period_year', 'status', 'compliance_status', 'portal_status', 'file_path', 'original_filename',
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
        'form_16', 'form_12ba', 'pt_return', 'lwf_return', 'bonus_form_c', 'bonus_form_d', 'bonus_form_e',
        'form_19', 'form_31', 'form_1', 'form_2', 'form_6', 'eshram_registration',
        'uan_activation', 'se_registration', 'shram_card_registration', 'form_124', 'full_ecr',
    ];

    // Filing workflow: generated -> submitted -> approved -> filed -> acknowledged
    const STATUSES = ['draft', 'generated', 'submitted', 'approved', 'filed', 'acknowledged', 'error'];

    // Compliance honesty classification for every filing type.
    // See the master payroll roadmap §2 for the policy this enforces.
    const COMPLIANCE_STATUSES = [
        'ready'            => 'Filing-ready: matches the government portal upload format exactly.',
        'reference_only'   => 'Reference-only: correct summary for HR records, not the legal upload format.',
        'needs_external_input' => 'Requires external input: cannot be completed by this system alone.',
        'not_configured'   => 'Not configured: no rates or rules set up for this filing yet.',
    ];

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
