<?php

namespace App\Services\Leave;

use App\Models\LeaveLedgerEntry;
use App\Models\LeaveType;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Works out how much leave somebody has earned, and writes it to the ledger.
 *
 * The rules, in the order they apply — and the order matters, because each one
 * narrows what the next operates on:
 *
 *   1. WHICH PERIODS the leave year contains (one, four or twelve).
 *   2. WHETHER the person was employed for a given period at all.
 *   3. HOW MUCH a partial first period is worth, which is the joining-cutoff rule.
 *   4. WHAT the per-period rate is, which differs on probation.
 *
 * Get that order wrong and you get the bug this replaces: a full year's
 * entitlement handed to somebody who joined in November, because step 1 was the
 * only step.
 *
 * Nothing here computes a balance. Balance is `SUM(units)` over the ledger —
 * see LeaveLedgerEntry for why that is not an optimisation waiting to happen.
 */
class LeaveAccrualService
{
    /**
     * Accrue everything owed to a person, up to and including `asOf`.
     *
     * Idempotent by construction: each accrual row is unique on
     * (user, type, effective_on), enforced by the database, so a re-run after a
     * failure or a policy edit adds nothing it has already added. The accrual
     * job WILL be re-run — after a crash, by a nervous admin — and a
     * double-accrual is invisible until somebody takes leave they never earned.
     *
     * @return int number of ledger rows written
     */
    public function accrueForUser(User $user, ?Carbon $asOf = null): int
    {
        $asOf = ($asOf ?: now())->copy()->startOfDay();
        $joined = $this->joiningDate($user);

        if (! $joined || $joined->greaterThan($asOf)) {
            return 0;
        }

        $types = LeaveType::query()
            ->where('organization_id', $user->organization_id)
            ->where('is_active', true)
            ->get();

        $written = 0;

        foreach ($types as $type) {
            foreach ($this->periodsFor($type, $asOf) as [$periodStart, $periodEnd]) {
                // Not employed yet when the period closed — nothing to earn.
                if ($joined->greaterThan($periodEnd)) {
                    continue;
                }

                $units = $this->unitsForPeriod($user, $type, $joined, $periodStart, $periodEnd);
                if ($units <= 0) {
                    continue;
                }

                $written += $this->record($user, $type, $units, $periodStart, $periodEnd);
            }
        }

        return $written;
    }

    /**
     * The accrual periods of the current leave year that have already STARTED.
     *
     * Accrual is credited at the start of its period, which is what "you get a
     * day and a half a month" means to the person receiving it. Crediting at the
     * end would mean somebody who joined on the 1st could take nothing until
     * the 31st.
     *
     * @return array<int, array{0: Carbon, 1: Carbon}>
     */
    private function periodsFor(LeaveType $type, Carbon $asOf): array
    {
        $cycleStart = $this->cycleStart($asOf);
        $periods = [];

        $count = $type->periodsPerYear();
        $monthsPerPeriod = intdiv(12, $count);

        for ($index = 0; $index < $count; $index++) {
            $start = $cycleStart->copy()->addMonths($index * $monthsPerPeriod);
            $end = $start->copy()->addMonths($monthsPerPeriod)->subDay();

            if ($start->greaterThan($asOf)) {
                break;
            }

            $periods[] = [$start, $end];
        }

        return $periods;
    }

    /**
     * What one period is worth to this person.
     *
     * The joining-cutoff rule only applies to the period somebody JOINED in.
     * Every later period is a full period — a mid-month joiner is not penalised
     * for the rest of their career, which is what applying the rule
     * unconditionally would do.
     */
    private function unitsForPeriod(User $user, LeaveType $type, Carbon $joined, Carbon $periodStart, Carbon $periodEnd): float
    {
        $annual = $type->annualQuotaFor($this->onProbationDuring($user, $periodEnd));
        if ($annual <= 0) {
            return 0.0;
        }

        $perPeriod = $annual / $type->periodsPerYear();

        $joinedThisPeriod = $joined->betweenIncluded($periodStart, $periodEnd);
        if (! $joinedThisPeriod) {
            return $this->round($perPeriod);
        }

        if (! $type->pro_rate_on_join) {
            return $this->round($perPeriod);
        }

        /*
         * The cutoff rule, as Keka states it and as buyers ask for it: join on
         * or before the cutoff day and the period accrues in full; join after
         * it and the period accrues nothing.
         *
         * Deliberately a cliff rather than a daily proportion. A proportion
         * produces figures like 1.27 days that no HR team can reconcile against
         * a payslip, and every Indian policy I can find states this as a date
         * rule rather than a ratio.
         */
        return $joined->day <= $type->joining_cutoff_day ? $this->round($perPeriod) : 0.0;
    }

