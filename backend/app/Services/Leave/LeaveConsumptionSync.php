<?php

namespace App\Services\Leave;

use App\Models\LeaveLedgerEntry;
use App\Models\LeaveRequest;
use App\Models\LeaveType;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * Mirrors approved leave into the ledger as consumption.
 *
 * The ledger only tells the truth if it holds BOTH sides. Accrual alone gives a
 * balance that never goes down, so the leave somebody has actually taken has to
 * arrive as rows too.
 *
 * Attribution is deliberately delegated to LeavePolicyService rather than
 * reimplemented: a request can consume across several categories through
 * `consumed_breakdown`, with a fallback to `leave_category`, and half days count
 * as half. Working that out twice is how a ledger ends up disagreeing with the
 * balance the product already shows — which is worse than having no ledger,
 * because now two screens contradict each other.
 *
 * Idempotent on (leave request, leave type): re-running syncs updates rather
 * than appends, so an amended or revoked request corrects itself instead of
 * double-counting.
 */
class LeaveConsumptionSync
{
    public function __construct(
        private readonly LeavePolicyService $policyService,
    ) {
    }

    /**
     * Bring the ledger in line with this person's approved leave for a cycle.
     *
     * @return int rows written or corrected
     */
    public function syncForUser(User $user, ?Carbon $cycleStart = null): int
    {
        $cycleStart = ($cycleStart ?: $this->policyService->currentCycleStart())->copy()->startOfDay();
        $cycleEnd = $cycleStart->copy()->addYear()->subDay()->endOfDay();

        $types = LeaveType::query()
            ->where('organization_id', $user->organization_id)
            ->get()
            ->keyBy(fn (LeaveType $type) => strtolower($type->code));

        if ($types->isEmpty()) {
            return 0;
        }

        $approved = LeaveRequest::query()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('status', 'approved')
            ->whereDate('end_date', '>=', $cycleStart->toDateString())
            ->whereDate('start_date', '<=', $cycleEnd->toDateString())
            ->orderBy('id')
            ->get();

        $written = 0;

        foreach ($approved as $leave) {
            foreach ($this->unitsByCategory($leave) as $category => $units) {
                /*
                 * `unpaid` is not an entitlement and has no type, so it has no
                 * balance to draw down. It is still reported separately by the
                 * balance snapshot, from the requests themselves.
                 */
                $type = $types->get(strtolower($category));
                if (! $type || $units <= 0) {
                    continue;
                }

                $written += $this->record($user, $type, $leave, (float) $units, $cycleStart, $cycleEnd);
            }
        }

        return $written;
    }

    /**
     * How a single request splits across categories.
     *
     * Mirrors LeavePolicyService::buildUsedByCategoryMap for one request —
     * `consumed_breakdown` when present, otherwise the whole request against
     * `leave_category`.
     *
     * @return array<string, float>
     */
    private function unitsByCategory(LeaveRequest $leave): array
    {
        $breakdown = collect((array) ($leave->consumed_breakdown ?? []))
            ->filter(fn ($item) => is_array($item));

        if ($breakdown->isEmpty()) {
            $category = strtolower(trim((string) ($leave->leave_category ?: 'paid'))) ?: 'paid';

            return [$category => $this->policyService->calculateLeaveUnits($leave)];
        }

        return $breakdown->reduce(function (array $carry, array $item) {
            $category = strtolower(trim((string) data_get($item, 'category', 'unpaid'))) ?: 'unpaid';
            $carry[$category] = ($carry[$category] ?? 0) + max(0.0, (float) data_get($item, 'units', 0));

            return $carry;
        }, []);
    }

    /**
     * One consumption row per (request, type), created or corrected.
     *
     * Negative, because the ledger is signed and a balance is a plain SUM — see
     * LeaveLedgerEntry.
     */
    private function record(User $user, LeaveType $type, LeaveRequest $leave, float $units, Carbon $cycleStart, Carbon $cycleEnd): int
    {
        $entry = LeaveLedgerEntry::query()->firstOrNew([
            'user_id' => $user->id,
            'leave_type_id' => $type->id,
            'kind' => 'consumption',
            'source' => 'leave_request',
            'source_id' => $leave->id,
        ]);

        $units = -1 * round($units, 2);

        // Effective on the day the leave STARTED, not when it was approved: a
        // request approved in April for March belongs to March.
        $effectiveOn = Carbon::parse($leave->start_date)->toDateString();

        if ($entry->exists
            && (float) $entry->units === $units
            && $entry->effective_on?->toDateString() === $effectiveOn) {
            return 0;
        }

        $entry->fill([
            'organization_id' => $user->organization_id,
            'units' => $units,
            'effective_on' => $effectiveOn,
            'cycle_start' => $cycleStart->toDateString(),
            'cycle_end' => $cycleEnd->toDateString(),
            'note' => sprintf('Leave %s to %s', $leave->start_date, $leave->end_date),
        ])->save();

        return 1;
    }

    /** @return Collection<int, LeaveType> */
    public function typesFor(User $user): Collection
    {
        return LeaveType::query()
            ->where('organization_id', $user->organization_id)
            ->where('is_active', true)
            ->orderBy('position')
            ->get();
    }
}
