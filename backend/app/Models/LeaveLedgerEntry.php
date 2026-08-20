<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One movement of leave — earned, taken, carried, expired, encashed or adjusted.
 *
 * A balance is the SUM of these rows and is never stored anywhere. That is the
 * whole design: the question HR actually asks is not "what is my balance" but
 * "why is it that", and a counter cannot answer the second question. Every
 * figure the product shows can be expanded into the dated rows that produced it.
 *
 * `units` is signed — accrual positive, consumption negative — so the balance is
 * a plain `SUM(units)` with no branching on kind. A new kind therefore cannot be
 * forgotten by a balance query, which is the failure mode of every
 * sum-the-positives-minus-the-negatives implementation.
 */
class LeaveLedgerEntry extends Model
{
    use BelongsToOrganization;

    protected $table = 'leave_ledger';

    public const KINDS = [
        'opening_balance',
        'accrual',
        'consumption',
        'carry_forward',
        'expiry',
        'encashment',
        'adjustment',
    ];

    protected $fillable = [
        'organization_id',
        'user_id',
        'leave_type_id',
        'kind',
        'units',
        'effective_on',
        'cycle_start',
        'cycle_end',
        'source',
        'source_id',
        'note',
        'created_by',
    ];

    protected $casts = [
        'units' => 'decimal:2',
        // date:Y-m-d, not date — a plain date cast serialises as a UTC datetime
        // and reaches the client a day early in any timezone ahead of UTC.
        'effective_on' => 'date:Y-m-d',
        'cycle_start' => 'date:Y-m-d',
        'cycle_end' => 'date:Y-m-d',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function leaveType(): BelongsTo
    {
        return $this->belongsTo(LeaveType::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
