<?php

namespace App\Services\Leave;

use App\Models\LeaveLedgerEntry;
use App\Models\LeaveType;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;

class LeavePolicyService
{
    /**
     * @return array<int, array{code:string,name:string,annual_quota:float}>
     */
    public function resolvePolicyCategories(?Organization $organization): array
    {
        $settings = is_array($organization?->settings) ? $organization->settings : [];
        $rawCategories = $settings['leave_policy']['categories'] ?? [];

        $defaults = [
            ['code' => 'paid', 'name' => 'Paid Leave', 'annual_quota' => 21.0],
            ['code' => 'sick', 'name' => 'Sick Leave', 'annual_quota' => 12.0],
            ['code' => 'birthday', 'name' => 'Birthday Leave', 'annual_quota' => 1.0],
        ];

        $normalized = collect(is_array($rawCategories) ? $rawCategories : [])
            ->map(function ($row) {
                $code = strtolower(trim((string) data_get($row, 'code', '')));
                $name = trim((string) data_get($row, 'name', ''));
                $quota = max(0.0, (float) data_get($row, 'annual_quota', 0));

                if ($code === '' || $name === '') {
                    return null;
                }

                if ($code === 'unpaid') {
                    return null;
                }

                return [
                    'code' => preg_replace('/[^a-z0-9_\-]/', '', str_replace(' ', '_', $code)) ?: '',
                    'name' => $name,
                    'annual_quota' => $quota,
                ];
            })
            ->filter(fn ($row) => is_array($row) && $row['code'] !== '')
            ->unique('code')
            ->values();

        if ($normalized->isEmpty()) {
            return $defaults;
        }

        return $normalized->all();
    }

    public function normalizeRequestedCategory(string $category, array $policyCategories): string
    {
        $candidate = strtolower(trim($category));
        if ($candidate === 'unpaid') {
            return 'unpaid';
        }

        $allowed = collect($policyCategories)->pluck('code')->map(fn ($code) => strtolower((string) $code));

        return $allowed->contains($candidate) ? $candidate : 'paid';
    }

    public function currentCycleStart(): Carbon
    {
        return now()->startOfYear();
    }

    public function currentCycleEnd(): Carbon
    {
        return now()->endOfYear();
    }

    public function calculateLeaveUnits(LeaveRequest $leave): float
    {
        if (! $leave->start_date || ! $leave->end_date) {
            return 0.0;
        }

        return (float) $leave
            ->effectiveDateEntriesInRange(
                Carbon::parse($leave->start_date)->startOfDay(),
                Carbon::parse($leave->end_date)->endOfDay(),
                true
            )
            ->sum(fn (array $item) => (float) ($item['units'] ?? 0));
    }

    /**
     * @return array<int, array{category:string,units:float}>
     */
    public function buildConsumptionBreakdown(
        LeaveRequest $targetLeave,
        array $policyCategories,
        Collection $approvedLeavesInCycle
    ): array {
        $requestedCategory = $this->normalizeRequestedCategory((string) ($targetLeave->leave_category ?? 'paid'), $policyCategories);
        $requestedUnits = $this->calculateLeaveUnits($targetLeave);

        $usedByCategory = $this->buildUsedByCategoryMap($approvedLeavesInCycle);
        $categoryQuotaMap = collect($policyCategories)
            ->mapWithKeys(fn (array $row) => [strtolower((string) $row['code']) => (float) ($row['annual_quota'] ?? 0)])
            ->all();

        $remainingUnits = $requestedUnits;
        $breakdown = [];

        if ($requestedCategory !== 'unpaid') {
            $quota = (float) ($categoryQuotaMap[$requestedCategory] ?? 0);
            $used = (float) ($usedByCategory[$requestedCategory] ?? 0);
            $available = max(0.0, $quota - $used);
            $applied = min($available, $remainingUnits);

            if ($applied > 0) {
                $breakdown[] = [
                    'category' => $requestedCategory,
                    'units' => round($applied, 2),
                ];
                $remainingUnits -= $applied;
            }
        }

        if ($remainingUnits > 0) {
            $breakdown[] = [
                'category' => 'unpaid',
                'units' => round($remainingUnits, 2),
            ];
        }

        if (empty($breakdown)) {
            $breakdown[] = [
                'category' => 'unpaid',
                'units' => 0.0,
            ];
        }

        return $breakdown;
    }

