<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PayRun extends Model
{
    use BelongsToOrganization;

    protected $table = 'pay_runs';

    protected $fillable = [
        'organization_id',
        'run_code',
        'payroll_month',
        'status',
        'currency',
        'generated_by',
        'approved_by',
        'generated_at',
        'approved_at',
        'finalized_at',
        'locked_at',
        'summary',
        'warnings',
    ];

    protected $casts = [
        'generated_at' => 'datetime',
        'approved_at'  => 'datetime',
        'finalized_at' => 'datetime',
        'locked_at'    => 'datetime',
        'summary'      => 'array',
        'warnings'     => 'array',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function generatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function approvals(): HasMany
    {
        return $this->hasMany(PayRunApproval::class, 'pay_run_id');
    }
}
