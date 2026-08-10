<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ExitInterview extends Model
{
    use BelongsToOrganization;

    public const REASONS = [
        'compensation', 'career_growth', 'management', 'work_life_balance',
        'relocation', 'health', 'higher_studies', 'role_mismatch', 'culture', 'other',
    ];

    protected $fillable = [
        'organization_id',
        'employee_exit_id',
        'primary_reason',
        'responses',
        'would_recommend',
        'would_rejoin',
        'comments',
        'is_confidential',
        'conducted_by',
        'submitted_at',
    ];

    protected $casts = [
        'responses' => 'array',
        'would_recommend' => 'integer',
        'would_rejoin' => 'boolean',
        'is_confidential' => 'boolean',
        'submitted_at' => 'datetime',
    ];

    public function exit(): BelongsTo
    {
        return $this->belongsTo(EmployeeExit::class, 'employee_exit_id');
    }

    public function conductedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'conducted_by');
    }
}
