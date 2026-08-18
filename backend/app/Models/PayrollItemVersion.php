<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A payroll figure that was replaced, and the hand that replaced it.
 *
 * Tenant-scoped like everything else that owns an organization_id. These rows
 * hold salary history, so they are exactly what the global scope exists to
 * fence: one tenant reading another's superseded payslips would be the same
 * breach as reading their current ones. The scope is a deliberate no-op when
 * there is no authenticated user, so console commands still see everything,
 * and the payroll jobs that write these already bind the acting user.
 *
 * organization_id is also denormalised onto the row rather than reached through
 * the item, so a version stays attributable after its item is gone — an audit
 * trail that disappears with the thing it audits is not one.
 *
 * There is no update path and no delete path by design. A superseded figure
 * that can itself be edited is not an audit trail either.
 */
class PayrollItemVersion extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'payroll_item_id',
        'organization_id',
        'user_id',
        'month_year',
        'version_no',
        'money_snapshot',
        'reason',
        'superseded_by',
        'superseded_at',
    ];

    protected $casts = [
        'money_snapshot' => 'array',
        'superseded_at' => 'datetime',
        'version_no' => 'integer',
    ];

    public function item(): BelongsTo
    {
        return $this->belongsTo(PayrollItem::class, 'payroll_item_id');
    }

    /** The person whose correction replaced this figure. */
    public function supersededBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'superseded_by');
    }

    /**
     * What this version paid, for the columns that carry money.
     *
     * @return array<string, float>
     */
    public function money(): array
    {
        return array_map(
            static fn ($value) => (float) $value,
            $this->money_snapshot ?? []
        );
    }
}
