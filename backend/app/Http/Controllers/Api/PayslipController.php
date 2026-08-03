<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Payslip;
use App\Models\PayslipYtdHistory;
use App\Models\User;
use App\Services\Payroll\SalaryCalculationService;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Throwable;

/**
 * Payslip endpoints.
 *
 * Every query here is tenant-scoped. Payslip carries the
 * BelongsToOrganization trait, so the global scope constrains reads to the
 * acting user's organization automatically; the explicit ownership checks
 * below add the second layer (an employee may only read their own payslip,
 * while payroll staff may read any within their organization).
 */
class PayslipController extends Controller
{
    /** Roles permitted to see payslips belonging to other employees. */
    private const PAYROLL_ROLES = ['super_admin', 'admin', 'hr', 'payroll_manager'];

    public function __construct(
        private readonly SalaryCalculationService $calculationService,
    ) {
    }

    /**
     * Generate payslips for every active employee in the organization for a
     * given month.
     */
    public function generate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'pay_month' => 'required|integer|between:1,12',
            'pay_year' => 'required|integer|between:2020,2100',
        ]);

        $actor = $request->user();
        if (!$this->canManagePayroll($actor)) {
            return $this->forbidden();
        }

        $organizationId = (int) $actor->organization_id;
        $payMonth = (int) $validated['pay_month'];
        $payYear = (int) $validated['pay_year'];
        $periodMonth = Payslip::periodMonth($payMonth, $payYear);

        // Payroll eligibility is "has an active payroll template", not
        // User::is_active — that accessor is hardcoded to true and filters
        // nothing. An employee without a template cannot be calculated at all
        // (SalaryCalculationService throws), so this is the real gate.
        $employees = User::query()
            ->where('organization_id', $organizationId)
            ->whereHas('employeePayrollTemplate', fn ($q) => $q->where('is_active', true))
            ->pluck('id');

        if ($employees->isEmpty()) {
            return response()->json([
                'success' => false,
                'message' => 'No employees with an active payroll template were found.',
            ], 422);
        }

        $generated = 0;
        $skipped = 0;
        $errors = [];

        foreach ($employees as $employeeId) {
            // Each employee is its own transaction. A single misconfigured
            // employee rolls back only their own rows instead of poisoning
            // — or silently half-committing — the whole run, which is what
            // the previous single outer transaction plus swallowed inner
            // catch actually did.
            try {
                DB::transaction(function () use ($employeeId, $organizationId, $payMonth, $payYear, $periodMonth, $actor, &$generated, &$skipped) {
                    $exists = Payslip::query()
                        ->where('user_id', $employeeId)
                        ->where('period_month', $periodMonth)
                        ->lockForUpdate()
                        ->exists();

                    if ($exists) {
                        $skipped++;
                        return;
                    }

                    $result = $this->calculationService->calculateSalary($employeeId, $payMonth, $payYear);

                    Payslip::create([
                        'organization_id' => $organizationId,
                        'user_id' => $employeeId,
                        'period_month' => $periodMonth,
                        'currency' => 'INR',
                        'basic_salary' => $result['earnings']['basic'] ?? 0,
                        'total_allowances' => max(0, ($result['total_earnings'] ?? 0) - ($result['earnings']['basic'] ?? 0)),
                        'total_deductions' => $result['total_deductions'] ?? 0,
                        'net_salary' => $result['net_payable'] ?? 0,
                        'allowances' => $result['earnings'] ?? [],
                        'deductions' => $result['deductions'] ?? [],
                        'generated_by' => $actor->id,
                        'generated_at' => now(),
                        'payment_status' => 'pending',
                    ]);

                    PayslipYtdHistory::updateOrCreate(
                        [
                            'employee_id' => $employeeId,
                            'pay_month' => $payMonth,
                            'pay_year' => $payYear,
                        ],
                        [
                            'gross' => $result['total_earnings'] ?? 0,
                            'deductions' => $result['total_deductions'] ?? 0,
                            'net' => $result['net_payable'] ?? 0,
                            'pf_ee' => $result['statutory']['pf_ee'] ?? 0,
                            'esi_ee' => $result['statutory']['esi_ee'] ?? 0,
                            'pt' => $result['statutory']['pt'] ?? 0,
                            'lwf' => $result['statutory']['lwf'] ?? 0,
                        ]
                    );

                    $generated++;
                });
            } catch (QueryException $e) {
                // Unique violation on (organization_id, user_id, period_month)
                // means a concurrent run won the race — that is a skip, not a
                // failure.
                if ($this->isUniqueViolation($e)) {
                    $skipped++;
                    continue;
                }
                $errors[] = ['employee_id' => $employeeId, 'message' => 'Database error.'];
                Log::error('Payslip generation DB error', [
                    'employee_id' => $employeeId,
                    'period' => $periodMonth,
                    'error' => $e->getMessage(),
                ]);
            } catch (Throwable $e) {
                $errors[] = ['employee_id' => $employeeId, 'message' => $e->getMessage()];
                Log::error('Payslip generation failed', [
                    'employee_id' => $employeeId,
                    'period' => $periodMonth,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        // Report failure honestly: if nothing was generated and something went
        // wrong, this is not a success.
        $success = $generated > 0 || empty($errors);

        return response()->json([
            'success' => $success,
            'message' => sprintf(
                '%d payslip(s) generated, %d skipped, %d failed.',
                $generated,
                $skipped,
                count($errors)
            ),
            'data' => [
                'generated' => $generated,
                'skipped' => $skipped,
                'failed' => count($errors),
                'total_employees' => $employees->count(),
                'errors' => $errors,
            ],
        ], $success ? 200 : 422);
    }

    /**
     * List payslips for a month within the acting user's organization.
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'pay_month' => 'required|integer|between:1,12',
            'pay_year' => 'required|integer|between:2020,2100',
        ]);

        $actor = $request->user();
        $periodMonth = Payslip::periodMonth((int) $validated['pay_month'], (int) $validated['pay_year']);

        $query = Payslip::query()
            ->with(['user:id,name,email'])
            ->where('period_month', $periodMonth);

        // Employees see only their own row; payroll staff see the whole org.
        if (!$this->canManagePayroll($actor)) {
            $query->where('user_id', $actor->id);
        }

        $payslips = $query->orderBy('id')->get()->map(fn (Payslip $payslip) => [
            'id' => $payslip->id,
            'payslip_number' => $payslip->payslip_number,
            'employee_name' => $payslip->user?->name ?? 'N/A',
            'employee_email' => $payslip->user?->email ?? 'N/A',
            'period_month' => $payslip->period_month,
            'net_payable' => $payslip->net_salary,
            'payment_status' => $payslip->payment_status,
        ]);

        return response()->json(['success' => true, 'data' => $payslips]);
    }

    /**
     * Show a single payslip.
     */
    public function show(Request $request, int $id): JsonResponse
    {
        $payslip = Payslip::with(['user', 'organization'])->find($id);

        if (!$payslip) {
            return response()->json(['success' => false, 'message' => 'Payslip not found.'], 404);
        }

        if (!$this->canView($request->user(), $payslip)) {
            return $this->forbidden();
        }

        $employee = $payslip->user;
        $org = $payslip->organization;

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $payslip->id,
                'payslip_number' => $payslip->payslip_number,
                'period_month' => $payslip->period_month,
                'pay_month' => $payslip->pay_month,
                'pay_year' => $payslip->pay_year,
                'currency' => $payslip->currency,
                'basic_salary' => $payslip->basic_salary,
                'total_allowances' => $payslip->total_allowances,
                'total_deductions' => $payslip->total_deductions,
                'net_payable' => $payslip->net_salary,
                'earnings' => $payslip->allowances ?? [],
                'deductions' => $payslip->deductions ?? [],
                'payment_status' => $payslip->payment_status,
                'paid_at' => $payslip->paid_at?->toIso8601String(),
                'employee' => $employee ? [
                    'id' => $employee->id,
                    'name' => $employee->name,
                    'email' => $employee->email,
                ] : null,
                'organization' => $org ? [
                    'name' => $org->name,
                    'logo_url' => $org->settings['branding']['logo_url'] ?? null,
                ] : null,
                'generated_at' => $payslip->generated_at?->toIso8601String(),
                'created_at' => $payslip->created_at?->toIso8601String(),
            ],
        ]);
    }

    /**
     * Return a download URL for the payslip PDF.
     */
    public function downloadPdf(Request $request, int $id): JsonResponse
    {
        $payslip = Payslip::with(['user', 'organization'])->find($id);

        if (!$payslip) {
            return response()->json(['success' => false, 'message' => 'Payslip not found.'], 404);
        }

        if (!$this->canView($request->user(), $payslip)) {
            return $this->forbidden();
        }

        $path = sprintf('payslips/%d/%s.pdf', $payslip->user_id, $payslip->period_month);

        if (!Storage::exists($path)) {
            return response()->json([
                'success' => false,
                'message' => 'Payslip PDF has not been generated yet.',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'url' => Storage::url($path),
        ]);
    }

    /**
     * Year-to-date history for an employee.
     */
    public function ytd(Request $request, int $id): JsonResponse
    {
        $validated = $request->validate([
            'pay_year' => 'nullable|integer|between:2020,2100',
        ]);

        $payslip = Payslip::find($id);
        if (!$payslip) {
            return response()->json(['success' => false, 'message' => 'Payslip not found.'], 404);
        }

        if (!$this->canView($request->user(), $payslip)) {
            return $this->forbidden();
        }

        $payYear = (int) ($validated['pay_year'] ?? $payslip->pay_year);

        $history = PayslipYtdHistory::query()
            ->where('employee_id', $payslip->user_id)
            ->where('pay_year', $payYear)
            ->orderBy('pay_month')
            ->get();

        return response()->json([
            'success' => true,
            'data' => $history,
            'totals' => PayslipYtdHistory::totalsFor($payslip->user_id, $payYear, 12),
        ]);
    }

    // ---------------------------------------------------------------- helpers

    private function canManagePayroll(?User $user): bool
    {
        if (!$user) {
            return false;
        }

        return in_array(strtolower((string) $user->role), self::PAYROLL_ROLES, true);
    }

    /**
     * An employee may read their own payslip; payroll staff may read any
     * payslip inside their own organization. The global tenant scope has
     * already excluded other organizations before this runs.
     */
    private function canView(?User $user, Payslip $payslip): bool
    {
        if (!$user) {
            return false;
        }

        if ((int) $payslip->user_id === (int) $user->id) {
            return true;
        }

        return $this->canManagePayroll($user)
            && (int) $payslip->organization_id === (int) $user->organization_id;
    }

    private function forbidden(): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => 'Forbidden',
            'error_code' => 'FORBIDDEN',
        ], 403);
    }

    private function isUniqueViolation(QueryException $e): bool
    {
        // 23000/23505 cover MySQL and PostgreSQL integrity constraint violations.
        return in_array((string) $e->getCode(), ['23000', '23505'], true);
    }
}
