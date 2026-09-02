<?php

namespace App\Models;

use App\Support\MonthYear;
use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A governed override, with one lifetime for every kind.
 *
 * The date range is the whole design. Keka carries three lifetimes for the same
 * concept and a payroll officer therefore cannot predict what next month will
 * do without knowing which kind of override they are looking at. Here:
 *
 *   permanent            effective_to null
 *   until cancelled      effective_to null, then closed
 *   this month only      effective_from = effective_to = that month
 *   range-bound          as stated
 *
 * One rule to explain, one to test, one to display in the register.
 */
class PayrollOverride extends Model
{
    use Auditable;
    use BelongsToOrganization;

    public const STATUS_PENDING = 'pending';
    public const STATUS_APPROVED = 'approved';
    public const STATUS_REJECTED = 'rejected';
    public const STATUS_CANCELLED = 'cancelled';

    protected $fillable = [
        'organization_id',
        'user_id',
        'scope',
        'target',
        'mode',
        'value',
        'computed_value',
        'balance_mode',
        'balancing_target_id',
        'cascade_snapshot',
        'effective_from',
        'effective_to',
        'reason',
        'status',
        'created_by',
        'approved_by',
        'approved_at',
        // Provenance. A CSV import writes hundreds of rows at once; without
        // these, "undo that import" and "which line produced this?" are both
        // unanswerable.
        'import_batch_id',
        'source_row',
        'source',
    ];

    protected $casts = [
        'value' => 'decimal:2',
        'computed_value' => 'decimal:2',
        'cascade_snapshot' => 'array',
        // date:Y-m-d, not date. A plain date cast serialises as a UTC datetime,
        // so a calendar date reaches the client a day early in any timezone
        // ahead of UTC — which for an override boundary means it silently
        // applies a month early.
        'effective_from' => 'date:Y-m-d',
        'effective_to' => 'date:Y-m-d',
        'approved_at' => 'datetime',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /** Who released it. Named on the breakdown so an override is attributable. */
    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** The component that absorbed the delta, as resolved when it was applied. */
    public function balancingTarget(): BelongsTo
    {
        return $this->belongsTo(SalaryComponent::class, 'balancing_target_id');
    }

    /**
     * Approved overrides in force for a pay month.
     *
     * Resolved against the month being computed, not against today — the same
     * rule as statutory slabs and the Code on Wages base. A recomputed March
     * must apply the overrides March had.
     */
    public function scopeInForceFor(Builder $query, string $monthYear): Builder
    {
        $periodEnd = MonthYear::end($monthYear)->toDateString();
        $periodStart = MonthYear::start($monthYear)->toDateString();

        return $query
            ->where('status', self::STATUS_APPROVED)
            ->whereDate('effective_from', '<=', $periodEnd)
            ->where(function (Builder $q) use ($periodStart) {
                // Open-ended, or not yet closed as at the start of the period.
                $q->whereNull('effective_to')
                    ->orWhereDate('effective_to', '>=', $periodStart);
            });
    }

    /**
     * What the override moved, relative to what the engine would have produced.
     *
     * Null while computed_value is unknown — an override that has never been
     * applied has no delta yet, and reporting one as zero would read as "this
     * changed nothing" rather than "this has not run".
     */
    public function delta(): ?float
    {
        if ($this->computed_value === null) {
            return null;
        }

        return round((float) $this->value - (float) $this->computed_value, 2);
    }

    public function isOpenEnded(): bool
    {
        return $this->effective_to === null;
    }
}