    /**
     * @return array{cycle: array{start_date:string,end_date:string}, categories: array<int, array<string,mixed>>, unpaid: array{used:float}, totals: array{used:float,remaining:float,quota:float}}
     */
    /**
     * The same snapshot, built from the ledger instead of a flat quota.
     *
     * Used when the organization has leave types configured. Falls back to the
     * JSON quota otherwise, so an organization that has not been migrated keeps
     * working unchanged — this is a switchover, not a cutover, and both paths
     * have to be live at once while it happens.
     *
     * The shape is identical to the quota version on purpose. Every consumer —
     * the ESS screen, the request drawer, the admin balance view — reads
     * `annual_quota`, `used` and `remaining`, and a switchover that also changed
     * the payload would be two migrations at once.
     *
     * What changes is the MEANING of `annual_quota`: under the ledger it is
     * what has been ACCRUED so far, not what will eventually be granted. For a
     * type on the `annual` schedule those are the same number, which is why the
     * migration backfilled every existing type to `annual` — nobody's balance
     * moves on the day this goes live.
     */
    public function buildLedgerBalanceSnapshotForUser(User $targetUser, array $policyCategories): array
    {
        $types = LeaveType::query()
            ->where('organization_id', $targetUser->organization_id)
            ->where('is_active', true)
            ->orderBy('position')
            ->get();

        if ($types->isEmpty()) {
            return $this->buildBalanceSnapshotForUser($targetUser, $policyCategories);
        }

        $cycleStart = $this->currentCycleStart();
        $cycleEnd = $this->currentCycleEnd();

        // One query for the whole ledger rather than three per type. Grouped by
        // type and sign: accrued is what was credited, used is what was drawn
        // down, and the balance is their sum.
        $rows = LeaveLedgerEntry::query()
            ->where('user_id', $targetUser->id)
            ->whereDate('effective_on', '>=', $cycleStart->toDateString())
            ->whereDate('effective_on', '<=', $cycleEnd->toDateString())
            ->get(['leave_type_id', 'units'])
            ->groupBy('leave_type_id');

        $categories = $types->map(function (LeaveType $type) use ($rows) {
            $entries = collect($rows->get($type->id, []));

            $accrued = round((float) $entries->where('units', '>', 0)->sum('units'), 2);
            $used = round((float) abs($entries->where('units', '<', 0)->sum('units')), 2);

            return [
                'code' => strtolower((string) $type->code),
                'name' => (string) $type->name,
                'annual_quota' => $accrued,
                'used' => $used,
                'remaining' => round(max(0.0, $accrued - $used), 2),
            ];
        })->values();

        // Unpaid has no entitlement and therefore no ledger rows, so it is still
        // reported from the requests themselves.
        $approvedLeaves = LeaveRequest::query()
            ->where('organization_id', $targetUser->organization_id)
            ->where('user_id', $targetUser->id)
            ->where('status', 'approved')
            ->whereDate('end_date', '>=', $cycleStart->toDateString())
            ->whereDate('start_date', '<=', $cycleEnd->toDateString())
            ->get();

        $unpaidUsed = round((float) ($this->buildUsedByCategoryMap($approvedLeaves)['unpaid'] ?? 0), 2);

        $totals = $categories->reduce(function (array $carry, array $row) {
            $carry['quota'] += (float) $row['annual_quota'];
            $carry['used'] += (float) $row['used'];
            $carry['remaining'] += (float) $row['remaining'];

            return $carry;
        }, ['quota' => 0.0, 'used' => 0.0, 'remaining' => 0.0]);

        return [
            'cycle' => [
                'start_date' => $cycleStart->toDateString(),
                'end_date' => $cycleEnd->toDateString(),
            ],
            'categories' => $categories->all(),
            'unpaid' => ['used' => $unpaidUsed],
            'totals' => [
                'quota' => round((float) $totals['quota'], 2),
                'used' => round((float) $totals['used'], 2),
                'remaining' => round((float) $totals['remaining'], 2),
            ],
        ];
    }

