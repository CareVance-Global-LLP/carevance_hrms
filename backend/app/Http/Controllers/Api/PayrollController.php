<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\PayrollTimeEntry;
use App\Models\User;
use App\Models\Organization;
use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Payroll Controller
 * 
 * Handles all payroll-related operations including:
 * - Standalone payroll time tracking (check-in/check-out)
 * - Payroll calculations with Indian statutory deductions
 * - Employee payroll profile management
 * - Payslip generation
 */
class PayrollController extends Controller
{
    protected PayrollCalculatorService $calculator;

    public function __construct(PayrollCalculatorService $calculator)
    {
        $this->calculator = $calculator;
    }

    /**
     * Get payroll dashboard data.
     */
    public function dashboard(Request $request): JsonResponse
    {
        $user = $request->user();
        $organizationId = $user->organization_id;

        // Get current month's stats
        $currentMonth = now()->format('Y-m');
        
        // Get active time entry for today
        $activeEntry = PayrollTimeEntry::where('user_id', $user->id)
            ->where('work_date', today())
            ->whereNotNull('check_in')
            ->whereNull('check_out')
            ->first();

        // Get today's duration
        $todayEntry = PayrollTimeEntry::where('user_id', $user->id)
            ->where('work_date', today())
            ->first();

        $todayDuration = $todayEntry ? $todayEntry->duration_seconds : 0;

        // Get month stats
        $monthEntries = PayrollTimeEntry::where('user_id', $user->id)
            ->whereYear('work_date', now()->year)
            ->whereMonth('work_date', now()->month)
            ->get();

        $totalHours = $monthEntries->sum('duration_seconds') / 3600;
        $totalDays = $monthEntries->count();

        return response()->json([
            'active_entry' => $activeEntry,
            'today_duration' => $todayDuration,
            'today_duration_formatted' => $todayEntry ? $todayEntry->formatted_duration : '00:00',
            'month_hours' => round($totalHours, 2),
            'month_days' => $totalDays,
            'is_checked_in' => $activeEntry !== null,
        ]);
    }

    /**
     * Check in for standalone payroll.
     */
    public function checkIn(Request $request): JsonResponse
    {
        $user = $request->user();

        // Check if already checked in
        $existing = PayrollTimeEntry::where('user_id', $user->id)
            ->where('work_date', today())
            ->whereNotNull('check_in')
            ->whereNull('check_out')
            ->first();

        if ($existing) {
            return response()->json([
                'success' => false,
                'message' => 'Already checked in',
                'entry' => $existing,
            ], 422);
        }

        // Create or update entry
        $entry = PayrollTimeEntry::updateOrCreate(
            [
                'user_id' => $user->id,
                'work_date' => today(),
            ],
            [
                'organization_id' => $user->organization_id,
                'check_in' => now(),
                'status' => 'active',
            ]
        );

        return response()->json([
            'success' => true,
            'message' => 'Checked in successfully',
            'entry' => $entry,
        ]);
    }

    /**
     * Check out for standalone payroll.
     */
    public function checkOut(Request $request): JsonResponse
    {
        $user = $request->user();

        $entry = PayrollTimeEntry::where('user_id', $user->id)
            ->where('work_date', today())
            ->whereNotNull('check_in')
            ->whereNull('check_out')
            ->first();

        if (!$entry) {
            return response()->json([
                'success' => false,
                'message' => 'No active check-in found',
            ], 422);
        }

        $entry->update([
            'check_out' => now(),
            'duration_seconds' => $entry->calculateDuration(),
            'payable_hours' => $entry->calculateDuration() / 3600,
            'status' => 'completed',
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Checked out successfully',
            'entry' => $entry->fresh(),
        ]);
    }

    /**
     * Get time entries for a user.
     */
    public function getTimeEntries(Request $request): JsonResponse
    {
        $user = $request->user();
        $entries = PayrollTimeEntry::where('user_id', $user->id)
            ->whereBetween('work_date', [
                $request->get('from', now()->startOfMonth()),
                $request->get('to', now()->endOfMonth())
            ])
            ->orderBy('work_date', 'desc')
            ->get();

        return response()->json($entries);
    }

