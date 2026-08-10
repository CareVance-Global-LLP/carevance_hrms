<?php

namespace App\Services;

use App\Models\FbpComponent;
use App\Models\FbpAllocation;
use App\Models\FbpClaim;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class FbpService
{
    public function getAllocateComponent(int $orgId): array
    {
        return FbpComponent::where('organization_id', $orgId)
            ->where('is_active', true)
            ->get()
            ->toArray();
    }

    public function getAllocationForUser(int $userId, int $orgId, ?int $financialYearId = null): array
    {
        $query = FbpAllocation::with('component')
            ->where('user_id', $userId)
            ->where('organization_id', $orgId);

        if ($financialYearId) {
            $query->where('financial_year_id', $financialYearId);
        }

        return $query->get()->toArray();
    }

    public function allocateOrUpdate(int $userId, int $orgId, int $componentId, float $amount, ?int $financialYearId = null): FbpAllocation
    {
        $allocation = FbpAllocation::firstOrNew([
            'user_id' => $userId,
            'fbp_component_id' => $componentId,
            'financial_year' => $financialYearId,
            'organization_id' => $orgId,
        ]);

        $allocation->allocated_amount = $amount;
        $allocation->status = $amount > 0 ? 'active' : 'exhausted';
        $allocation->save();

        return $allocation;
    }

    public function submitClaim(array $data): FbpClaim
    {
        $claim = FbpClaim::create($data);

        // Looked the allocation up as `FbpClaim::find($claim->fbp_allocation_id)`
        // — a claim fetched by an allocation id. That either found nothing, so
        // the allocation's claimed_amount never moved and the employee could
        // claim the same benefit repeatedly, or it found an unrelated claim that
        // happened to share the id and incremented that instead. approveClaim()
        // below already uses the relation; match it.
        $allocation = $claim->allocation;
        if ($allocation) {
            $allocation->increment('claimed_amount', $data['claimed_amount']);
        }

        return $claim;
    }

    public function approveClaim(int $claimId, int $approvedBy, float $approvedAmount, ?string $monthYear = null): FbpClaim
    {
        $claim = FbpClaim::findOrFail($claimId);
        $claim->update([
            'status' => 'approved',
            'approved_by' => $approvedBy,
            'approved_amount' => $approvedAmount,
            'approved_at' => now(),
            'month_year' => $monthYear ?? now()->format('Y-m'),
        ]);

        $allocation = $claim->allocation;
        if ($allocation) {
            $allocation->increment('approved_amount', $approvedAmount);
            $allocation->increment('utilized_amount', $approvedAmount);
            if ($allocation->utilized_amount >= $allocation->allocated_amount) {
                $allocation->update(['status' => 'exhausted']);
            }
        }

        return $claim->fresh();
    }

    public function rejectClaim(int $claimId, int $reviewedBy, string $reason): FbpClaim
    {
        $claim = FbpClaim::findOrFail($claimId);
        $claim->update([
            'status' => 'rejected',
            'rejection_reason' => $reason,
            'approved_by' => $reviewedBy,
            'approved_at' => now(),
        ]);

        $allocation = $claim->allocation;
        if ($allocation) {
            $allocation->decrement('claimed_amount', $claim->claimed_amount);
        }

        return $claim->fresh();
    }

    public function getClaimsForMonth(int $orgId, string $monthYear, string $status = null): array
    {
        $query = FbpClaim::with(['user', 'component', 'allocation'])
            ->where('organization_id', $orgId)
            ->where('month_year', $monthYear);

        if ($status) {
            $query->where('status', $status);
        }

        return $query->get()->toArray();
    }

    public function calculateTaxExemptions(int $userId, int $orgId, ?int $financialYearId = null): array
    {
        $allocations = FbpAllocation::with('component')
            ->where('user_id', $userId)
            ->where('organization_id', $orgId);

        if ($financialYearId) {
            $allocations->where('financial_year_id', $financialYearId);
        }

        $result = [];
        foreach ($allocations->get() as $alloc) {
            $component = $alloc->component;
            $maxExempt = (float) ($component->max_exempt_limit ?? PHP_FLOAT_MAX);
            $approved = (float) $alloc->approved_amount;
            if ($component->is_taxable) {
                // Only the portion ABOVE the exemption limit is taxed; the
                // within-limit amount remains exempt.
                $exempt = min($approved, $maxExempt);
                $taxable = max(0, $approved - $exempt);
            } else {
                // Non-taxable components (e.g. food coupons) are exempt in
                // full — the entire approved amount is excluded from tax.
                $exempt = $approved;
                $taxable = 0;
            }

            $result[] = [
                'component' => $component->name,
                'category' => $component->category,
                'allocated' => (float) $alloc->allocated_amount,
                'approved' => $approved,
                'max_exempt' => $maxExempt,
                'exempt_amount' => $exempt,
                'taxable_amount' => $taxable,
            ];
        }

        return $result;
    }

    public function getMonthlyFbpAmount(int $userId, int $orgId, string $monthYear): float
    {
        return (float) FbpClaim::where('user_id', $userId)
            ->where('organization_id', $orgId)
            ->where('month_year', $monthYear)
            ->where('status', 'approved')
            ->sum('approved_amount');
    }

    /**
     * Annual amount of approved FBP that should be EXCLUDED from the tax
     * base for a user.
     *
     * FBP is paid in full (earnings are untouched), but only the portion
     * above each component's exemption limit is taxable. Non-taxable
     * components (e.g. food coupons) are excluded entirely.
     *
     * The result equals the sum over components of
     * (approved_amount - taxable_amount), so the excess over the limit is
     * what remains taxable.
     */
    public function getFbpTaxExclusion(int $userId, int $orgId, ?int $financialYearId = null): float
    {
        $exclusion = 0.0;
        foreach ($this->calculateTaxExemptions($userId, $orgId, $financialYearId) as $row) {
            $exclusion += (float) $row['approved'] - (float) $row['taxable_amount'];
        }

        return $exclusion;
    }
}
