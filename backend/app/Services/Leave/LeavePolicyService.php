<?php

namespace App\Services\Leave;

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
