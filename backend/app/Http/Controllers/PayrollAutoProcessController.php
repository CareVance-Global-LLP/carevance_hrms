<?php

namespace App\Http\Controllers;

use App\Models\PayrollMonthlyRun;
use App\Services\PayrollAutoProcessService;
use App\Services\PayrollValidationService;
use App\Services\PayrollChecklistService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

class PayrollAutoProcessController extends Controller
{
    protected PayrollAutoProcessService $autoProcess;
    protected PayrollValidationService $validation;
    protected PayrollChecklistService $checklist;

    public function __construct(
        PayrollAutoProcessService $autoProcess,
        PayrollValidationService $validation,
        PayrollChecklistService $checklist,
    ) {
        $this->autoProcess = $autoProcess;
        $this->validation = $validation;
        $this->checklist = $checklist;
    }

    public function quickProcess(Request $request): JsonResponse
    {
        $request->validate([
            'month_year' => 'required|date_format:Y-m',
        ]);

        try {
            $orgId = Auth::user()->organization_id;
            $result = $this->autoProcess->quickProcess($orgId, $request->month_year, Auth::id());

            return response()->json([
                'success' => true,
                'run' => $result,
                'message' => 'Payroll processed successfully',
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    public function processWithChecklist(Request $request): JsonResponse
    {
        $request->validate([
            'month_year' => 'required|date_format:Y-m',
        ]);

        $orgId = Auth::user()->organization_id;
        $result = $this->autoProcess->processWithChecklist($orgId, $request->month_year, Auth::id());

        if (isset($result['blocked']) && $result['blocked']) {
            return response()->json([
                'success' => false,
                'message' => $result['message'],
                'checks' => $result['validation'],
            ], 422);
        }

        return response()->json([
            'success' => true,
            'run' => $result,
            'message' => 'Payroll processed successfully',
        ]);
    }

    /**
     * Scoped payroll run. The single endpoint that backs every Run-Payroll
     * flow (single employee / one or more departments / whole org) by
     * delegating to PayrollAutoProcessService::processForUsers.
     *
     * Request body:
     *   month_year: 'YYYY-MM'                  (required)
     *   scope:      'single' | 'department' | 'all'   (required)
     *   user_ids:   [int]                       (when scope = 'single')
     *   department_ids: [int]                   (when scope = 'department')
     */
    public function processScoped(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'month_year' => 'required|date_format:Y-m',
            'scope' => 'required|in:single,department,all',
            'user_ids' => 'array',
            'user_ids.*' => 'integer',
            'department_ids' => 'array',
            'department_ids.*' => 'integer',
        ]);

        $orgId = Auth::user()->organization_id;
        $userIds = null;

        if ($validated['scope'] === 'single') {
            $request->validate(['user_ids' => 'required|array|min:1']);
            $userIds = array_map('intval', $validated['user_ids']);
        } elseif ($validated['scope'] === 'department') {
            $request->validate(['department_ids' => 'required|array|min:1']);
            $deptIds = array_map('intval', $validated['department_ids']);
            $userIds = \App\Models\User::query()
                ->where('organization_id', $orgId)
                ->whereHas('groups', fn ($q) => $q->whereIn('groups.id', $deptIds))
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all();

            if (empty($userIds)) {
                return response()->json([
                    'success' => false,
                    'message' => 'No active employees found in the selected department(s).',
                ], 422);
            }
        }

        try {
            $run = $this->autoProcess->processForUsers(
                $orgId,
                $validated['month_year'],
                $userIds,
                Auth::id(),
            );

            return response()->json([
                'success' => true,
                'run' => $run,
                'scope' => $validated['scope'],
                'user_count' => $userIds !== null ? count($userIds) : null,
                'message' => 'Payroll processed successfully',
            ]);
        } catch (\Throwable $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
            ], 500);
        }
    }

    public function quickValidate(Request $request): JsonResponse
    {
        $request->validate([
            'month_year' => 'required|date_format:Y-m',
        ]);

        $orgId = Auth::user()->organization_id;
        $checks = $this->validation->preRunChecks($orgId, $request->month_year);

        return response()->json($checks);
    }

