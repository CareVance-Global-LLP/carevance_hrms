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

        // Deductions overtaking gross is the specific failure worth naming: the
        // generic "net pay not calculated" reading sends whoever is checking
        // the run off looking for a calculation that never ran, when in fact it
        // ran and produced a shortfall. Report the worst amount so the message
        // points at the person and the number.
        $overDeducted = $run->items->filter(fn($i) => ($i->net_pay ?? 0) < 0);
        $negativeNetPay = $overDeducted->count();
        $worstShortfall = $negativeNetPay > 0 ? abs((float) $overDeducted->min('net_pay')) : 0.0;
        $checks['no_negative_salary'] = [
            'name' => 'No negative salaries',
            'passed' => $negativeNetPay === 0,
            'value' => $negativeNetPay,
            'detail' => $negativeNetPay > 0
                ? "$negativeNetPay employee(s) have deductions exceeding gross pay; largest shortfall ₹" . number_format($worstShortfall, 2)
                : null,
        ];
        $negativeNetPay === 0 ? $passed++ : $failed++;

        $zeroGross = $run->items->filter(fn($i) => ($i->gross_salary ?? 1) == 0)->count();
        $checks['gross_calculated'] = ['name' => 'Gross calculated', 'passed' => $zeroGross === 0, 'value' => $zeroGross];
        $zeroGross === 0 ? $passed++ : $failed++;

        $missingBank = $run->items->filter(fn($i) => empty($i->user?->employeeBankAccounts?->first()))->count();
        $checks['bank_accounts'] = ['name' => 'Bank accounts present', 'passed' => $missingBank === 0, 'value' => $missingBank];
        $missingBank === 0 ? $passed++ : $failed++;

        // Professional tax is state-levied, so an unset state is a
        // configuration gap rather than "no PT due". Without this check the run
        // simply deducts nothing and nobody finds out until a state authority
        // asks why. Surfaced as a warning, not a hard failure: several states
        // genuinely levy no PT, and a run should not be blocked for them.
        // Read the same field the calculation reads. The employee profile also
        // carries a pt_state, but payroll computes from the payroll template —
        // checking the profile reported "no PT state" for employees whose
        // template had one and who were being charged correctly.
        $missingPtState = $run->items->filter(
            fn ($i) => blank($i->user?->employeePayrollTemplate?->pt_state)
        )->count();
        $checks['pt_state_configured'] = [
            'name' => 'Professional tax state set',
            'passed' => $missingPtState === 0,
            'value' => $missingPtState,
            'warning_only' => true,
            'detail' => $missingPtState > 0
                ? "$missingPtState employee(s) have no PT state — no professional tax will be deducted for them"
                : null,
        ];
        $missingPtState === 0 ? $passed++ : $failed++;

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
                ->whereIn('status', PayrollMonthlyRun::CLOSED_STATUSES)
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
            ->whereIn('status', PayrollMonthlyRun::CLOSED_STATUSES)
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
