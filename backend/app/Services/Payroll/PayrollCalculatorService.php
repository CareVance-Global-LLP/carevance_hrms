<?php

namespace App\Services\Payroll;

class PayrollCalculatorService
{
    public function calculateNetSalary(
        float $basicSalary,
        float $allowances,
        float $bonus,
        float $deductions,
        float $tax
    ): float {
        return round($basicSalary + $allowances + $bonus - $deductions - $tax, 2);
    }

    /**
     * @param array<string, mixed> $profile
     * @param array<string, mixed> $inputs
     * @return array<string, mixed>
     */
    public function calculateSimplePayroll(array $profile, array $inputs): array
    {
        $salaryType = (string) ($profile['salary_type'] ?? 'fixed_monthly');
        $monthlySalary = round((float) ($profile['monthly_salary'] ?? 0), 2);
        $hourlyRate = round((float) ($profile['hourly_rate'] ?? 0), 2);
        $workingDays = max(1.0, (float) ($profile['working_days'] ?? 30));
        $approvedWorkedHours = max(0.0, (float) ($inputs['approved_worked_hours'] ?? 0));
        $unpaidLeaveDays = max(0.0, (float) ($inputs['unpaid_leave_days'] ?? 0));
        $overtimeHours = max(0.0, (float) ($inputs['overtime_hours'] ?? 0));
        $approvedProductiveHours = max(0.0, (float) ($inputs['approved_productive_hours'] ?? 0));

        $perDaySalary = round($monthlySalary / $workingDays, 2);
        $lopDeduction = in_array($salaryType, ['fixed_monthly', 'hybrid'], true)
            ? round($perDaySalary * $unpaidLeaveDays, 2)
            : 0.0;

        $basePay = match ($salaryType) {
            'hourly' => round($approvedWorkedHours * $hourlyRate, 2),
            'hybrid', 'fixed_monthly' => round($monthlySalary - $lopDeduction, 2),
            default => 0.0,
        };

        $overtimeRate = round((float) ($profile['overtime_hourly_rate'] ?? $hourlyRate), 2);
        $overtime = (bool) ($profile['overtime_enabled'] ?? true)
            ? round($overtimeHours * $overtimeRate, 2)
            : 0.0;

        $bonus = round((float) ($inputs['bonus'] ?? 0), 2);
        $reimbursement = round((float) ($inputs['reimbursement'] ?? 0), 2);
        $manualDeduction = round((float) ($inputs['manual_deduction'] ?? 0), 2);
        $otherDeduction = round((float) ($inputs['other_deduction'] ?? 0), 2);
        $productivityBonus = (bool) ($profile['productivity_bonus_enabled'] ?? false)
            ? round($approvedProductiveHours * (float) ($profile['productivity_bonus_rate'] ?? 0), 2)
            : 0.0;

        $grossBase = in_array($salaryType, ['fixed_monthly', 'hybrid'], true) ? $monthlySalary : $basePay;
        $grossPay = round($grossBase + $overtime + $bonus + $reimbursement + $productivityBonus, 2);
        $deductions = round($lopDeduction + $manualDeduction + $otherDeduction, 2);
        $netPay = round($grossPay - $deductions, 2);

        $warnings = [];
        if ($salaryType === 'hourly' && $approvedWorkedHours <= 0) {
            $warnings[] = 'Hourly employee has no approved hours';
        }
        if ($salaryType === 'fixed_monthly' && $monthlySalary <= 0) {
            $warnings[] = 'Monthly salary missing';
        }
        if ($salaryType === 'hybrid' && $monthlySalary <= 0 && $hourlyRate <= 0) {
            $warnings[] = 'Hybrid salary setup missing';
        }
        if ($netPay < 0) {
            $warnings[] = 'Negative calculated pay';
        }

        return [
            'salary_type' => $salaryType,
            'working_days' => $workingDays,
            'monthly_salary' => $monthlySalary,
            'hourly_rate' => $hourlyRate,
            'per_day_salary' => $perDaySalary,
            'lop_deduction' => $lopDeduction,
            'base_pay' => $basePay,
            'overtime' => $overtime,
            'bonus' => $bonus,
            'reimbursement' => $reimbursement,
            'productivity_bonus' => $productivityBonus,
            'manual_deduction' => $manualDeduction,
            'other_deduction' => $otherDeduction,
            'gross_pay' => $grossPay,
            'deductions' => $deductions,
            'net_pay' => $netPay,
            'warnings' => $warnings,
            'status' => count($warnings) > 0 ? 'exception' : 'ready',
        ];
    }
}