    public function detectChanges(Request $request): JsonResponse
    {
        $request->validate([
            'month_year' => 'required|date_format:Y-m',
        ]);

        $orgId = Auth::user()->organization_id;
        $changes = $this->autoProcess->detectChanges($orgId, $request->month_year);

        return response()->json([
            'success' => true,
            'changes' => $changes,
            'has_changes' => !empty($changes),
        ]);
    }

    public function getDiff(Request $request): JsonResponse
    {
        $request->validate([
            'month_year' => 'required|date_format:Y-m',
        ]);

        $orgId = Auth::user()->organization_id;
        $run = PayrollMonthlyRun::where('organization_id', $orgId)
            ->where('month_year', $request->month_year)
            ->first();

        if (!$run) {
            return response()->json([
                'success' => true,
                'has_prev' => false,
                'message' => 'No current month run yet',
                'diff' => null,
            ]);
        }

        $diff = $this->autoProcess->getPayrollDiff($run);

        return response()->json([
            'success' => true,
            ...$diff,
        ]);
    }

    public function autoGenerateFilings(Request $request): JsonResponse
    {
        $request->validate([
            'run_id' => 'required|exists:payroll_monthly_runs,id',
        ]);

        $orgId = Auth::user()->organization_id;
        $run = PayrollMonthlyRun::where('organization_id', $orgId)->findOrFail($request->run_id);

        $filings = $this->autoProcess->autoGenerateFilings($run, $orgId, Auth::id());

        return response()->json([
            'success' => true,
            'filings_generated' => count($filings),
            'filings' => $filings,
        ]);
    }

    public function validateRun(Request $request): JsonResponse
    {
        $request->validate([
            'run_id' => 'required|exists:payroll_monthly_runs,id',
        ]);

        $orgId = Auth::user()->organization_id;
        $run = PayrollMonthlyRun::where('organization_id', $orgId)->findOrFail($request->run_id);

        $validation = $this->validation->validatePayrollRun($run->id);

        return response()->json($validation);
    }

    public function checklistStatus(Request $request): JsonResponse
    {
        $request->validate([
            'run_id' => 'required|exists:payroll_monthly_runs,id',
        ]);

        $orgId = Auth::user()->organization_id;
        $run = PayrollMonthlyRun::where('organization_id', $orgId)->findOrFail($request->run_id);

        $status = $this->checklist->getRunStatus($run, $orgId, Auth::id());

        return response()->json($status);
    }

