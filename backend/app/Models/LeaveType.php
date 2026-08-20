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

    public const FREQUENCIES = ['annual', 'monthly', 'quarterly'];

    protected $fillable = [
        'organization_id',
        'code',
        'name',
        'annual_quota',
        'accrual_frequency',
        'pro_rate_on_join',
        'joining_cutoff_day',
        'probation_annual_quota',
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
    public function annualQuotaFor(bool $onProbation): float
    {
        if ($onProbation && $this->probation_annual_quota !== null) {
            return (float) $this->probation_annual_quota;
        }

        return (float) $this->annual_quota;
    }
}
