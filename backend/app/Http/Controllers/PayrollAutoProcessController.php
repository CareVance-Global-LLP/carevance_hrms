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
}
