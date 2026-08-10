<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ReimbursementPayrollLink extends Model
{
    use BelongsToOrganization;

    protected $table = 'reimbursement_payroll_links';

    protected $fillable = [
        'organization_id', 'reimbursement_id', 'payroll_item_id', 'amount',
        'month_year', 'status',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function reimbursement(): BelongsTo
    {
        return $this->belongsTo(Reimbursement::class);
    }

    public function payrollItem(): BelongsTo
    {
        return $this->belongsTo(PayrollItem::class);
    }
}
