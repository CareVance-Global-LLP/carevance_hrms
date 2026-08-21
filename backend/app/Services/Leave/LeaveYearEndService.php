<?php

namespace App\Services\Leave;

use App\Models\LeaveLedgerEntry;
use App\Models\LeaveType;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * What happens to an unused balance when the leave year closes.
 *
 * Three policies, and they are genuinely different obligations rather than
 * presentation choices:
 *
 *   carry_forward  up to `carry_forward_cap` days move into the new year.
 *                  Anything above the cap expires.
 *   reset          the balance goes to zero. Nothing moves, nothing is owed.
 *   encash         the balance is paid out and then zeroed. This one creates a
 *                  PAYROLL liability, so it is recorded as an encashment the
 *                  settlement run can find rather than silently deleted.
 *
 * EVERY OUTCOME IS A LEDGER ROW. Nothing here edits or deletes an existing
 * entry, because the ledger is the explanation of a balance and an explanation
 * you can rewrite is not one. "Where did my 8 days go" has to expand into a
 * dated row saying expired, carried or encashed.
 *
 * IDEMPOTENT. The close is a scheduled job; it WILL be re-run after a failure
 * or by a nervous admin, and running it twice must not double a carry-forward
 * or pay an encashment again. Guarded on (user, type, kind, effective_on), the
 * same key the accrual service relies on.
 */
class LeaveYearEndService
{
    public function __construct(
        private readonly LeavePolicyService $policy,
    ) {
    }

    /**
     * Close one leave year for one person.
     *
     * `$cycleEnd` is the last day of the year being closed. Rows land ON that
     * day for the closing side and on the following day for the opening side,
     * so a balance breakdown for either year reads correctly on its own.
     *
     * @return array<string, mixed> what was done, per leave type
     */
    public function closeYearForUser(User $user, Carbon $cycleEnd): array
    {
        $cycleEnd = $cycleEnd->copy()->startOfDay();
        $cycleStart = $cycleEnd->copy()->subYear()->addDay();

        $types = LeaveType::query()
            ->where('organization_id', $user->organization_id)
            ->where('is_active', true)
            ->get();

        $outcomes = [];

        foreach ($types as $type) {
            $balance = $this->balanceFor($user, $type, $cycleStart, $cycleEnd);

            // A zero or negative balance has nothing to carry, expire or pay.
            // A NEGATIVE one is deliberately left alone rather than zeroed:
            // somebody took more than they earned, and erasing that at year end
            // hides an overdraft payroll may still need to recover.
            if ($balance <= 0) {
                continue;
            }

            $outcomes[$type->code] = match ($type->year_end_action) {
                'reset' => $this->expire($user, $type, $balance, $cycleEnd, 'Balance reset at year end'),
                'encash' => $this->encash($user, $type, $balance, $cycleEnd),
                default => $this->carryForward($user, $type, $balance, $cycleEnd, $cycleStart),
            };
        }

        return [
            'cycle_start' => $cycleStart->toDateString(),
            'cycle_end' => $cycleEnd->toDateString(),
            'types' => $outcomes,
        ];
    }

    /**
     * Carry what the cap allows and expire the rest.
     *
     * Two rows, not one net row. "You had 15, 10 carried and 5 expired" is the
     * sentence somebody needs; a single row for -5 cannot say it.
     *
     * @return array<string, mixed>
     */
    private function carryForward(User $user, LeaveType $type, float $balance, Carbon $cycleEnd, Carbon $cycleStart): array
    {
        $cap = (float) ($type->carry_forward_cap ?? 0);
        $carried = min($balance, max(0.0, $cap));
        $expired = round($balance - $carried, 2);

        if ($expired > 0) {
            $this->write($user, $type, -$expired, 'expiry', $cycleEnd, $cycleStart, $cycleEnd,
                sprintf('Expired at year end, above the %s day carry-forward limit', rtrim(rtrim(number_format($cap, 2, '.', ''), '0'), '.')));
        }

        if ($carried > 0) {
            /*
             * The closing year loses it and the new year gains it - two rows,
             * one on each side of the boundary. A single row would make one
             * year's ledger fail to add up to its own balance.
             */
            $this->write($user, $type, -$carried, 'carry_forward', $cycleEnd, $cycleStart, $cycleEnd,
                'Carried forward into the next leave year');

            $nextStart = $cycleEnd->copy()->addDay();
            $this->write($user, $type, $carried, 'carry_forward', $nextStart, $nextStart, $nextStart->copy()->addYear()->subDay(),
                'Carried forward from the previous leave year');
        }

        return ['action' => 'carry_forward', 'carried' => $carried, 'expired' => $expired];
    }

    /** @return array<string, mixed> */
    private function expire(User $user, LeaveType $type, float $balance, Carbon $cycleEnd, string $note): array
    {
        $cycleStart = $cycleEnd->copy()->subYear()->addDay();
        $this->write($user, $type, -$balance, 'expiry', $cycleEnd, $cycleStart, $cycleEnd, $note);

        return ['action' => 'reset', 'expired' => $balance];
    }

    /**
     * Pay the balance out and zero it.
     *
     * Recorded as an `encashment` rather than an expiry because it is money
     * owed, and a settlement run has to be able to find it. An encashable
     * policy on a type flagged `is_encashable = false` is a contradiction
     * somebody configured; the type-level flag wins, and the balance expires
     * instead of quietly creating a liability nobody agreed to.
     *
     * @return array<string, mixed>
     */
    private function encash(User $user, LeaveType $type, float $balance, Carbon $cycleEnd): array
    {
        if (! $type->is_encashable) {
            return $this->expire($user, $type, $balance, $cycleEnd,
                'Expired at year end - this leave type is not encashable');
        }

        $cycleStart = $cycleEnd->copy()->subYear()->addDay();
        $this->write($user, $type, -$balance, 'encashment', $cycleEnd, $cycleStart, $cycleEnd,
            'Encashed at year end');

        return ['action' => 'encash', 'encashed' => $balance];
    }

    /** The ledger balance for one type over one cycle. */
    private function balanceFor(User $user, LeaveType $type, Carbon $cycleStart, Carbon $cycleEnd): float
    {
        return round((float) LeaveLedgerEntry::query()
            ->where('user_id', $user->id)
            ->where('leave_type_id', $type->id)
            ->whereDate('effective_on', '>=', $cycleStart->toDateString())
            ->whereDate('effective_on', '<=', $cycleEnd->toDateString())
            ->sum('units'), 2);
    }

    /**
     * One ledger row, written once.
     *
     * firstOrNew on (user, type, kind, effective_on) rather than a plain insert:
     * the year-end close is a scheduled job and a second run must add nothing.
     */
    private function write(
        User $user,
        LeaveType $type,
        float $units,
        string $kind,
        Carbon $effectiveOn,
        Carbon $cycleStart,
        Carbon $cycleEnd,
        string $note,
    ): void {
        DB::transaction(function () use ($user, $type, $units, $kind, $effectiveOn, $cycleStart, $cycleEnd, $note) {
            $entry = LeaveLedgerEntry::query()->firstOrNew([
                'user_id' => $user->id,
                'leave_type_id' => $type->id,
                'kind' => $kind,
                'effective_on' => $effectiveOn->toDateString(),
            ]);

            if ($entry->exists) {
                return;
            }

            $entry->fill([
                'organization_id' => $user->organization_id,
                'units' => $units,
                'cycle_start' => $cycleStart->toDateString(),
                'cycle_end' => $cycleEnd->toDateString(),
                'source' => 'year_end_close',
                'note' => $note,
            ])->save();
        });
    }
}