    /**
     * Write one accrual row, unless it is already there.
     *
     * `firstOrCreate` on the same key the unique index covers, so a concurrent
     * second run loses the race at the database rather than double-crediting.
     */
    private function record(User $user, LeaveType $type, float $units, Carbon $periodStart, Carbon $periodEnd): int
    {
        $cycleStart = $this->cycleStart($periodStart);

        $created = false;

        DB::transaction(function () use ($user, $type, $units, $periodStart, $cycleStart, &$created) {
            $entry = LeaveLedgerEntry::query()->firstOrNew([
                'user_id' => $user->id,
                'leave_type_id' => $type->id,
                'kind' => 'accrual',
                'effective_on' => $periodStart->toDateString(),
            ]);

            if ($entry->exists) {
                return;
            }

            $entry->fill([
                'organization_id' => $user->organization_id,
                'units' => $units,
                'cycle_start' => $cycleStart->toDateString(),
                'cycle_end' => $cycleStart->copy()->addYear()->subDay()->toDateString(),
                'source' => 'accrual_run',
                'note' => sprintf('%s accrual for %s', ucfirst($type->accrual_frequency), $periodStart->format('M Y')),
            ])->save();

            $created = true;
        });

        return $created ? 1 : 0;
    }

    /**
     * Balance for one leave type, as of a date.
     *
     * A SUM, with no branching on kind — see LeaveLedgerEntry.
     */
    public function balanceFor(User $user, LeaveType $type, ?Carbon $asOf = null): float
    {
        $asOf = ($asOf ?: now())->copy()->endOfDay();

        return (float) LeaveLedgerEntry::query()
            ->where('user_id', $user->id)
            ->where('leave_type_id', $type->id)
            ->whereDate('effective_on', '<=', $asOf->toDateString())
            ->sum('units');
    }

    /** Round to a half day. Indian policies are stated in half days; thirds are not a thing. */
    private function round(float $units): float
    {
        return round($units * 2) / 2;
    }

    private function cycleStart(Carbon $date): Carbon
    {
        // Calendar year, matching LeavePolicyService::currentCycleStart(). A
        // configurable leave year belongs here when it lands, so that both this
        // and the balance snapshot change together rather than drifting.
        return $date->copy()->startOfYear();
    }

    /**
     * When employment actually started.
     *
     * Read from `employee_work_infos.joining_date`, NOT from the user — this
     * schema keeps employment detail off the users table, and `$user->joining_date`
     * silently resolves to null there rather than erroring. Accrual then fell
     * back to `created_at`, which is the day the ACCOUNT was made: a
     * long-serving employee onboarded onto the system last week would have
     * accrued from last week, and every test asserting a mid-year joiner got
     * today's date instead.
     *
     * `created_at` remains the last resort, because a person with no work info
     * accruing from their account date is better than one accruing nothing at
     * all — but it is a fallback, not the source.
     */
    private function joiningDate(User $user): ?Carbon
    {
        $raw = $user->employeeWorkInfo?->joining_date ?? $user->created_at;

        return $raw ? Carbon::parse($raw)->startOfDay() : null;
    }

    /**
     * Whether somebody was still on probation at a given date.
     *
     * Falls back to "not on probation" when the organization records no
     * probation period — an unknown probation must not silently reduce
     * everyone's accrual to the probation rate.
     */
    private function onProbationDuring(User $user, Carbon $date): bool
    {
        $joined = $this->joiningDate($user);
        if (! $joined) {
            return false;
        }

        $months = (int) data_get($user->organization?->settings, 'probation_months', 0);
        if ($months <= 0) {
            return false;
        }

        return $date->lessThan($joined->copy()->addMonths($months));
    }
}