    /**
     * Sync attendance for all employees in a payroll run.
     * Uses the simplified attendance calculation (check-in based).
     */
    public function syncAttendanceForRun(Request $request, int $runId): JsonResponse
    {
        $orgId = Auth::user()->organization_id;
        $run = PayrollMonthlyRun::where('organization_id', $orgId)->findOrFail($runId);

        /*
         * Only an open run may be re-synced. This rewrites the attendance
         * columns on every item but never recomputes the money, so running it
         * against a locked or disbursed run left the days on the payslip
         * contradicting the amount that was actually paid.
         */
        if ($closed = app(\App\Services\Payroll\PayrollPeriodGuard::class)->closedRunFor($orgId, $run->month_year.'-01')) {
            return response()->json([
                'success' => false,
                'message' => "Payroll for {$closed->month_year} is already {$closed->status}; its attendance can no longer be re-synced.",
            ], 422);
        }

        // Re-run attendance sync for all items in the run
        $items = \App\Models\PayrollItem::where('payroll_run_id', $run->id)->get();
        $syncedCount = 0;
        $reconciliationCount = 0;

        $userIds = $items->pluck('user_id')->unique()->values()->all();
        $usersById = \App\Models\User::whereIn('id', $userIds)->get()->keyBy('id');

        foreach ($items as $item) {
            $user = $usersById[$item->user_id] ?? null;
            if (!$user) continue;

            $summary = app(\App\Services\Attendance\AttendanceService::class)
                ->monthlyAttendanceSummary($user, $run->month_year);

            // Update with both legacy and simplified fields
            $updateData = [
                'total_working_days' => (float) $summary['working_days'],
                'days_present' => (float) ($summary['legacy_present_days'] ?? $summary['present_days']),
                'days_absent' => (float) ($summary['legacy_lop_days'] ?? $summary['total_lop_days']),
                'days_leave' => (float) $summary['paid_leave_days'],
                'lOP_days' => (float) ($summary['legacy_lop_days'] ?? $summary['total_lop_days']),
                'total_worked_seconds' => (int) ($summary['total_worked_seconds'] ?? 0),
                'overtime_seconds' => (int) ($summary['overtime_seconds'] ?? 0),
                
                // Simplified fields
                'present_days' => (float) $summary['present_days'],
                'paid_leave_days' => (float) $summary['paid_leave_days'],
                'unpaid_leave_days' => (float) $summary['unpaid_leave_days'],
                'half_day_present' => (float) $summary['half_day_present'],
                'half_day_absent' => (float) $summary['half_day_absent'],
                'absent_days' => (float) $summary['absent_days'],
                'total_payable_days' => (float) $summary['total_payable_days'],
                'total_lop_days' => (float) $summary['total_lop_days'],
                'attendance_calculation_mode' => $summary['calculation_mode'] ?? 'simplified',
            ];

            $item->update($updateData);
            $syncedCount++;

            // Check for reconciliation
            $legacyPresent = $summary['legacy_present_days'] ?? $summary['present_days'];
            $newPresent = $summary['present_days'];
            
            if (abs($legacyPresent - $newPresent) > 0.01) {
                \App\Models\PayrollReconciliation::create([
                    'payroll_item_id' => $item->id,
                    'old_present_days' => $legacyPresent,
                    'new_present_days' => $newPresent,
                    'difference' => $legacyPresent - $newPresent,
                    'month_year' => $run->month_year,
                    'debug_info' => [
                        'summary' => $summary,
                        'user_id' => $user->id,
                        'timestamp' => now()->toDateTimeString(),
                    ],
                ]);
                $reconciliationCount++;
            }
        }

        return response()->json([
            'success' => true,
            'message' => 'Attendance synced successfully',
            'run_id' => $runId,
            'month_year' => $run->month_year,
            'employees_synced' => $syncedCount,
            'reconciliation_entries' => $reconciliationCount,
        ]);
    }

    /**
     * Sync attendance for a specific employee in a payroll run.
     */
    public function syncAttendanceForUser(Request $request, int $runId, int $userId): JsonResponse
    {
        $orgId = Auth::user()->organization_id;
        $run = PayrollMonthlyRun::where('organization_id', $orgId)->findOrFail($runId);
        
        $item = \App\Models\PayrollItem::where('payroll_run_id', $runId)
            ->where('user_id', $userId)
            ->firstOrFail();

        $user = \App\Models\User::find($userId);
        if (!$user) {
            return response()->json([
                'success' => false,
                'message' => 'User not found',
            ], 404);
        }

        $summary = app(\App\Services\Attendance\AttendanceService::class)
            ->monthlyAttendanceSummary($user, $run->month_year);

        // Update with both legacy and simplified fields
        $updateData = [
            'total_working_days' => (float) $summary['working_days'],
            'days_present' => (float) ($summary['legacy_present_days'] ?? $summary['present_days']),
            'days_absent' => (float) ($summary['legacy_lop_days'] ?? $summary['total_lop_days']),
            'days_leave' => (float) $summary['paid_leave_days'],
            'lOP_days' => (float) ($summary['legacy_lop_days'] ?? $summary['total_lop_days']),
            'total_worked_seconds' => (int) ($summary['total_worked_seconds'] ?? 0),
            'overtime_seconds' => (int) ($summary['overtime_seconds'] ?? 0),
            
            // Simplified fields
            'present_days' => (float) $summary['present_days'],
            'paid_leave_days' => (float) $summary['paid_leave_days'],
            'unpaid_leave_days' => (float) $summary['unpaid_leave_days'],
            'half_day_present' => (float) $summary['half_day_present'],
            'half_day_absent' => (float) $summary['half_day_absent'],
            'absent_days' => (float) $summary['absent_days'],
            'total_payable_days' => (float) $summary['total_payable_days'],
            'total_lop_days' => (float) $summary['total_lop_days'],
            'attendance_calculation_mode' => $summary['calculation_mode'] ?? 'simplified',
        ];

        $item->update($updateData);

        // Check for reconciliation
        $hasReconciliation = false;
        $legacyPresent = $summary['legacy_present_days'] ?? $summary['present_days'];
        $newPresent = $summary['present_days'];
        
        if (abs($legacyPresent - $newPresent) > 0.01) {
            \App\Models\PayrollReconciliation::create([
                'payroll_item_id' => $item->id,
                'old_present_days' => $legacyPresent,
                'new_present_days' => $newPresent,
                'difference' => $legacyPresent - $newPresent,
                'month_year' => $run->month_year,
                'debug_info' => [
                    'summary' => $summary,
                    'user_id' => $userId,
                    'timestamp' => now()->toDateTimeString(),
                ],
            ]);
            $hasReconciliation = true;
        }

        return response()->json([
            'success' => true,
            'message' => 'Attendance synced for user',
            'run_id' => $runId,
            'user_id' => $userId,
            'month_year' => $run->month_year,
            'attendance_summary' => $summary,
            'has_reconciliation' => $hasReconciliation,
        ]);
    }

