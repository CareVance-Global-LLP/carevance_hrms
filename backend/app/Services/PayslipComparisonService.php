<?php

namespace App\Services;

use App\Models\Payroll;
use App\Models\Employee;
use Carbon\Carbon;

/**
 * Payslip MoM Comparison Service
 *
 * Generates month-on-month and year-on-year comparison of payslips
 * for an employee, highlighting changes in earnings, deductions, and net pay.
 */
class PayslipComparisonService
{
    public function compare(int $userId, int $organizationId, string $fromPeriod, string $toPeriod): array
    {
        $from = Payroll::where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->where('payroll_period', $fromPeriod)->first();
        $to = Payroll::where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->where('payroll_period', $toPeriod)->first();
        if (!$from && !$to) {
            return ['error' => 'No payrolls found for the given periods'];
        }
        $from ??= $this->zeroPayslip();
        $to ??= $this->zeroPayslip();
        $components = ['basic', 'hra', 'conveyance', 'special_allowance', 'pf', 'esi', 'pt', 'tds', 'gross_earnings', 'net_pay', 'total_deductions'];
        $deltas = [];
        foreach ($components as $c) {
            $fromVal = (float) ($from->{$c} ?? 0);
            $toVal = (float) ($to->{$c} ?? 0);
            $deltas[$c] = [
                'from' => $fromVal,
                'to' => $toVal,
                'change' => $toVal - $fromVal,
                'pct_change' => $fromVal > 0 ? round((($toVal - $fromVal) / $fromVal) * 100, 2) : 0,
            ];
        }
        return [
            'from_period' => $fromPeriod,
            'to_period' => $toPeriod,
            'employee_id' => $userId,
            'deltas' => $deltas,
            'highlights' => $this->highlights($deltas),
        ];
    }

    public function yearOnYear(int $userId, int $organizationId, int $month): array
    {
        $currentYear = Carbon::now()->year;
        return $this->compare(
            $userId, $organizationId,
            sprintf('%04d-%02d-01', $currentYear - 1, $month),
            sprintf('%04d-%02d-01', $currentYear, $month)
        );
    }

    public function trend(int $userId, int $organizationId, int $months = 12): array
    {
        $rows = Payroll::where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->orderByDesc('payroll_period')->limit($months)->get();
        return $rows->map(fn($p) => [
            'period' => $p->payroll_period,
            'gross' => (float) $p->gross_earnings,
            'net' => (float) $p->net_pay,
            'deductions' => (float) $p->total_deductions,
        ])->reverse()->values()->toArray();
    }

    protected function zeroPayslip(): object
    {
        return (object) array_fill_keys(['basic', 'hra', 'conveyance', 'special_allowance', 'pf', 'esi', 'pt', 'tds', 'gross_earnings', 'net_pay', 'total_deductions'], 0);
    }

    protected function highlights(array $deltas): array
    {
        $h = [];
        if (abs($deltas['gross_earnings']['change']) > 0) {
            $h[] = $deltas['gross_earnings']['change'] > 0
                ? "Gross salary up by ₹" . number_format($deltas['gross_earnings']['change'])
                : "Gross salary down by ₹" . number_format(abs($deltas['gross_earnings']['change']));
        }
        if (abs($deltas['tds']['change']) > 0) {
            $h[] = $deltas['tds']['change'] > 0
                ? "TDS up by ₹" . number_format($deltas['tds']['change']) . " (taxes increased)"
                : "TDS down by ₹" . number_format(abs($deltas['tds']['change'])) . " (taxes reduced)";
        }
        if (abs($deltas['net_pay']['change']) > 0) {
            $h[] = $deltas['net_pay']['change'] > 0
                ? "Net pay up by ₹" . number_format($deltas['net_pay']['change'])
                : "Net pay down by ₹" . number_format(abs($deltas['net_pay']['change']));
        }
        return $h;
    }
}
