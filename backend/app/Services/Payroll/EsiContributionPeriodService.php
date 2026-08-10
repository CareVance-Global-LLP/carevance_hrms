<?php

namespace App\Services\Payroll;

use App\Models\PayrollItem;
use Carbon\Carbon;

/**
 * ESI contribution periods.
 *
 * Under the ESI Act coverage is fixed for a whole contribution period —
 * 1 April to 30 September, and 1 October to 31 March. An employee who is
 * covered at the start of a period stays covered until that period ends, even
 * if a raise takes their wages above the ₹21,000 ceiling partway through.
 * Contributions continue on the higher wages for the rest of the period.
 *
 * The calculator previously tested gross against the ceiling month by month
 * and dropped the employee the instant they crossed it, which under-collects
 * employee and employer ESI for the remainder of the period and leaves the
 * ECR return disagreeing with what was actually deducted.
 */
class EsiContributionPeriodService
{
    /**
     * Start and end of the contribution period containing $monthYear.
     *
     * @return array{start: Carbon, end: Carbon, label: string}
     */
    public function periodFor(string $monthYear): array
    {
        $month = Carbon::createFromFormat('Y-m', $monthYear)->startOfMonth();

        // April-September, else October-March (which spans the year boundary).
        if ($month->month >= 4 && $month->month <= 9) {
            $start = Carbon::create($month->year, 4, 1)->startOfMonth();
            $end = Carbon::create($month->year, 9, 1)->endOfMonth();
            $label = $month->year.'-H1';
        } elseif ($month->month >= 10) {
            $start = Carbon::create($month->year, 10, 1)->startOfMonth();
            $end = Carbon::create($month->year + 1, 3, 1)->endOfMonth();
            $label = $month->year.'-H2';
        } else {
            $start = Carbon::create($month->year - 1, 10, 1)->startOfMonth();
            $end = Carbon::create($month->year, 3, 1)->endOfMonth();
            $label = ($month->year - 1).'-H2';
        }

        return ['start' => $start, 'end' => $end, 'label' => $label];
    }

    /**
     * Whether ESI applies to $userId for $monthYear.
     *
     * Covered when this month's wages are at or under the ceiling, or when the
     * employee already contributed in an earlier month of the same contribution
     * period — the mid-period crossing case the Act requires us to carry.
     */
    public function isCovered(int $userId, int $organizationId, string $monthYear, float $gross, float $threshold): bool
    {
        if ($gross <= $threshold) {
            return true;
        }

        return $this->contributedEarlierInPeriod($userId, $organizationId, $monthYear);
    }

    /**
     * Did this employee already have ESI deducted in an earlier month of the
     * contribution period that contains $monthYear?
     */
    public function contributedEarlierInPeriod(int $userId, int $organizationId, string $monthYear): bool
    {
        $period = $this->periodFor($monthYear);

        // Month strings compare correctly as 'Y-m' text, so the period window
        // can be expressed without touching dates on the row.
        $periodStart = $period['start']->format('Y-m');

        return PayrollItem::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('month_year', '>=', $periodStart)
            ->where('month_year', '<', $monthYear)
            ->where('esi_employee', '>', 0)
            ->exists();
    }
}
