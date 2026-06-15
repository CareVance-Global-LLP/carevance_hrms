<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollRunChecklist extends Model
{
    protected $table = 'payroll_run_checklists';

    protected $fillable = [
        'organization_id', 'payroll_run_id', 'checklist_item_id', 'user_id',
        'status', 'message', 'resolution', 'is_resolved', 'resolved_by', 'resolved_at',
    ];

    protected $casts = [
        'is_resolved' => 'boolean',
        'resolved_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function payrollRun(): BelongsTo
    {
        return $this->belongsTo(PayrollMonthlyRun::class, 'payroll_run_id');
    }

    public function checklistItem(): BelongsTo
    {
        return $this->belongsTo(PayrollChecklistItem::class, 'checklist_item_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function resolvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'resolved_by');
    }
}
