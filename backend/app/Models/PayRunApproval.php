<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayRunApproval extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'pay_run_id',
        'stage',
        'status',
        'action_by',
        'action_at',
        'comment',
        'rejection_reason',
        'meta',
    ];

    protected function casts(): array
    {
        return [
            'action_at' => 'datetime',
            'meta' => 'array',
        ];
    }

    public function payRun(): BelongsTo
    {
        return $this->belongsTo(PayRun::class);
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'action_by');
    }
}