    /**
     * Get attendance sync status for a payroll run.
     */
    public function getAttendanceSyncStatus(Request $request, int $runId): JsonResponse
    {
        $orgId = Auth::user()->organization_id;
        $run = PayrollMonthlyRun::where('organization_id', $orgId)->findOrFail($runId);

        $items = \App\Models\PayrollItem::where('payroll_run_id', $run->id)->get();
        
        $totalEmployees = $items->count();
        $usingSimplified = $items->where('attendance_calculation_mode', 'simplified')->count();
        $usingLegacy = $items->where('attendance_calculation_mode', '!=', 'simplified')->count();
        $notSynced = $items->whereNull('attendance_calculation_mode')->count();

        // Get reconciliation data
        $reconciliationCount = \App\Models\PayrollReconciliation::where('month_year', $run->month_year)->count();
        
        // Calculate average differences
        $avgDifference = \App\Models\PayrollReconciliation::where('month_year', $run->month_year)
            ->avg('difference') ?? 0;

        return response()->json([
            'success' => true,
            'run_id' => $runId,
            'month_year' => $run->month_year,
            'summary' => [
                'total_employees' => $totalEmployees,
                'using_simplified' => $usingSimplified,
                'using_legacy' => $usingLegacy,
                'not_synced' => $notSynced,
            ],
            'reconciliation' => [
                'total_entries' => $reconciliationCount,
                'average_difference_days' => round($avgDifference, 2),
            ],
        ]);
    }

    /**
     * Get reconciliation report for a payroll run.
     */
    public function getReconciliationReport(Request $request, int $runId): JsonResponse
    {
        $orgId = Auth::user()->organization_id;
        $run = PayrollMonthlyRun::where('organization_id', $orgId)->findOrFail($runId);

        $reconciliations = \App\Models\PayrollReconciliation::where('month_year', $run->month_year)
            ->with('payrollItem.user')
            ->get()
            ->map(function ($rec) {
                return [
                    'id' => $rec->id,
                    'employee_name' => $rec->payrollItem->user->name ?? 'Unknown',
                    'old_present_days' => $rec->old_present_days,
                    'new_present_days' => $rec->new_present_days,
                    'difference' => $rec->difference,
                    'created_at' => $rec->created_at->toDateTimeString(),
                ];
            });

        return response()->json([
            'success' => true,
            'run_id' => $runId,
            'month_year' => $run->month_year,
            'reconciliations' => $reconciliations,
            'total_count' => $reconciliations->count(),
        ]);
    }
}
