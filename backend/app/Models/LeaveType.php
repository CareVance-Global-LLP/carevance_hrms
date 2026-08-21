<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One kind of leave, and the policy that governs how it is earned.
 *
 * Replaces the `annual_quota` number that used to live in
 * `organizations.settings.leave_policy.categories` — a single figure granted
 * whole on day one, which meant a November joiner received a full year of
 * entitlement and a February leaver had none to encash.
 */
class LeaveType extends Model
{
    use BelongsToOrganization;

    public const FREQUENCIES = ['annual', 'monthly', 'quarterly', 'half_yearly'];

    /** When in its period an accrual lands. */
    public const TIMINGS = ['period_start', 'period_end'];

    /** What happens to an unused balance when the leave year closes. */
    public const YEAR_END_ACTIONS = ['carry_forward', 'reset', 'encash'];

    protected $fillable = [
        'organization_id',
        'code',
        'name',
        'annual_quota',
        'accrual_frequency',
        'accrual_timing',
        'year_end_action',
        'pro_rate_on_join',
        'joining_cutoff_day',
        'probation_annual_quota',
        'notice_period_annual_quota',
        'carry_forward_cap',
        'carry_forward_expiry_months',
        'is_encashable',
        'is_paid',
        'is_active',
        'position',
    ];

    protected $casts = [
        'annual_quota' => 'decimal:2',
        'probation_annual_quota' => 'decimal:2',
        'notice_period_annual_quota' => 'decimal:2',
        'carry_forward_cap' => 'decimal:2',
        'pro_rate_on_join' => 'boolean',
        'is_encashable' => 'boolean',
        'is_paid' => 'boolean',
        'is_active' => 'boolean',
        'joining_cutoff_day' => 'integer',
        'carry_forward_expiry_months' => 'integer',
        'position' => 'integer',
    ];

    public function ledgerEntries(): HasMany
    {
        return $this->hasMany(LeaveLedgerEntry::class);
    }

    /** How many accrual periods a full leave year contains. */
    public function periodsPerYear(): int
    {
        return match ($this->accrual_frequency) {
            'monthly' => 12,
            'quarterly' => 4,
            'half_yearly' => 2,
            default => 1,
        };
    }

    /**
     * Entitlement for a full year, which differs on probation.
     *
     * A null probation quota means "same as everyone else" rather than zero —
     * treating unset as zero would silently stop accrual for every new joiner
     * the moment this column existed.
     */
    public function annualQuotaFor(bool $onProbation, bool $onNotice = false): float
    {
        /*
         * Notice outranks probation. Somebody can be both - a short probation
         * and a resignation inside it - and the notice rate is the one an
         * employer sets deliberately to stop leave being run down on the way
         * out, so it is the one that must win.
         *
         * NULL means "the normal rate" in both cases, never zero. Treating
         * unset as zero would silently stop accrual for everybody the moment
         * these columns existed.
         */
        if ($onNotice && $this->notice_period_annual_quota !== null) {
            return (float) $this->notice_period_annual_quota;
        }

        if ($onProbation && $this->probation_annual_quota !== null) {
            return (float) $this->probation_annual_quota;
        }

        return (float) $this->annual_quota;
    }

    /** Does an accrual land at the end of its period rather than the start? */
    public function accruesAtPeriodEnd(): bool
    {
        return $this->accrual_timing === 'period_end';
    }
}
