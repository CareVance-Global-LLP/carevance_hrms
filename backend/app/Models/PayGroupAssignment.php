<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayGroupAssignment extends Model
{
    use BelongsToOrganization;

    protected $table = 'pay_group_assignments';

    protected $fillable = [
        'organization_id', 'pay_group_id', 'user_id', 'effective_from', 'effective_to', 'is_active',
    ];

    protected $casts = [
        'effective_from' => 'date:Y-m-d',
        'effective_to' => 'date:Y-m-d',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function payGroup(): BelongsTo
    {
        return $this->belongsTo(PayGroup::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
