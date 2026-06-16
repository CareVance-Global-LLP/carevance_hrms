<?php

namespace App\Services;

use App\Models\PayrollRun;
use App\Models\Payroll;
use App\Models\Department;
use App\Models\Employee;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

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

        $monthlyTotal = Payroll::where('organization_id', $organizationId)
            ->whereBetween('payroll_period', [$monthStart, $now])
            ->sum('net_pay');
        $lastMonthTotal = Payroll::where('organization_id', $organizationId)
            ->whereBetween('payroll_period', [$monthStart->copy()->subMonth(), $monthStart])
            ->sum('net_pay');

        $dailyBurn = $daysElapsed > 0 ? $monthlyTotal / $daysElapsed : 0;
        $projected = $dailyBurn * $daysInMonth;
        $budget = $lastMonthTotal > 0 ? $lastMonthTotal * 1.05 : $projected; // 5% buffer
        $remaining = max(0, $budget - $monthlyTotal);

        return [
            'month' => $monthStart->format('Y-m'),
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
        $rows = Payroll::where('organization_id', $organizationId)
            ->where('payroll_period', '>=', $start)
            ->selectRaw('DATE_FORMAT(payroll_period, "%Y-%m") as month, SUM(net_pay) as total, COUNT(*) as employees')
            ->groupBy('month')->orderBy('month')->get();
        return $rows->map(fn($r) => [
            'month' => $r->month,
            'total' => round((float) $r->total, 2),
            'employees' => $r->employees,
        ])->toArray();
    }

    public function departmentBreakdown(int $organizationId): array
    {
        return DB::table('payrolls')
            ->join('users', 'payrolls.user_id', '=', 'users.id')
            ->where('payrolls.organization_id', $organizationId)
            ->whereBetween('payrolls.payroll_period', [Carbon::now()->startOfMonth(), Carbon::now()])
            ->selectRaw('users.department, SUM(payrolls.net_pay) as total, COUNT(DISTINCT payrolls.user_id) as headcount')
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
