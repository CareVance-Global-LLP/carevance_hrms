<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class CompOffBalance extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    protected $table = 'comp_off_balance';

    protected $fillable = [
        'organization_id',
        'user_id',
        'earned_days',
        'used_days',
        'expired_days',
        'balance_days',
        'applicable_year',
        'expiry_date',
        'transaction_history',
    ];

    protected $casts = [
        'earned_days' => 'integer',
        'used_days' => 'integer',
        'expired_days' => 'integer',
        'balance_days' => 'integer',
        'expiry_date' => 'date:Y-m-d',
        'transaction_history' => 'array',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function transactions(): HasMany
    {
        return $this->hasMany(CompOffTransaction::class, 'comp_off_balance_id');
    }
}
