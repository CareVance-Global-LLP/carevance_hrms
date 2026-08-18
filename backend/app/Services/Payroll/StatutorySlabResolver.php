<?php

namespace App\Services\Payroll;

use App\Services\PTStateService;
use Illuminate\Support\Facades\DB;

/**
 * Resolves a statutory slab for the period being computed.
 *
 * The single question this exists to answer correctly: when you recompute
 * March, whose slab applies? March's. Neither Keka nor greytHR documents an
 * answer, so it is decided here — the period's own — and it is the whole reason
 * the table carries a date range rather than a "current" flag.
 *
 * Resolution order, and why there is a fallback at all:
 *
 *   1. A statutory_slabs row covering the period. Vendor-owned, read-only to
 *      tenants, shipped as migrations.
 *   2. PTStateService's compiled constants.
 *
 * The fallback is deliberate and is not a second source of truth. The constants
 * are the bootstrap the table was seeded from, and they keep the calculator
 * usable in the two places a database is not: the pure unit tests that pin the
 * slab arithmetic, and a fresh install before migrations run. A statutory
 * calculator that cannot be exercised without a database is one nobody tests.
 *
 * Rates are not cached across periods. Two months in the same run can resolve
 * different slabs, which is the entire point, so a per-period memo is the only
 * safe one — and the query is a single indexed row.
 */
class StatutorySlabResolver
{
    /** @var array<string, array|null> keyed by kind|state|period */
    private array $memo = [];

    /**
     * Professional tax for one month, resolved against that month's slab.
     *
     * @param string $monthYear 'Y-m' — the period being computed, not today.
     */
    public function professionalTax(string $stateCode, float $monthlyGross, string $monthYear): float
    {
        $month = (int) (explode('-', $monthYear)[1] ?? 0) ?: null;
        $slab = $this->slabFor('pt', $stateCode, $monthYear);

        if ($slab === null) {
            // No row covers this period: fall back to the compiled table.
            return PTStateService::calculate($stateCode, $monthlyGross, $month);
        }

        $amount = $this->resolveBand($slab['monthly'] ?? [], $monthlyGross);

        // A special-month instalment applies only to the top band -- that is
        // what makes the top band total the statutory annual figure, and
        // applying it to every non-zero band over-collects from lower earners.
        if ($month !== null && ! empty($slab['special'])) {
            $monthName = strtolower(date('F', mktime(0, 0, 0, $month, 1)));
            $special = $slab['special'][$monthName] ?? null;

            if ($special !== null && $amount > 0 && $amount >= $this->topBand($slab['monthly'] ?? [])) {
                return (float) $special;
            }
        }

        return $amount;
    }

    /**
     * The raw slab payload governing a period, or null if none is stored.
     *
     * @return array<string, mixed>|null
     */
    public function slabFor(string $kind, string $stateCode, string $monthYear): ?array
    {
        $stateCode = strtolower(trim($stateCode));

        if ($stateCode === '') {
            return null;
        }

        $key = $kind.'|'.$stateCode.'|'.$monthYear;

        if (array_key_exists($key, $this->memo)) {
            return $this->memo[$key];
        }

        return $this->memo[$key] = $this->query($kind, $stateCode, $monthYear);
    }

    private function query(string $kind, string $stateCode, string $monthYear): ?array
    {
        // The period's LAST day. A slab taking effect on the 20th governs that
        // month: a wage base cannot change halfway through a statutory
        // contribution period without making the return unfilable.
        $periodEnd = date('Y-m-t', strtotime($monthYear.'-01'));

        try {
            $row = DB::table('statutory_slabs')
                ->where('kind', $kind)
                ->where('state_code', $stateCode)
                ->whereDate('effective_from', '<=', $periodEnd)
                ->where(function ($query) use ($periodEnd) {
                    $query->whereNull('effective_to')
                        ->orWhereDate('effective_to', '>=', $periodEnd);
                })
                // Newest applicable row wins, so a correction shipped later
                // supersedes without the old row having to be deleted.
                ->orderByDesc('effective_from')
                ->first();
        } catch (\Throwable) {
            // The table is absent (fresh install, or a test that does not
            // migrate). Fall back rather than fail a payroll run over it.
            return null;
        }

        if (! $row) {
            return null;
        }

        $slabs = json_decode((string) $row->slabs, true);

        return is_array($slabs) ? $slabs : null;
    }

    /**
     * Bands are stored half-open with min as "previous max + 1", so matching
     * has to be inclusive at both ends or a fractional gross -- which a
     * LOP-adjusted gross always is -- falls through the gap and pays nothing.
     *
     * @param array<int, array{min: float, max: float|null, amount: float}> $bands
     */
    private function resolveBand(array $bands, float $gross): float
    {
        foreach ($bands as $band) {
            $min = (float) ($band['min'] ?? 0);
            $max = $band['max'] ?? null;

            if ($gross >= $min && ($max === null || $gross <= (float) $max)) {
                return (float) ($band['amount'] ?? 0);
            }
        }

        // Above every stated band: the top band governs.
        return $this->topBand($bands);
    }

    /** @param array<int, array{amount: float}> $bands */
    private function topBand(array $bands): float
    {
        $top = 0.0;

        foreach ($bands as $band) {
            $top = max($top, (float) ($band['amount'] ?? 0));
        }

        return $top;
    }
}
