<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollFiling extends Model
{
    protected $table = 'payroll_filings';

    protected $fillable = [
        'organization_id', 'type', 'period_type', 'period_month', 'period_quarter',
        'period_year', 'status', 'file_path', 'original_filename', 'acknowledgment_number',
        'generated_at', 'filed_at', 'acknowledged_at', 'generated_by', 'filed_by',
        'meta_data', 'notes',
    ];

    protected $casts = [
        'generated_at' => 'datetime',
        'filed_at' => 'datetime',
        'acknowledged_at' => 'datetime',
        'meta_data' => 'array',
    ];

    const TYPES = [
        'pf_ecr', 'esi_challan', 'esi_return', 'form_24q', 'form_26q',
        'form_16', 'form_12ba', 'pt_return', 'lwf_return', 'bonus_form_c', 'bonus_form_d',
    ];

    const STATUSES = ['draft', 'generated', 'filed', 'acknowledged', 'error'];

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

    public function scopeOfType($query, string $type)
    {
        return $query->where('type', $type);
    }

    public function scopeForPeriod($query, string $periodType, $year, $month = null, $quarter = null)
    {
        $query->where('period_type', $periodType)->where('period_year', $year);
        if ($month) $query->where('period_month', $month);
        if ($quarter) $query->where('period_quarter', $quarter);
        return $query;
    }
}