    public function buildBalanceSnapshotForUser(User $targetUser, array $policyCategories): array
    {
        $cycleStart = $this->currentCycleStart();
        $cycleEnd = $this->currentCycleEnd();

        $approvedLeaves = LeaveRequest::query()
            ->where('organization_id', $targetUser->organization_id)
            ->where('user_id', $targetUser->id)
            ->where('status', 'approved')
            ->whereDate('end_date', '>=', $cycleStart->toDateString())
            ->whereDate('start_date', '<=', $cycleEnd->toDateString())
            ->orderBy('reviewed_at')
            ->orderBy('id')
            ->get();

        $usedByCategory = $this->buildUsedByCategoryMap($approvedLeaves);

        $categories = collect($policyCategories)->map(function (array $category) use ($usedByCategory) {
            $code = strtolower((string) ($category['code'] ?? ''));
            $quota = max(0.0, (float) ($category['annual_quota'] ?? 0));
            $used = round((float) ($usedByCategory[$code] ?? 0), 2);
            $remaining = round(max(0.0, $quota - $used), 2);

            return [
                'code' => $code,
                'name' => (string) ($category['name'] ?? ucfirst($code)),
                'annual_quota' => round($quota, 2),
                'used' => $used,
                'remaining' => $remaining,
            ];
        })->values();

        $paidTotals = $categories->reduce(function (array $carry, array $row) {
            $carry['quota'] += (float) ($row['annual_quota'] ?? 0);
            $carry['used'] += (float) ($row['used'] ?? 0);
            $carry['remaining'] += (float) ($row['remaining'] ?? 0);
            return $carry;
        }, ['quota' => 0.0, 'used' => 0.0, 'remaining' => 0.0]);

        return [
            'cycle' => [
                'start_date' => $cycleStart->toDateString(),
                'end_date' => $cycleEnd->toDateString(),
            ],
            'categories' => $categories->all(),
            'unpaid' => [
                'used' => round((float) ($usedByCategory['unpaid'] ?? 0), 2),
            ],
            'totals' => [
                'quota' => round((float) $paidTotals['quota'], 2),
                'used' => round((float) $paidTotals['used'], 2),
                'remaining' => round((float) $paidTotals['remaining'], 2),
            ],
        ];
    }

    /**
     * @param Collection<int, LeaveRequest> $approvedLeaves
     * @return array<string, float>
     */
    private function buildUsedByCategoryMap(Collection $approvedLeaves): array
    {
        $usedByCategory = [];

        foreach ($approvedLeaves as $leave) {
            $breakdown = collect((array) ($leave->consumed_breakdown ?? []))
                ->filter(fn ($item) => is_array($item));

            if ($breakdown->isEmpty()) {
                $fallbackCategory = strtolower(trim((string) ($leave->leave_category ?: 'paid')));
                $fallbackCategory = $fallbackCategory !== '' ? $fallbackCategory : 'paid';
                $usedByCategory[$fallbackCategory] = ($usedByCategory[$fallbackCategory] ?? 0) + $this->calculateLeaveUnits($leave);
                continue;
            }

            foreach ($breakdown as $item) {
                $category = strtolower(trim((string) data_get($item, 'category', 'unpaid')));
                if ($category === '') {
                    $category = 'unpaid';
                }
                $units = max(0.0, (float) data_get($item, 'units', 0));
                $usedByCategory[$category] = ($usedByCategory[$category] ?? 0) + $units;
            }
        }

        return $usedByCategory;
    }
}
