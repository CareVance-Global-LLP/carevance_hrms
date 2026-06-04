<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
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
        $state = $request->get('state') ?? $profile?->pt_state ?? 'maharashtra';
        $taxRegime = $request->get('tax_regime') ?? $profile?->tax_regime ?? 'new';
        $isMetro = $request->get('is_metro_city') ?? $profile?->is_metro_city ?? false;

        $taxExemptions = $this->calculator->getApprovedTaxDeductions($user->id);

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
    public function getEmployees(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        
        $employees = User::where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->with(['employeeProfile', 'employeeBankAccounts'])
            ->get()
            ->map(function ($user) {
                return [
                    'id' => $user->id,
                    'name' => $user->name,
                    'email' => $user->email,
                    'role' => $user->role,
                    'pan_number' => $user->employeeProfile?->pan_number,
                    'uan_number' => $user->employeeProfile?->uan_number,
                    'bank_account' => $user->employeeBankAccounts->first()?->account_number ?? null,
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

        $user = User::with(['employeeProfile', 'employeeBankAccounts', 'organization'])
            ->findOrFail($request->user_id);

        // Generate payslip data
        $payslipData = [
            'employee' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'pan' => $user->employeeProfile?->pan_number,
                'uan' => $user->employeeProfile?->uan_number,
                'bank_account' => $user->employeeBankAccounts->first()?->account_number,
                'bank_ifsc' => $user->employeeBankAccounts->first()?->ifsc_swift,
            ],
            'employer' => [
                'name' => $user->organization?->name,
                'tan' => null, // TODO: Add TAN to organization
            ],
            'month' => $request->month,
            'payroll' => $request->payroll_data,
            'generated_at' => now()->toDateTimeString(),
        ];

        return response()->json([
            'success' => true,
            'payslip' => $payslipData,
            'download_url' => null, // TODO: Generate PDF URL
        ]);
    }

    /**
     * Generate and download payslip as PDF.
     */
    public function downloadPayslipPdf(Request $request, int $userId, string $monthYear)
    {
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
            'Content-Disposition' => "attachment; filename=\"payslip_{$userId}_{$monthYear}.pdf\"",
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
                    'working_days' => $item->total_working_days,
                    'days_present' => $item->days_present,
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

        // Get total payroll amount (mock for now)
        $totalPayroll = 0;

        return response()->json([
            'month' => $month,
            'employee_count' => $employeeCount,
            'total_payroll' => $totalPayroll,
            'status' => 'draft',
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
        $state = $request->get('state', 'maharashtra');
        $taxRegime = $request->get('tax_regime', 'new');
        $isMetro = $request->get('is_metro_city', false);

        foreach ($request->employees as $employee) {
            $taxExemptions = $this->calculator->getApprovedTaxDeductions($employee['user_id']);

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
