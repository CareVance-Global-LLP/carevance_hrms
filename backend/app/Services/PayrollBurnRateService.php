<?php

namespace App\Services;

use App\Models\PayrollMonthlyRun;
use App\Models\PayrollItem;
use Illuminate\Support\Facades\DB;
use Carbon\Carbon;

/**
 * Real-time Payroll Burn-Rate Service
 *
 * Calculates current-period payroll spend, run-rate, and forecast end-of-month
 * payroll cost. Used by the dashboard's "Payroll Burn" widget so that finance
 * teams can monitor cash flow in real time.
 *
 * Outputs:
 *  - actual_spend (₹ paid so far this month)
 *  - projected_spend (₹ expected by month-end)
 *  - budget_remaining (₹ left for the month)
 *  - daily_burn (₹ per day average)
 *  - 12-month rolling graph data
 */
class PayrollBurnRateService
{
    public function currentMonth(int $organizationId): array
    {
        $now = Carbon::now();
        $monthStart = $now->copy()->startOfMonth();
        $monthEnd = $now->copy()->endOfMonth();
        $daysElapsed = $now->day;
        $daysInMonth = $monthEnd->day;
        $daysRemaining = $daysInMonth - $daysElapsed;

        $currentMonthYear = $monthStart->format('Y-m');
        $prevMonthYear = $monthStart->copy()->subMonth()->format('Y-m');

        $currentRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $currentMonthYear)
            ->first();
        $prevRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $prevMonthYear)
            ->first();

        $monthlyTotal = $currentRun ? (float) $currentRun->total_net_pay : 0;
        $lastMonthTotal = $prevRun ? (float) $prevRun->total_net_pay : 0;

        $dailyBurn = $daysElapsed > 0 ? $monthlyTotal / $daysElapsed : 0;
        $projected = $dailyBurn * $daysInMonth;
        $budget = $lastMonthTotal > 0 ? $lastMonthTotal * 1.05 : $projected;
        $remaining = max(0, $budget - $monthlyTotal);

        return [
            'month' => $currentMonthYear,
            'month_label' => $monthStart->format('F Y'),
            'actual_spend' => round($monthlyTotal, 2),
            'projected_spend' => round($projected, 2),
            'budget' => round($budget, 2),
            'budget_remaining' => round($remaining, 2),
            'daily_burn' => round($dailyBurn, 2),
            'days_elapsed' => $daysElapsed,
            'days_remaining' => $daysRemaining,
            'monthly_delta' => $lastMonthTotal > 0
                ? round((($monthlyTotal - $lastMonthTotal) / $lastMonthTotal) * 100, 1)
                : 0,
            'variance_pct' => $budget > 0
                ? round((($projected - $budget) / $budget) * 100, 1)
                : 0,
        ];
    }

    public function rollingTwelveMonths(int $organizationId): array
    {
        $start = Carbon::now()->subMonths(11)->startOfMonth();
        $startMonthYear = $start->format('Y-m');
        $rows = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', '>=', $startMonthYear)
            ->selectRaw('month_year as month, total_net_pay as total, total_employees as employees')
            ->orderBy('month_year')
            ->get();
        return $rows->map(fn($r) => [
            'month' => $r->month,
            'total' => round((float) $r->total, 2),
            'employees' => $r->employees,
        ])->toArray();
    }

    public function departmentBreakdown(int $organizationId): array
    {
        $currentMonthYear = Carbon::now()->format('Y-m');
        return DB::table('payroll_items')
            ->join('users', 'payroll_items.user_id', '=', 'users.id')
            ->join('payroll_monthly_runs', 'payroll_items.payroll_run_id', '=', 'payroll_monthly_runs.id')
            ->where('payroll_items.organization_id', $organizationId)
            ->where('payroll_monthly_runs.month_year', $currentMonthYear)
            ->selectRaw('users.department, SUM(payroll_items.net_pay) as total, COUNT(DISTINCT payroll_items.user_id) as headcount')
            ->groupBy('users.department')
            ->orderByDesc('total')
            ->get()
            ->map(fn($r) => [
                'department' => $r->department ?? 'Unassigned',
                'total' => round((float) $r->total, 2),
                'headcount' => $r->headcount,
                'avg_per_employee' => $r->headcount > 0 ? round($r->total / $r->headcount, 2) : 0,
            ])->toArray();
    }
}
