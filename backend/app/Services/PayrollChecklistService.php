<?php

namespace App\Services;

use App\Models\EmployeePayrollTemplate;
use App\Models\PayrollChecklistItem;
use App\Models\PayrollRunChecklist;
use App\Models\PayrollMonthlyRun;
use App\Models\PayrollItem;
use App\Models\User;
use Illuminate\Support\Facades\DB;

class PayrollChecklistService
{
    public function runPreValidations(PayrollMonthlyRun $run, int $orgId, int $userId): array
    {
        $results = [];
        $items = $run->items()->with('user.employeeProfile', 'user.employeeBankAccounts', 'user.employeePayrollTemplate')->get();

        $checks = [
            'missing_bank' => ['category' => 'bank_details', 'severity' => 'error', 'label' => 'Missing Bank Accounts'],
            'missing_pan' => ['category' => 'employee_data', 'severity' => 'error', 'label' => 'Missing PAN Cards'],
            'missing_template' => ['category' => 'employee_data', 'severity' => 'error', 'label' => 'Missing Payroll Templates'],
            'missing_attendance' => ['category' => 'attendance', 'severity' => 'warning', 'label' => 'Missing Attendance Data'],
            'missing_declarations' => ['category' => 'declarations', 'severity' => 'warning', 'label' => 'Missing Tax Declarations'],
        ];

        foreach ($checks as $code => $checkDef) {
            $checkItem = PayrollChecklistItem::firstOrCreate(
                ['check_code' => $code, 'organization_id' => $orgId],
                [
                    'category' => $checkDef['category'],
                    'label' => $checkDef['label'],
                    'severity' => $checkDef['severity'],
                    'is_auto_resolvable' => false,
                    'sort_order' => array_search($code, array_keys($checks)) + 1,
                ]
            );

            $affectedUsers = [];

            foreach ($items as $item) {
                $failed = match ($code) {
                    'missing_bank' => $item->user->employeeBankAccounts->isEmpty(),
                    'missing_pan' => empty($item->user->employeeProfile->pan_number),
                    'missing_template' => is_null($item->user->employeePayrollTemplate),
                    'missing_attendance' => $item->total_working_days === 0 || $item->days_present === 0,
                    'missing_declarations' => false,
                    default => false,
                };

                if ($failed) {
                    $affectedUsers[] = $item->user_id;
                    $existing = PayrollRunChecklist::where('payroll_run_id', $run->id)
                        ->where('checklist_item_id', $checkItem->id)
                        ->where('user_id', $item->user_id)
                        ->first();

                    if (!$existing) {
                        PayrollRunChecklist::create([
                            'organization_id' => $orgId,
                            'payroll_run_id' => $run->id,
                            'checklist_item_id' => $checkItem->id,
                            'user_id' => $item->user_id,
                            'status' => 'failed',
                            'message' => "{$checkDef['label']}: {$item->user->name}",
                        ]);
                    } else {
                        $existing->update(['status' => 'failed']);
                    }
                }
            }

            $passCount = $items->count() - count($affectedUsers);
            $failCount = count($affectedUsers);

            $results[$code] = [
                'check' => $checkDef['label'],
                'severity' => $checkDef['severity'],
                'total' => $items->count(),
                'passed' => $passCount,
                'failed' => $failCount,
                'affected_users' => $affectedUsers,
                'status' => $failCount > 0 ? 'failed' : 'passed',
            ];
        }

        $results['missing_ctc'] = $this->checkMissingCtc($run, $orgId);

        return $results;
    }

    /**
     * Employees the run was meant to cover but could not pay.
     *
     * Every other check above walks the run's items. This one cannot: an
     * employee with no annual CTC is excluded during calculation and their
     * item is removed, precisely so a ₹0 line cannot reach a payslip or a bank
     * file. By the time this runs there is nothing left to iterate.
     *
     * So it asks the question the run started from instead — who has an active
     * payroll template? — which is the same population autoSyncEmployees
     * builds the run from. Anyone in that set without a usable CTC is an
     * error: they are on payroll, and payroll could not pay them.
     *
     * @return array<string, mixed>
     */
    private function checkMissingCtc(PayrollMonthlyRun $run, int $orgId): array
    {
        $checkItem = PayrollChecklistItem::firstOrCreate(
            ['check_code' => 'missing_ctc', 'organization_id' => $orgId],
            [
                'category' => 'employee_data',
                'label' => 'Missing Annual CTC',
                'severity' => 'error',
                'is_auto_resolvable' => false,
                'sort_order' => 6,
            ]
        );

        $templates = EmployeePayrollTemplate::with('user')
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->get();

        $affectedUsers = [];

        foreach ($templates as $template) {
            if ((float) ($template->annual_ctc ?? 0) > 0) {
                continue;
            }

            $affectedUsers[] = $template->user_id;

            $name = $template->user->name ?? "User #{$template->user_id}";

            PayrollRunChecklist::updateOrCreate(
                [
                    'payroll_run_id' => $run->id,
                    'checklist_item_id' => $checkItem->id,
                    'user_id' => $template->user_id,
                ],
                [
                    'organization_id' => $orgId,
                    'status' => 'failed',
                    'message' => "Missing Annual CTC: {$name}",
                ]
            );
        }

        return [
            'check' => 'Missing Annual CTC',
            'severity' => 'error',
            'total' => $templates->count(),
            'passed' => $templates->count() - count($affectedUsers),
            'failed' => count($affectedUsers),
            'affected_users' => $affectedUsers,
            'status' => count($affectedUsers) > 0 ? 'failed' : 'passed',
        ];
    }

    public function getRunChecklistStatus(int $payrollRunId): array
    {
        $checks = PayrollRunChecklist::with(['checklistItem', 'user'])
            ->where('payroll_run_id', $payrollRunId)
            ->get();

        $grouped = [];
        foreach ($checks as $check) {
            $category = $check->checklistItem->category ?? 'general';
            if (!isset($grouped[$category])) {
                $grouped[$category] = ['items' => [], 'count' => 0, 'failed' => 0];
            }
            $grouped[$category]['items'][] = $check->toArray();
            $grouped[$category]['count']++;
            if ($check->status === 'failed') {
                $grouped[$category]['failed']++;
            }
        }

        return $grouped;
    }

    public function resolveCheck(int $checkId, string $resolution, int $resolvedBy): PayrollRunChecklist
    {
        $check = PayrollRunChecklist::findOrFail($checkId);
        $check->update([
            'status' => 'passed',
            'resolution' => $resolution,
            'is_resolved' => true,
            'resolved_by' => $resolvedBy,
            'resolved_at' => now(),
        ]);
        return $check;
    }

    public function runFullValidation(int $payrollRunId, int $orgId, int $userId): array
    {
        $run = PayrollMonthlyRun::findOrFail($payrollRunId);
        $validationService = app(PayrollValidationService::class);
        $validations = $validationService->validatePayrollRun($payrollRunId);
        $checklistResults = $this->runPreValidations($run, $orgId, $userId);

        $hasErrors = collect($checklistResults)->contains(fn($r) => $r['status'] === 'failed' && $r['severity'] === 'error');

        return [
            'can_process' => !$hasErrors,
            'checklist' => $checklistResults,
            'validations' => $validations,
            'summary' => [
                'total_checks' => count($checklistResults),
                'failed_checks' => collect($checklistResults)->where('status', 'failed')->count(),
                'has_errors' => $hasErrors,
            ],
        ];
    }
}
