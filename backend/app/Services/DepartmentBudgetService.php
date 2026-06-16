<?php

namespace App\Services;

use App\Models\Department;
use App\Models\Payroll;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Department Budget vs Actual Service
 *
 * Tracks each department's salary budget (set quarterly or annually)
 * against actual spend, variance %, and forecast end-of-period spend.
 */
class DepartmentBudgetService
{
    public function setBudget(int $organizationId, int $departmentId, float $budget, string $period): array
    {
        $row = DB::table('department_budgets')->updateOrInsert(
            ['organization_id' => $organizationId, 'department_id' => $departmentId, 'period' => $period],
            ['budget' => $budget, 'updated_at' => now(), 'created_at' => now()]
        );
        return ['status' => 'ok', 'budget' => $budget, 'period' => $period];
    }

    public function actualsVsBudget(int $organizationId, int $departmentId, string $period): array
    {
        [$year, $month] = explode('-', $period);
        $start = Carbon::createFromDate($year, $month, 1)->startOfMonth();
        $end = $start->copy()->endOfMonth();
        $budget = (float) (DB::table('department_budgets')
            ->where('organization_id', $organizationId)
            ->where('department_id', $departmentId)
            ->where('period', $period)
            ->value('budget') ?? 0);
        $actual = (float) Payroll::where('organization_id', $organizationId)
            ->whereIn('user_id', function ($q) use ($departmentId) {
                $q->select('id')->from('users')->where('department_id', $departmentId);
            })
            ->whereBetween('payroll_period', [$start, $end])
            ->sum('net_pay');
        $daysElapsed = Carbon::now()->day;
        $daysInMonth = $end->day;
        $projected = $daysElapsed > 0 ? $actual / $daysElapsed * $daysInMonth : 0;
        $variance = $budget > 0 ? (($projected - $budget) / $budget) * 100 : 0;
        $status = $projected > $budget ? 'over' : ($projected > $budget * 0.9 ? 'at_risk' : 'under');
        return [
            'department_id' => $departmentId,
            'period' => $period,
            'budget' => $budget,
            'actual' => round($actual, 2),
            'projected' => round($projected, 2),
            'variance_pct' => round($variance, 1),
            'status' => $status,
            'remaining' => round(max(0, $budget - $actual), 2),
        ];
    }

    public function allDepartments(int $organizationId, string $period): array
    {
        $departments = Department::where('organization_id', $organizationId)->get();
        $report = [];
        foreach ($departments as $d) {
            $report[] = $this->actualsVsBudget($organizationId, $d->id, $period);
        }
        return $report;
    }
}
