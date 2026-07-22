<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Employee;
use App\Models\Payslip;
use App\Models\PayslipYtdHistory;
use App\Services\Payroll\SalaryCalculationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;

class PayslipController extends Controller
{
    protected SalaryCalculationService $calculationService;

    public function __construct(SalaryCalculationService $calculationService)
    {
        $this->calculationService = $calculationService;
    }

    /**
     * Generate payslips for all employees in a pay group for a given month
     */
    public function generate(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'pay_group_id' => 'required|integer|exists:pay_groups,id',
            'pay_month' => 'required|integer|between:1,12',
            'pay_year' => 'required|integer|between:2020,2030',
        ]);

        $payGroupId = $validated['pay_group_id'];
        $payMonth = $validated['pay_month'];
        $payYear = $validated['pay_year'];

        // Check for existing payslips
        $existing = Payslip::where('pay_group_id', $payGroupId)
            ->where('pay_month', $payMonth)
            ->where('pay_year', $payYear)
            ->exists();

        if ($existing) {
            return response()->json([
                'success' => false,
                'message' => 'Payslips already generated for this pay group and month.',
            ], 422);
        }

        // Get all active employees in this pay group
        $employees = Employee::where('pay_group_id', $payGroupId)
            ->where('is_active', true)
            ->get();

        if ($employees->isEmpty()) {
            return response()->json([
                'success' => false,
                'message' => 'No active employees found in this pay group.',
            ], 422);
        }

        $generated = 0;
        $errors = [];

        DB::beginTransaction();
        try {
            foreach ($employees as $employee) {
                try {
                    $result = $this->calculationService->calculateSalary($employee->id, $payMonth, $payYear);

                    $payslipNumber = Payslip::generateNumber($payMonth, $payYear);

                    $payslip = Payslip::create([
                        'pay_group_id' => $payGroupId,
                        'user_id' => $employee->id,
                        'employee_id' => $employee->id,
                        'pay_month' => $payMonth,
                        'pay_year' => $payYear,
                        'payslip_number' => $payslipNumber,
                        'status' => 'generated',
                        'total_days' => $result['attendance']['total_days'],
                        'days_present' => $result['attendance']['days_present'],
                        'paid_leave' => $result['attendance']['paid_leave'],
                        'lop_days' => $result['attendance']['lop_days'],
                        'half_days' => $result['attendance']['half_days'],
                        'overtime_hours' => $result['attendance']['overtime_hours'],
                        'earnings' => $result['earnings'],
                        'total_earnings' => $result['total_earnings'],
                        'deductions' => $result['deductions'],
                        'total_deductions' => $result['total_deductions'],
                        'net_payable' => $result['net_payable'],
                        'net_pay_words' => $result['net_pay_words'],
                        'pf_ee' => $result['statutory']['pf_ee'],
                        'pf_er' => $result['statutory']['pf_er'],
                        'edli' => $result['statutory']['edli'],
                        'admin_charges' => $result['statutory']['admin_charges'],
                        'esi_ee' => $result['statutory']['esi_ee'],
                        'esi_er' => $result['statutory']['esi_er'],
                        'pt_amount' => $result['statutory']['pt'],
                        'lwf_ee' => $result['statutory']['lwf'],
                        'lwf_er' => $result['statutory']['lwf'],
                        'tds' => $result['statutory']['tds'],
                        'loan_emi' => $result['deductions']['loan_emi'],
                        'advance_recovery' => $result['deductions']['advance_recovery'],
                        'late_penalty' => $result['deductions']['late_penalty'],
                        'employer_contribution' => $result['employer_contribution'],
                        'total_employer_contribution' => $result['employer_contribution']['total'],
                        'ytd_gross' => $result['ytd']['gross'],
                        'ytd_deductions' => $result['ytd']['deductions'],
                        'ytd_net' => $result['ytd']['net'],
                        'ytd_pf_ee' => $result['ytd']['pf_ee'],
                        'ytd_esi_ee' => $result['ytd']['esi_ee'],
                        'ytd_pt' => $result['ytd']['pt'],
                        'ytd_lwf' => $result['ytd']['lwf'],
                    ]);

                    // Save YTD history
                    PayslipYtdHistory::updateOrCreate(
                        [
                            'employee_id' => $employee->id,
                            'pay_month' => $payMonth,
                            'pay_year' => $payYear,
                        ],
                        [
                            'gross' => $result['total_earnings'],
                            'deductions' => $result['total_deductions'],
                            'net' => $result['net_payable'],
                            'pf_ee' => $result['statutory']['pf_ee'],
                            'esi_ee' => $result['statutory']['esi_ee'],
                            'pt' => $result['statutory']['pt'],
                            'lwf' => $result['statutory']['lwf'],
                        ]
                    );

                    $generated++;
                } catch (\Exception $e) {
                    $errors[] = "Employee {$employee->id}: " . $e->getMessage();
                    Log::error("Payslip generation failed for employee {$employee->id}", ['error' => $e->getMessage()]);
                }
            }

            DB::commit();

            return response()->json([
                'success' => true,
                'message' => "{$generated} payslips generated successfully.",
                'data' => [
                    'generated' => $generated,
                    'total_employees' => $employees->count(),
                    'errors' => $errors,
                ],
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            return response()->json([
                'success' => false,
                'message' => 'Failed to generate payslips: ' . $e->getMessage(),
            ], 500);
        }
    }

    /**
     * List payslips for a pay group/month
     */
    public function index(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'pay_group_id' => 'required|integer',
            'pay_month' => 'required|integer|between:1,12',
            'pay_year' => 'required|integer',
        ]);

        $payslips = Payslip::with(['employee'])
            ->where('pay_group_id', $validated['pay_group_id'])
            ->where('pay_month', $validated['pay_month'])
            ->where('pay_year', $validated['pay_year'])
            ->orderBy('payslip_number')
            ->get()
            ->map(function ($payslip) {
                return [
                    'id' => $payslip->id,
                    'payslip_number' => $payslip->payslip_number,
                    'employee_name' => $payslip->employee?->name ?? 'N/A',
                    'employee_code' => $payslip->employee?->employee_code ?? 'N/A',
                    'designation' => $payslip->employee?->designation ?? 'N/A',
                    'department' => $payslip->employee?->department?->name ?? 'N/A',
                    'net_payable' => $payslip->net_payable,
                    'status' => $payslip->status,
                    'has_pdf' => !empty($payslip->pdf_path),
                ];
            });

        return response()->json([
            'success' => true,
            'data' => $payslips,
        ]);
    }

    /**
     * Get single payslip details
     */
    public function show(int $id): JsonResponse
    {
        $payslip = Payslip::with(['employee.organization', 'payGroup'])->find($id);

        if (!$payslip) {
            return response()->json(['success' => false, 'message' => 'Payslip not found.'], 404);
        }

        $employee = $payslip->employee;
        $org = $employee?->organization;

        $companyAddress = null;
        if ($org) {
            $addressParts = array_filter([
                $org->address_line,
                trim(($org->city ?? '') . ', ' . ($org->state ?? '') . ' ' . ($org->postal_code ?? '')),
                $org->country,
            ]);
            $companyAddress = implode(', ', $addressParts) ?: null;
        }

        $logoUrl = null;
        if ($org) {
            $logoUrl = $org->settings['branding']['logo_url'] ?? null;
        }

        return response()->json([
            'success' => true,
            'data' => [
                'id' => $payslip->id,
                'payslip_number' => $payslip->payslip_number,
                'pay_month' => $payslip->pay_month,
                'pay_year' => $payslip->pay_year,
                'status' => $payslip->status,
                'attendance' => [
                    'total_days' => $payslip->total_days,
                    'days_present' => $payslip->days_present,
                    'paid_leave' => $payslip->paid_leave,
                    'lop_days' => $payslip->lop_days,
                    'half_days' => $payslip->half_days,
                    'overtime_hours' => $payslip->overtime_hours,
                ],
                'earnings' => $payslip->earnings,
                'deductions' => $payslip->deductions,
                'total_earnings' => $payslip->total_earnings,
                'total_deductions' => $payslip->total_deductions,
                'net_payable' => $payslip->net_payable,
                'net_pay_words' => $payslip->net_pay_words,
                'statutory' => [
                    'pf_ee' => $payslip->pf_ee,
                    'pf_er' => $payslip->pf_er,
                    'esi_ee' => $payslip->esi_ee,
                    'esi_er' => $payslip->esi_er,
                    'pt' => $payslip->pt_amount,
                    'lwf' => $payslip->lwf_ee,
                    'tds' => $payslip->tds,
                ],
                'employer_contribution' => $payslip->employer_contribution,
                'ytd' => [
                    'gross' => $payslip->ytd_gross,
                    'deductions' => $payslip->ytd_deductions,
                    'net' => $payslip->ytd_net,
                    'pf_ee' => $payslip->ytd_pf_ee,
                    'esi_ee' => $payslip->ytd_esi_ee,
                    'pt' => $payslip->ytd_pt,
                    'lwf' => $payslip->ytd_lwf,
                ],
                'employee' => $employee ? [
                    'id' => $employee->id,
                    'name' => $employee->name,
                    'employee_code' => $employee->employee_code ?? '',
                    'designation' => $employee->designation ?? '',
                    'department' => $employee->department?->name ?? '',
                    'date_of_joining' => $employee->doj?->format('d-M-Y') ?? '',
                    'pan' => $employee->pan_number ?? '',
                    'uan' => $employee->uan_number ?? '',
                    'pf_account' => $employee->pf_account ?? '',
                    'bank_account' => $employee->bank_account ?? '',
                    'ifsc' => $employee->ifsc ?? '',
                    'pt_state' => $employee->pt_state ?? '',
                ] : null,
                'organization' => $org ? [
                    'name' => $org->name,
                    'logo_url' => $logoUrl,
                    'address' => $companyAddress,
                    'pan' => $org->pan ?? null,
                ] : null,
                'has_pdf' => !empty($payslip->pdf_path),
                'pdf_url' => $payslip->pdf_path ? Storage::url($payslip->pdf_path) : null,
                'created_at' => $payslip->created_at->format('d-M-Y H:i'),
            ],
        ]);
    }

    /**
     * Download payslip PDF — always regenerates fresh to avoid stale cached PDFs.
     */
    public function downloadPdf(int $id): JsonResponse
    {
        $payslip = Payslip::with(['user.payrollItems.payrollRun'])->find($id);

        if (!$payslip) {
            return response()->json(['success' => false, 'message' => 'Payslip not found.'], 404);
        }

        // Find the PayrollItem matching this payslip's user + month
        $monthYear = sprintf('%d-%02d', $payslip->pay_year, $payslip->pay_month);
        $payrollItem = $payslip->user?->payrollItems?->first(function ($item) use ($monthYear) {
            return $item->payrollRun?->month_year === $monthYear;
        });

        if (!$payrollItem) {
            // Fallback: try loading PayrollItem directly
            $payrollItem = \App\Models\PayrollItem::where('user_id', $payslip->user_id)
                ->whereHas('payrollRun', function ($q) use ($monthYear) {
                    $q->where('month_year', $monthYear);
                })
                ->first();
        }

        if (!$payrollItem) {
            return response()->json(['success' => false, 'message' => 'Payroll data not found for this payslip.'], 404);
        }

        // Generate fresh PDF using the same service PayrollController uses
        $pdfService = new \App\Services\PayrollPdfService();
        $pdf = $pdfService->generatePayslip($payrollItem);

        // Store the fresh PDF
        $pdfContent = $pdf->output();
        $pdfPath = "payslips/{$payslip->user_id}/{$monthYear}.pdf";
        Storage::put($pdfPath, $pdfContent);

        // Update payslip record with fresh path and timestamp
        $payslip->update([
            'pdf_path' => $pdfPath,
            'pdf_generated_at' => now(),
            'status' => 'downloaded',
        ]);

        return response()->json([
            'success' => true,
            'url' => Storage::url($pdfPath),
        ]);
    }

    /**
     * Get YTD data for an employee
     */
    public function ytd(int $employeeId, Request $request): JsonResponse
    {
        $payYear = $request->get('pay_year', date('Y'));

        $history = PayslipYtdHistory::where('employee_id', $employeeId)
            ->where('pay_year', $payYear)
            ->orderBy('pay_month')
            ->get();

        return response()->json([
            'success' => true,
            'data' => $history,
        ]);
    }
}
