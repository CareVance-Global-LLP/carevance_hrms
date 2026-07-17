<?php

namespace App\Services;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollMonthlyRun;

/**
 * Pre-flight validation for statutory filings.
 *
 * Mirrors the PayrollChecklistService pattern: each filing type exposes a
 * readiness check that returns a list of blocking errors and non-blocking
 * warnings. The UI shows a green/red "Ready to file" checklist before
 * generation, and generation can be blocked when errors are present.
 */
class PayrollFilingValidatorService
{
    public const PF_WAGE_CAP = 15000;

    public const ESI_THRESHOLD = 21000;

    /**
     * @return array{ready:bool, errors:array<int,array{code:string,message:string,type:string}>, warnings:array<int,array{code:string,message:string,type:string}>}
     */
    public function validate(PayrollMonthlyRun $run, string $type, array $context = []): array
    {
        return match ($type) {
            'pf_ecr' => $this->validatePfEcr($run),
            'esi_challan' => $this->validateEsi($run),
            'form_24q' => $this->validateTds($run),
            'form_16' => $this->validateForm16($context),
            'form_12ba' => $this->validateForm12BA($run),
            'pt_return' => $this->validatePt($run, $context['state'] ?? null),
            'lwf_return' => $this->validateLwf($run, $context['state'] ?? null),
            'bonus_form_c' => $this->validateBonus($context),
            default => ['ready' => false, 'errors' => [['code' => 'unknown_type', 'message' => "Unknown filing type: {$type}", 'type' => $type]], 'warnings' => []],
        };
    }

    /**
     * Validate that the run itself is in a fileable state. A filing must be
     * generated from an approved/locked run — never a draft.
     */
    public function validateRunState(PayrollMonthlyRun $run): array
    {
        $errors = [];
        if (! in_array($run->status, ['locked', 'approved', 'released', 'disbursed'])) {
            $errors[] = [
                'code' => 'run_not_approved',
                'message' => 'Payroll run is not approved/locked. Process, lock and approve the run before generating statutory filings.',
                'type' => 'run',
            ];
        }

        return $errors;
    }

    private function validatePfEcr(PayrollMonthlyRun $run): array
    {
        $errors = [];
        $warnings = [];

        $org = Organization::find($run->organization_id);
        if (empty($org->settings['statutory']['establishmentCode'] ?? '')) {
            $errors[] = ['code' => 'missing_est_code', 'message' => 'Employer PF establishment code is not configured (Payroll Settings → Statutory).', 'type' => 'pf_ecr'];
        }

        $items = $run->items()->with('user.employeeProfile')->get();
        if ($items->isEmpty()) {
            $errors[] = ['code' => 'no_items', 'message' => 'No payroll items found for this run.', 'type' => 'pf_ecr'];

            return ['ready' => false, 'errors' => $errors, 'warnings' => $warnings];
        }

        $missingUan = 0;
        $overCap = 0;
        foreach ($items as $item) {
            if (empty($item->user->employeeProfile?->uan_number)) {
                $missingUan++;
            }
            if ((float) $item->basic > self::PF_WAGE_CAP) {
                $overCap++;
            }
        }
        if ($missingUan > 0) {
            $errors[] = ['code' => 'missing_uan', 'message' => "{$missingUan} employee(s) are missing a UAN number — PF ECR upload will reject them.", 'type' => 'pf_ecr'];
        }
        if ($overCap > 0) {
            $warnings[] = ['code' => 'pf_over_cap', 'message' => "{$overCap} employee(s) have basic > ₹15,000; PF wages will be capped at the ceiling.", 'type' => 'pf_ecr'];
        }

        return ['ready' => $errors === [], 'errors' => $errors, 'warnings' => $warnings];
    }

    private function validateEsi(PayrollMonthlyRun $run): array
    {
        $errors = [];
        $warnings = [];

        $org = Organization::find($run->organization_id);
        if (empty($org->settings['esi_code'] ?? '')) {
            $errors[] = ['code' => 'missing_esi_code', 'message' => 'Employer ESIC code is not configured (Payroll Settings → Statutory).', 'type' => 'esi_challan'];
        }

        $items = $run->items()->with('user.employeeProfile')->where('esi_employee', '>', 0)->get();
        if ($items->isEmpty()) {
            $warnings[] = ['code' => 'no_esi_items', 'message' => 'No ESIC-eligible employees (gross ≤ ₹21,000) found for this run — nothing to file.', 'type' => 'esi_challan'];
        }

        $missingIp = 0;
        foreach ($items as $item) {
            if (empty($item->user->employeeProfile?->esi_ip_number)) {
                $missingIp++;
            }
        }
        if ($missingIp > 0) {
            $errors[] = ['code' => 'missing_ip', 'message' => "{$missingIp} ESIC-covered employee(s) are missing an IP number — the ESIC portal will reject them.", 'type' => 'esi_challan'];
        }

        return ['ready' => $errors === [], 'errors' => $errors, 'warnings' => $warnings];
    }