    /**
     * Calculate payroll for an employee.
     */
    public function calculate(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'annual_ctc' => 'required|numeric|min:0',
            'state' => 'nullable|string',
            'tax_regime' => 'nullable|in:new,old',
            'is_metro_city' => 'nullable|boolean',
        ]);

        $user = User::findOrFail($request->user_id);
        
        // Get employee profile data
        $profile = $user->employeeProfile;
        // Empty rather than a fallback state: professional tax is state-levied
        // and several states charge none, so an unconfigured employee must
        // yield ₹0 instead of inheriting another state's slab.
        $state = $request->get('state') ?: ($profile?->pt_state ?: '');
        $taxRegime = $request->get('tax_regime') ?? $profile?->tax_regime ?? 'new';
        $isMetro = $request->get('is_metro_city') ?? $profile?->is_metro_city ?? false;

        // Per-section map, not a flat sum: a bare total lands entirely in
        // 80C and is capped at 1.5L, discarding 24B/80D/80CCD(1B) relief.
        $taxExemptions = $this->calculator->getApprovedTaxDeductionMap($user->id);

        $calculation = $this->calculator->calculatePayroll(
            annualCtc: $request->annual_ctc,
            stateCode: $state,
            isMetroCity: $isMetro,
            taxRegime: $taxRegime,
            annualTaxExemptions: $taxExemptions
        );

        return response()->json([
            'success' => true,
            'calculation' => $calculation,
        ]);
    }

    /**
     * Get available states for PT.
     */
    public function getPTStates(): JsonResponse
    {
        return response()->json([
            'all_states' => PTStateService::getStates(),
            'states_with_pt' => PTStateService::getStatesWithPT(),
            'states_without_pt' => PTStateService::getStatesWithoutPT(),
        ]);
    }

    /**
     * Get PT configuration for a state.
     */
    public function getPTConfiguration(Request $request, string $state): JsonResponse
    {
        $config = PTStateService::getConfiguration($state);
        
        if (!$config) {
            return response()->json([
                'success' => false,
                'message' => 'State not found',
            ], 404);
        }

        return response()->json([
            'success' => true,
            'state' => $state,
            'configuration' => $config,
            'has_pt' => PTStateService::hasPT($state),
            'annual_limit' => PTStateService::getAnnualLimit($state),
        ]);
    }

    /**
     * Get organization employees for payroll.
     */
    /**
     * Payroll roster with statutory and bank identifiers.
     *
     * Organization scoping alone was the only check here, which meant any
     * signed-in employee could read every colleague's PAN, UAN and full bank
     * account number. Two things now stand in the way: the caller has to be
     * able to run payroll, and account numbers are masked to the last four
     * digits — a roster exists to confirm details are present, not to reprint
     * them.
     */
    public function getEmployees(Request $request): JsonResponse
    {
        $currentUser = $request->user();
        $organizationId = $currentUser->organization_id;

        $isPayrollStaff = $currentUser->getHierarchyLevel() <= Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['manager']
            || (bool) ($currentUser->settings['payroll_visibility'] ?? false);

        if (! $isPayrollStaff) {
            return response()->json([
                'message' => 'You do not have access to payroll records.',
            ], 403);
        }

        $employees = User::where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->with(['employeeProfile', 'employeeBankAccounts'])
            ->get()
            ->map(function ($user) {
                $account = $user->employeeBankAccounts->first()?->account_number;

                return [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'pan_number' => $user->employeeProfile?->pan_number,
                    'uan_number' => $user->employeeProfile?->uan_number,
                    // Masked in place rather than removed, so existing callers
                    // keep their field. A roster needs to show that an account
                    // is on file, never to reprint the number.
                    'bank_account' => $account ? '••••'.substr($account, -4) : null,
                    'bank_account_last4' => $account ? substr($account, -4) : null,
                    'has_bank_account' => filled($account),
                    'bank_ifsc' => $user->employeeBankAccounts->first()?->ifsc_swift ?? null,
                ];
            });

        return response()->json($employees);
    }

    /**
     * Update employee payroll profile.
     */
    public function updateEmployeeProfile(Request $request, int $userId): JsonResponse
    {
        $request->validate([
            'pan_number' => 'nullable|string|size:10',
            'uan_number' => 'nullable|string|size:12',
            'esi_ip_number' => 'nullable|string|size:17',
            'tax_regime' => 'nullable|in:new,old',
            'is_metro_city' => 'nullable|boolean',
            'pt_state' => 'nullable|string',
        ]);

        $user = User::findOrFail($userId);
        
        // Ensure user belongs to same organization
        if ($user->organization_id !== $request->user()->organization_id) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthorized',
            ], 403);
        }

        // Update employee profile
        $profile = $user->employeeProfile;
        if (!$profile) {
            $profile = new \App\Models\EmployeeProfile([
                'user_id' => $userId,
                'organization_id' => $user->organization_id,
            ]);
        }

        $profile->fill($request->only([
            'pan_number',
            'uan_number',
            'esi_ip_number',
            'tax_regime',
            'is_metro_city',
            'pt_state',
        ]));
        
        $profile->save();

        return response()->json([
            'success' => true,
            'message' => 'Profile updated successfully',
            'profile' => $profile,
        ]);
    }

    /**
     * Process payroll payment.
     */
    public function processPayment(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'amount' => 'required|numeric|min:0',
            'payment_method' => 'required|in:bank_transfer,razorpay,cash',
            'month' => 'required|string',
            'payroll_data' => 'required|array',
        ]);

        $user = User::findOrFail($request->user_id);
        $organizationId = $request->user()->organization_id;
        
        // Find the payroll item for this user and month
        $payrollItem = PayrollItem::where('user_id', $request->user_id)
            ->whereHas('payrollRun', function ($q) use ($request) {
                $q->where('month_year', $request->month);
            })
            ->first();

        if (!$payrollItem) {
            return response()->json([
                'success' => false,
                'message' => 'Payroll not found for this employee and month',
            ], 404);
        }

        // Guard: do not allow payments against a run that's already disbursed (terminal/immutable).
        $run = $payrollItem->payrollRun;
        if ($run && $run->isImmutable()) {
            return response()->json([
                'success' => false,
                'message' => "Cannot process payment — payroll run for {$run->month_year} is already disbursed and immutable.",
            ], 422);
        }
        
        // Update the payroll item payment status
        $payrollItem->update([
            'payment_status' => 'paid',
            'paid_at' => now(),
            'payment_method' => $request->payment_method,
            'payment_reference' => 'PAY-' . strtoupper(uniqid()),
        ]);
        
        $paymentReference = $payrollItem->payment_reference;

        return response()->json([
            'success' => true,
            'message' => 'Payment processed successfully',
            'payment_reference' => $paymentReference,
            'status' => 'completed',
            'amount' => $request->amount,
            'user' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
        ]);
    }

    /**
     * Generate payslip.
     */
    public function generatePayslip(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'month' => 'required|string',
            'payroll_data' => 'required|array',
        ]);

        // `exists:users,id` above only proves the row exists somewhere — it does
        // not confine it to the caller's organisation, and User is deliberately
        // outside the tenant global scope, so findOrFail() reached across
        // tenants. The response below carries name, email, PAN, UAN and a bank
        // account number, so this returned another company's employee data to
        // anyone who could guess an id.
        $user = User::with(['employeeProfile', 'employeeBankAccounts', 'employeeGovernmentIds', 'organization'])
            ->where('organization_id', $request->user()->organization_id)
            ->findOrFail($request->user_id);

        // Generate payslip data
        $payslipData = [
            'employee' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                /*
                 * Through statutoryId, not off the profile column.
                 *
                 * A PAN or UAN lives in employeeProfile OR in
                 * employee_government_ids, and reading only the column reports
                 * null for everybody who recorded theirs in the Government IDs
                 * panel — which is most people, since that is where the
                 * onboarding checklist collects it. statutoryId reads both and
                 * resolves a duplicate deterministically.
                 */
                'pan' => $user->statutoryId('pan'),
                'uan' => $user->statutoryId('uan'),
                'bank_account' => $user->employeeBankAccounts->first()?->account_number,
                'bank_ifsc' => $user->employeeBankAccounts->first()?->ifsc_swift,
            ],
            'employer' => [
                'name' => $user->organization?->name,
                /*
                 * TAN belongs to the LEGAL ENTITY, not the organization.
                 *
                 * This returned null under a TODO to "add TAN to organization",
                 * which is the wrong place for it: one organization can run
                 * several companies, each with its own PAN and TAN, and that is
                 * exactly what legal_entities exists to hold. LegalEntityResolver
                 * already decides which entity an employee files under and
                 * defaults to the organization's primary one.
                 *
                 * Null is still a legitimate answer — an organization that has
                 * not set up an entity has no TAN to show — but it is now an
                 * absent fact rather than an unimplemented one.
                 */
                'tan' => app(\App\Services\Payroll\LegalEntityResolver::class)
                    ->forUser($user)?->tan,
            ],
            'month' => $request->month,
            'payroll' => $request->payroll_data,
            'generated_at' => now()->toDateTimeString(),
        ];

        return response()->json([
            'success' => true,
            'payslip' => $payslipData,
            /*
             * The PDF route already exists — this endpoint just never pointed
             * at it. downloadPayslipPdf enforces denyForeignPayslip, so the
             * link is safe to hand out: following it as the wrong person is
             * refused there rather than here.
             */
            'download_url' => url(sprintf(
                '/api/payroll/payslip/%d/%s/download',
                $user->id,
                (string) $request->month
            )),
        ]);
    }

    /**
     * Payslip PDF routes take a {userId} instead of resolving the subject from
     * the caller, so they cannot rely on the self-service group's guarantee.
     *
     * An employee may only ask for their own; anyone with payroll privilege
     * (hierarchy level below employee) may ask for anyone in their org, which
     * the model's organization scope already bounds.
     *
     * @return \Illuminate\Http\JsonResponse|null null when the caller may proceed
     */
    private function denyForeignPayslip(Request $request, int $userId): ?\Illuminate\Http\JsonResponse
    {
        $caller = $request->user();

        if (! $caller) {
            return response()->json([
                'success' => false,
                'message' => 'Unauthenticated.',
            ], 401);
        }

        if ($caller->id === $userId || $caller->getHierarchyLevel() < 100) {
            return null;
        }

        return response()->json([
            'success' => false,
            'message' => 'Forbidden',
            'error_code' => 'FORBIDDEN',
        ], 403);
    }

    /**
     * Generate and download payslip as PDF.
     */
    public function downloadPayslipPdf(Request $request, int $userId, string $monthYear)
    {
        if ($denied = $this->denyForeignPayslip($request, $userId)) {
            return $denied;
        }

        $payrollItem = PayrollItem::where('user_id', $userId)
            ->whereHas('payrollRun', function ($q) use ($monthYear) {
                $q->where('month_year', $monthYear);
            })
            ->first();

        if (!$payrollItem) {
            return response()->json([
                'success' => false,
                'message' => 'Payslip not found for this month',
            ], 404);
        }

        $pdfService = new \App\Services\PayrollPdfService();
        $pdf = $pdfService->generatePayslip($payrollItem);

        $filename = $this->payslipFilename($payrollItem->user, $monthYear);

        return response($pdf->output(), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => "attachment; filename=\"{$filename}\"",
        ]);
    }

    /**
     * What the file is called when it lands in somebody's Downloads folder.
     *
     * It was `payslip_361_2026-08.pdf` — an internal user id and a numeric
     * month, which tells the person who downloaded it nothing. Somebody saving
     * three months of payslips got three files they had to open to tell apart,
     * and the id is meaningless outside the database.
     *
     * `payslip_Akash_Vijaykumar_August_2026.pdf` sorts, searches and reads.
     * Non-filename characters are stripped rather than escaped, because a name
     * with a slash or a colon in it breaks the download on Windows entirely.
     */
    private function payslipFilename(?User $employee, string $monthYear): string
    {
        $name = preg_replace('/[^A-Za-z0-9]+/', '_', (string) ($employee?->name ?? ''));
        $name = trim((string) $name, '_');

        try {
            $period = \App\Support\MonthYear::start($monthYear)->format('F_Y');
        } catch (\Throwable $e) {
            // A malformed month must not stop somebody downloading their payslip.
            $period = str_replace('-', '_', $monthYear);
        }

        return 'payslip_'.($name !== '' ? $name.'_' : '').$period.'.pdf';
    }

    /**
     * Generate and stream payslip as PDF for inline browser viewing.
     * Uses Content-Disposition: inline so the browser renders the PDF
     * inside a new tab instead of triggering a download dialog. The
     * downloadPayslipPdf() method above uses 'attachment' for the same
     * PDF so callers can choose whether to preview or save.
     */
    public function viewPayslipPdf(Request $request, int $userId, string $monthYear)
    {
        if ($denied = $this->denyForeignPayslip($request, $userId)) {
            return $denied;
        }

        $payrollItem = PayrollItem::where('user_id', $userId)
            ->whereHas('payrollRun', function ($q) use ($monthYear) {
                $q->where('month_year', $monthYear);
            })
            ->first();

        if (!$payrollItem) {
            return response()->json([
                'success' => false,
                'message' => 'Payslip not found for this month',
            ], 404);
        }

        $pdfService = new \App\Services\PayrollPdfService();
        $pdf = $pdfService->generatePayslip($payrollItem);

        return response($pdf->output(), 200, [
            'Content-Type' => 'application/pdf',
            // "inline" tells the browser to render in-tab (which most
            // browsers do via the built-in PDF viewer). The filename is
            // still set so the browser uses it if the user chooses
            // "Save As" from the viewer.
            'Content-Disposition' => 'inline; filename="'.$this->payslipFilename($payrollItem->user, $monthYear).'"',
        ]);
    }

    /**
     * Employee self-service: get my payslips.
     */
    public function myPayslips(Request $request): JsonResponse
    {
        $user = $request->user();

        $payrollItems = PayrollItem::where('user_id', $user->id)
            ->with(['payrollRun'])
            ->orderBy('id', 'desc')
            ->get()
            ->map(function ($item) {
                return [
                    'id' => $item->id,
                    'month_year' => $item->payrollRun?->month_year,
                    'gross_salary' => $item->gross_salary,
                    'total_deductions' => $item->total_deductions,
                    'net_pay' => $item->net_pay,
                    'payment_status' => $item->payment_status,
                    'basic' => $item->basic,
                    'hra' => $item->hra,
                    'conveyance' => $item->conveyance,
                    'special_allowance' => $item->special_allowance,
                    'pf_employee' => $item->pf_employee,
                    'esi_employee' => $item->esi_employee,
                    'pt' => $item->pt,
                    'tds' => $item->tds,
                    'lwf' => $item->lwf,
                    /*
                     * The three things a payslip needs to explain itself.
                     *
                     * `lOP_deduction` names the money the LOP days cost, which
                     * the day counts alone do not. `deduction_lines` is the
                     * per-commitment breakdown behind `custom_deductions` — a
                     * loan and an advance are two deductions, and their combined
                     * total cannot be decomposed after the fact. And the employer
                     * contributions are what makes a CTC figure add up: an
                     * employee comparing their payslip against their offer needs
                     * to see the half that never reaches their account.
                     */
                    'lop_deduction' => $item->lOP_deduction,
                    'custom_deductions' => $item->custom_deductions,
                    'deduction_lines' => $item->deduction_lines ?? [],
                    'employer_contributions' => [
                        'pf_employer' => $item->pf_employer,
                        'esi_employer' => $item->esi_employer,
                    ],
                    'working_days' => $item->total_working_days,
                    'days_present' => $item->days_present,
                    'lOP_days' => $item->lOP_days,
                    // Hours snapshot (read-only; derived from the *_seconds
                    // columns on the model). Display in hours to avoid
                    // huge numbers like 3,105,657s in the UI.
                    'worked_hours' => $item->worked_hours,
                    'productive_hours' => $item->productive_hours,
                    'overtime_hours' => $item->overtime_hours,
                    'idle_hours' => $item->idle_hours,
                    'unproductive_hours' => $item->unproductive_hours,
                    'created_at' => $item->created_at,
                ];
            });

        // Calculate YTD totals
        $ytdGross = $payrollItems->sum('gross_salary');
        $ytdDeductions = $payrollItems->sum('total_deductions');
        $ytdNetPay = $payrollItems->sum('net_pay');

        $profile = $user->employeeProfile;

        return response()->json([
            'payslips' => $payrollItems,
            'ytd' => [
                'gross' => $ytdGross,
                'deductions' => $ytdDeductions,
                'net_pay' => $ytdNetPay,
                'months_count' => $payrollItems->count(),
            ],
            'employee' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'employee_code' => $user->employeeWorkInfo?->employee_code,
                'designation' => $user->employeeWorkInfo?->designation,
                'department' => $user->groups->first()?->name,
                'pan_number' => $profile?->pan_number,
                'uan_number' => $profile?->uan_number,
                'bank_account' => $user->employeeBankAccounts->first()?->account_number,
                'bank_ifsc' => $user->employeeBankAccounts->first()?->ifsc_swift,
            ],
        ]);
    }

    /**
     * Get payroll summary for organization.
     */
    public function getSummary(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $month = $request->get('month', now()->format('Y-m'));

        // Get employee count
        $employeeCount = User::where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->count();

        // Compute actual payroll totals from monthly runs
        $runs = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $month)
            ->get();

        $totalPayroll = $runs->sum('total_net_pay');
        $totalGross = $runs->sum('total_gross');
        $totalDeductions = $runs->sum('total_deductions');

        // Determine overall status: if any run is disbursed, the month is disbursed;
        // otherwise if any is approved, it's approved; otherwise if any is submitted, it's submitted;
        // otherwise draft.
        $statuses = $runs->pluck('status');
        if ($statuses->contains('disbursed')) {
            $overallStatus = 'disbursed';
        } elseif ($statuses->contains('approved')) {
            $overallStatus = 'approved';
        } elseif ($statuses->contains('submitted')) {
            $overallStatus = 'submitted';
        } elseif ($statuses->contains('generated')) {
            $overallStatus = 'generated';
        } else {
            $overallStatus = 'draft';
        }

        return response()->json([
            'month' => $month,
            'employee_count' => $employeeCount,
            'total_payroll' => $totalPayroll,
            'total_gross' => $totalGross,
            'total_deductions' => $totalDeductions,
            'status' => $overallStatus,
        ]);
    }

    /**
     * Calculate multiple employees' payroll.
     */
    public function calculateBulk(Request $request): JsonResponse
    {
        $request->validate([
            'employees' => 'required|array',
            'employees.*.user_id' => 'required|exists:users,id',
            'employees.*.annual_ctc' => 'required|numeric|min:0',
        ]);

        $results = [];
        // Empty rather than a fallback state — the same rule calculate()
        // above already follows, and the reason the two endpoints used to
        // disagree: given the same unconfigured employee, calculate()
        // returned ₹0 professional tax and calculate-bulk returned
        // Maharashtra's ₹200. One caller applying one state to a whole list
        // of people makes that worse, not better.
        $state = $request->get('state') ?: '';
        $taxRegime = $request->get('tax_regime', 'new');
        $isMetro = $request->get('is_metro_city', false);

        foreach ($request->employees as $employee) {
            // Per-section map — see note in calculate().
            $taxExemptions = $this->calculator->getApprovedTaxDeductionMap($employee['user_id']);

            $calculation = $this->calculator->calculatePayroll(
                annualCtc: $employee['annual_ctc'],
                stateCode: $state,
                isMetroCity: $isMetro,
                taxRegime: $taxRegime,
                annualTaxExemptions: $taxExemptions
            );

            $results[] = [
                'user_id' => $employee['user_id'],
                'calculation' => $calculation,
            ];
        }

        return response()->json([
            'success' => true,
            'results' => $results,
        ]);
    }
}
