<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CompOffTransaction extends Model
{
    use HasFactory;

    protected $table = 'comp_off_transactions';

    protected $fillable = [
        'organization_id',
        'user_id',
        'comp_off_balance_id',
        'type',
        'days',
        'transaction_date',
        'reference_type',
        'reference_id',
        'description',
        'monetary_value',
    ];

    protected $casts = [
        'days' => 'integer',
        'transaction_date' => 'date',
        'monetary_value' => 'decimal:2',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function balance(): BelongsTo
    {
        return $this->belongsTo(CompOffBalance::class, 'comp_off_balance_id');
    }
}