    private function validateTds(PayrollMonthlyRun $run): array
    {
        $errors = [];
        $warnings = [];

        $org = Organization::find($run->organization_id);
        if (empty($org->settings['tan_number'] ?? '')) {
            $errors[] = ['code' => 'missing_tan', 'message' => 'Employer TAN is not configured (Payroll Settings → Statutory).', 'type' => 'form_24q'];
        }

        $items = $run->items()->with('user.employeeProfile')->get();
        $missingPan = 0;
        $totalTds = 0;
        foreach ($items as $item) {
            if (empty($item->user->employeeProfile?->pan_number)) {
                $missingPan++;
            }
            $totalTds += (float) $item->tds;
        }
        if ($missingPan > 0) {
            $errors[] = ['code' => 'missing_pan', 'message' => "{$missingPan} employee(s) are missing a PAN — Form 24Q requires PAN for every deductee.", 'type' => 'form_24q'];
        }
        if ($totalTds <= 0) {
            $warnings[] = ['code' => 'no_tds', 'message' => 'No TDS deducted for this period — Form 24Q may still be required as a NIL return.', 'type' => 'form_24q'];
        }

        return ['ready' => $errors === [], 'errors' => $errors, 'warnings' => $warnings];
    }

    private function validateForm16(array $context): array
    {
        $errors = [];
        $warnings = [];

        if (empty($context['financial_year'] ?? '')) {
            $errors[] = ['code' => 'missing_fy', 'message' => 'Financial year is required to generate Form 16.', 'type' => 'form_16'];
        }
        if (empty($context['user_id'] ?? null)) {
            $errors[] = ['code' => 'missing_user', 'message' => 'An employee must be selected to generate Form 16.', 'type' => 'form_16'];
        }

        return ['ready' => $errors === [], 'errors' => $errors, 'warnings' => $warnings];
    }

    private function validateForm12BA(PayrollMonthlyRun $run): array
    {
        $errors = [];
        $warnings = [];

        $org = Organization::find($run->organization_id);
        if (empty($org->settings['pan_number'] ?? '')) {
            $errors[] = ['code' => 'missing_pan', 'message' => 'Employer PAN is not configured (Payroll Settings → Statutory).', 'type' => 'form_12ba'];
        }

        return ['ready' => $errors === [], 'errors' => $errors, 'warnings' => $warnings];
    }

    private function validatePt(PayrollMonthlyRun $run, ?string $state): array
    {
        $errors = [];
        $warnings = [];

        if (empty($state)) {
            $errors[] = ['code' => 'missing_state', 'message' => 'A state must be selected for the PT return.', 'type' => 'pt_return'];

            return ['ready' => false, 'errors' => $errors, 'warnings' => $warnings];
        }

        $org = Organization::find($run->organization_id);
        if (empty($org->settings['pt_reg_number'] ?? '')) {
            $warnings[] = ['code' => 'missing_pt_reg', 'message' => 'PT registration number is not configured (Payroll Settings → Statutory) — add it before filing.', 'type' => 'pt_return'];
        }

        $count = EmployeePayrollTemplate::where('organization_id', $run->organization_id)
            ->where('pt_state', $state)
            ->count();
        if ($count === 0) {
            $errors[] = ['code' => 'no_pt_employees', 'message' => "No employees are mapped to PT state '{$state}'.", 'type' => 'pt_return'];
        }

        return ['ready' => $errors === [], 'errors' => $errors, 'warnings' => $warnings];
    }

    private function validateLwf(PayrollMonthlyRun $run, ?string $state): array
    {
        $errors = [];
        $warnings = [];

        if (empty($state)) {
            $errors[] = ['code' => 'missing_state', 'message' => 'A state must be selected for the LWF return.', 'type' => 'lwf_return'];

            return ['ready' => false, 'errors' => $errors, 'warnings' => $warnings];
        }

        if (! isset(PayrollFilingService::LWF_STATE_CONFIG[$state])) {
            $errors[] = ['code' => 'state_unsupported', 'message' => "LWF is not configured for state '{$state}'. This state has no LWF Act or its rates are not yet configured.", 'type' => 'lwf_return'];

            return ['ready' => false, 'errors' => $errors, 'warnings' => $warnings];
        }

        $count = EmployeePayrollTemplate::where('organization_id', $run->organization_id)
            ->where('lwf_enabled', true)
            ->count();
        if ($count === 0) {
            $warnings[] = ['code' => 'no_lwf_employees', 'message' => 'No employees have LWF enabled — nothing to file for this state.', 'type' => 'lwf_return'];
        }

        return ['ready' => $errors === [], 'errors' => $errors, 'warnings' => $warnings];
    }

    private function validateBonus(array $context): array
    {
        $errors = [];
        $warnings = [];

        $percent = $context['bonus_percent'] ?? null;
        if ($percent === null) {
            $errors[] = ['code' => 'missing_bonus_percent', 'message' => 'Bonus percentage (8.33%–20%) is required.', 'type' => 'bonus_form_c'];
        } elseif ($percent < 8.33 || $percent > 20) {
            $errors[] = ['code' => 'invalid_bonus_percent', 'message' => 'Bonus percentage must be between 8.33% and 20% per the Payment of Bonus Act.', 'type' => 'bonus_form_c'];
        }

        return ['ready' => $errors === [], 'errors' => $errors, 'warnings' => $warnings];
    }
}
