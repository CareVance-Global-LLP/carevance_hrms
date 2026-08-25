<?php

namespace App\Services\Reports;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Joiners, leavers and a running headcount, by month.
 *
 * There was no server aggregation of joining_date and exit_date anywhere
 * except inside `GET /payroll/runs/{id}/review`, which needs a payroll run to
 * exist for the month in question — so a dashboard wanting twelve months of
 * movement had to pull every user row and reduce in the browser. That reduce
 * also cannot see anybody removed from the directory, so it silently
 * undercounts leavers.
 *
 * Two grouped queries, whatever the range.
 *
 * The running total is computed BACKWARDS from today's headcount rather than
 * forwards from zero: the joining dates in `employee_work_infos` do not reach
 * back to the organisation's founding, so counting up from the first recorded
 * joiner produces a curve that is wrong at every point and happens to be right
 * at the end. Anchoring on a number we actually know and walking back is wrong
 * only where the data is genuinely missing.
 */
class HeadcountSeriesService
{
    /**
     * @return array{
     *   from:string, to:string, current_headcount:int,
     *   months:array<int, array{month:string, joined:int, left:int, headcount:int}>
     * }
     */
    public function monthly(int $organizationId, ?string $from = null, ?string $to = null): array
    {
        $end = $to ? Carbon::parse($to)->endOfMonth() : now()->endOfMonth();
        /*
         * subMonthsNoOverflow, not subMonths. From 31 August, subMonths(11)
         * lands on a 31 September that does not exist and Carbon rolls it
         * forward to 1 October — so the "last 12 months" quietly became 11,
         * and only in months with 31 days.
         */
        $start = $from
            ? Carbon::parse($from)->startOfMonth()
            : $end->copy()->subMonthsNoOverflow(11)->startOfMonth();

        $joins = $this->countByMonth($organizationId, 'joining_date', $start, $end);
        $exits = $this->countByMonth($organizationId, 'exit_date', $start, $end);

        /*
         * Today's actual headcount — the anchor. Counted the same way every
         * other screen counts it, so the last point of this series and the
         * Headcount tile can never disagree.
         */
        $current = (int) DB::table('users')
            ->where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->count();

        // Walk the months forward for labels, then fill headcount backwards.
        $months = [];
        $cursor = $start->copy();

        while ($cursor->lessThanOrEqualTo($end)) {
            $key = $cursor->format('Y-m');
            $months[] = [
                'month' => $key,
                'joined' => (int) ($joins[$key] ?? 0),
                'left' => (int) ($exits[$key] ?? 0),
                'headcount' => 0,
            ];
            $cursor->addMonthNoOverflow();
        }

        $running = $current;

        for ($i = count($months) - 1; $i >= 0; $i--) {
            $months[$i]['headcount'] = $running;
            // Undo this month to get the month before it.
            $running = $running - $months[$i]['joined'] + $months[$i]['left'];
        }

        return [
            'from' => $start->toDateString(),
            'to' => $end->toDateString(),
            'current_headcount' => $current,
            'months' => $months,
        ];
    }

    /**
     * One grouped count per date column.
     *
     * DATE_TRUNC is Postgres, which is what this app runs on; the tests run on
     * SQLite, so strftime is used there. Both produce 'YYYY-MM'.
     *
     * @return array<string, int>
     */
    private function countByMonth(int $organizationId, string $column, Carbon $start, Carbon $end): array
    {
        $driver = DB::connection()->getDriverName();

        $bucket = $driver === 'sqlite'
            ? "strftime('%Y-%m', w.{$column})"
            : "to_char(date_trunc('month', w.{$column}), 'YYYY-MM')";

        return DB::table('employee_work_infos as w')
            ->join('users as u', 'u.id', '=', 'w.user_id')
            ->where('u.organization_id', $organizationId)
            ->whereIn('u.role', ['employee', 'manager', 'admin'])
            ->whereNotNull("w.{$column}")
            ->whereBetween("w.{$column}", [$start->toDateString(), $end->toDateString()])
            ->selectRaw("{$bucket} as bucket, COUNT(*) as total")
            ->groupBy('bucket')
            ->pluck('total', 'bucket')
            ->map(fn ($n) => (int) $n)
            ->all();
    }
}
