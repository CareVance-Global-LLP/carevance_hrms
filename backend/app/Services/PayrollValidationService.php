<?php

namespace App\Services;

use App\Models\PayrollMonthlyRun;
use App\Models\PayrollItem;
use App\Models\EmployeePayrollTemplate;
use App\Models\EmployeeProfile;

class PayrollValidationService
{
    public function validatePayrollRun(int $runId): array
    {
        $run = PayrollMonthlyRun::with('items')->find($runId);
        if (!$run) return ['valid' => false, 'message' => 'Payroll run not found'];

        $checks = [];
        $passed = 0;
        $failed = 0;

        $itemCount = $run->items->count();
        $checks['items_present'] = ['name' => 'Employees in run', 'passed' => $itemCount > 0, 'value' => $itemCount];
        $itemCount > 0 ? $passed++ : $failed++;

        $itemsWithNetPay = $run->items->filter(fn($i) => ($i->net_pay ?? 0) > 0)->count();
        $checks['net_pay_calculated'] = ['name' => 'Net pay calculated', 'passed' => $itemsWithNetPay === $itemCount, 'value' => "$itemsWithNetPay/$itemCount"];
        $itemsWithNetPay === $itemCount ? $passed++ : $failed++;

        $emptyDeductions = $run->items->filter(fn($i) => ($i->total_deductions ?? -1) < 0)->count();
        $checks['deductions_valid'] = ['name' => 'Deductions valid', 'passed' => $emptyDeductions === 0, 'value' => $emptyDeductions];
        $emptyDeductions === 0 ? $passed++ : $failed++;

        $negativeNetPay = $run->items->filter(fn($i) => ($i->net_pay ?? -1) < 0)->count();
        $checks['no_negative_salary'] = ['name' => 'No negative salaries', 'passed' => $negativeNetPay === 0, 'value' => $negativeNetPay];
        $negativeNetPay === 0 ? $passed++ : $failed++;

        $zeroGross = $run->items->filter(fn($i) => ($i->gross_salary ?? 1) == 0)->count();
        $checks['gross_calculated'] = ['name' => 'Gross calculated', 'passed' => $zeroGross === 0, 'value' => $zeroGross];
        $zeroGross === 0 ? $passed++ : $failed++;

        $missingBank = $run->items->filter(fn($i) => empty($i->user?->employeeBankAccounts?->first()))->count();
        $checks['bank_accounts'] = ['name' => 'Bank accounts present', 'passed' => $missingBank === 0, 'value' => $missingBank];
        $missingBank === 0 ? $passed++ : $failed++;

        $totalChecks = count($checks);
        $valid = $failed === 0;

        return [
            'valid' => $valid,
            'total_checks' => $totalChecks,
            'passed' => $passed,
            'failed' => $failed,
            'checks' => $checks,
            'message' => $valid ? 'All validations passed' : "$failed check(s) failed",
        ];
    }

    public function getRunDifference(int $currentRunId, ?int $previousRunId = null): array
    {
        $current = PayrollMonthlyRun::with('items')->find($currentRunId);
        if (!$current) return [];

        $previous = $previousRunId
            ? PayrollMonthlyRun::with('items')->find($previousRunId)
            : PayrollMonthlyRun::where('organization_id', $current->organization_id)
                ->where('id', '<', $currentRunId)
                ->whereIn('status', ['locked', 'approved', 'released', 'paid'])
                ->orderBy('id', 'desc')
                ->first();

        if (!$previous) return ['has_previous' => false];

        return [
            'has_previous' => true,
            'previous_month' => $previous->month_year,
            'previous_run_id' => $previous->id,
            'diff' => [
                'total_gross' => round(($current->total_gross ?? 0) - ($previous->total_gross ?? 0), 2),
                'total_deductions' => round(($current->total_deductions ?? 0) - ($previous->total_deductions ?? 0), 2),
                'total_net_pay' => round(($current->total_net_pay ?? 0) - ($previous->total_net_pay ?? 0), 2),
                'total_employees' => ($current->total_employees ?? 0) - ($previous->total_employees ?? 0),
                'total_pf' => round(($current->total_pf_employee ?? 0) - ($previous->total_pf_employee ?? 0), 2),
                'total_esi' => round(($current->total_esi_employee ?? 0) - ($previous->total_esi_employee ?? 0), 2),
                'total_tds' => round(($current->total_tds ?? 0) - ($previous->total_tds ?? 0), 2),
                'total_employer_contributions' => round(($current->total_employer_contributions ?? 0) - ($previous->total_employer_contributions ?? 0), 2),
                'total_pt' => round(($current->total_pt ?? 0) - ($previous->total_pt ?? 0), 2),
            ],
        ];
    }

    public function preRunChecks(int $orgId, string $monthYear): array
    {
        $checks = [];
        $passed = 0;
        $failed = 0;

        $activeTemplates = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('is_active', true)
            ->count();
        $checks['active_templates'] = ['name' => 'Active salary templates', 'passed' => $activeTemplates > 0, 'value' => $activeTemplates];
        $activeTemplates > 0 ? $passed++ : $failed++;

        $templatesWithoutBank = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('is_active', true)
            ->whereDoesntHave('user.employeeBankAccounts')
            ->count();
        $checks['bank_accounts'] = ['name' => 'Employees with bank accounts', 'passed' => $templatesWithoutBank === 0, 'value' => $templatesWithoutBank];
        $templatesWithoutBank === 0 ? $passed++ : $failed++;

        // Real duplicate-PAN detection. This was hardcoded to 0 and always
        // reported green — while a duplicate PAN is exactly the condition that
        // gets a Form 24Q filing rejected, so the check that existed to catch
        // it could never fire.
        $duplicatePan = EmployeeProfile::query()
            ->where('organization_id', $orgId)
            ->whereNotNull('pan_number')
            ->where('pan_number', '!=', '')
            ->whereHas('user.employeePayrollTemplate', fn ($q) => $q->where('is_active', true))
            ->groupBy('pan_number')
            ->havingRaw('COUNT(*) > 1')
            ->pluck('pan_number')
            ->count();
        $checks['duplicate_pan'] = ['name' => 'Duplicate PAN checks', 'passed' => $duplicatePan === 0, 'value' => $duplicatePan];
        $duplicatePan === 0 ? $passed++ : $failed++;

        $existingRun = PayrollMonthlyRun::where('organization_id', $orgId)
            ->where('month_year', $monthYear)
            ->whereIn('status', ['locked', 'approved', 'released', 'paid'])
            ->exists();
        $checks['existing_run'] = ['name' => 'No existing locked run', 'passed' => !$existingRun, 'value' => $existingRun ? 'Exists' : 'Clear'];
        !$existingRun ? $passed++ : $failed++;

        return [
            'can_process' => $failed === 0,
            'total_checks' => count($checks),
            'passed' => $passed,
            'failed' => $failed,
            'checks' => $checks,
        ];
    }
}
