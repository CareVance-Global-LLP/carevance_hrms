<?php

namespace App\Services;

use App\Models\PayrollItem;
use App\Models\User;
use Dompdf\Dompdf;
use Dompdf\Options;

/**
 * Service for generating payroll PDFs (payslips, reports).
 */
class PayrollPdfService
{
    /**
     * Generate a payslip PDF for a given PayrollItem.
     */
    public function generatePayslip(PayrollItem $item): Dompdf
    {
        $user = $item->user()->with(['employeeProfile', 'employeeBankAccounts', 'organization'])->first();

        $options = new Options();
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', false);
        $options->set('defaultFont', 'DejaVu Sans');

        $pdf = new Dompdf($options);

        $html = view('pdf.payslip', [
            'employerName' => $user->organization?->name ?? 'Organization',
            'monthYear' => $item->payrollRun?->month_year ?? now()->format('Y-m'),
            'employeeName' => $user->name,
            'employeeCode' => $user->employeeWorkInfo?->employee_code,
            'designation' => $user->employeeWorkInfo?->designation,
            'panNumber' => $user->employeeProfile?->pan_number,
            'uanNumber' => $user->employeeProfile?->uan_number,
            'bankAccount' => $user->employeeBankAccounts->first()?->account_number,
            'workingDays' => $item->total_working_days ?? 0,
            'daysPresent' => $item->days_present ?? 0,
            'daysAbsent' => $item->days_absent ?? 0,
            'basic' => (float) ($item->basic ?? 0),
            'hra' => (float) ($item->hra ?? 0),
            'conveyance' => (float) ($item->conveyance ?? 0),
            'specialAllowance' => (float) ($item->special_allowance ?? 0),
            'overtimePay' => (float) ($item->overtime_pay ?? 0),
            'grossSalary' => (float) ($item->gross_salary ?? 0),
            'pfEmployee' => (float) ($item->pf_employee ?? 0),
            'esiEmployee' => (float) ($item->esi_employee ?? 0),
            'pt' => (float) ($item->pt ?? 0),
            'tds' => (float) ($item->tds ?? 0),
            'lopDeduction' => (float) ($item->lOP_deduction ?? 0),
            'totalDeductions' => (float) ($item->total_deductions ?? 0),
            'netPay' => (float) ($item->net_pay ?? 0),
            'pfEmployer' => (float) ($item->pf_employer ?? 0),
            'esiEmployer' => (float) ($item->esi_employer ?? 0),
            'gratuity' => (float) ($item->gratuity ?? 0),
            'generatedAt' => now()->format('d M Y, h:i A'),
        ])->render();

        $pdf->loadHtml($html);
        $pdf->setPaper('A4', 'portrait');
        $pdf->render();

        return $pdf;
    }

    /**
     * Generate payslip PDF and return as base64.
     */
    public function generatePayslipBase64(PayrollItem $item): string
    {
        $pdf = $this->generatePayslip($item);
        return base64_encode($pdf->output());
    }
}
