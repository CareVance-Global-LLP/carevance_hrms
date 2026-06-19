<?php

namespace App\Services;

use App\Models\PayrollItem;
use App\Models\User;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\Storage;

class PayrollPdfService
{
    private const EARNINGS_FIELDS = [
        'basic'              => 'Basic Salary',
        'hra'                => 'House Rent Allowance',
        'conveyance'         => 'Conveyance Allowance',
        'special_allowance'  => 'Special Allowance',
        'medical'            => 'Medical Allowance',
        'da'                 => 'Dearness Allowance',
        'cca'                => 'City Compensatory Allowance',
        'education'          => 'Education Allowance',
        'internet'           => 'Internet Allowance',
        'meal'               => 'Meal Allowance',
        'transport'          => 'Transport Allowance',
        'uniform'            => 'Uniform Allowance',
        'fuel_maintenance'   => 'Fuel & Maintenance',
        'variable_pay'       => 'Variable Pay',
        'performance_bonus'  => 'Performance Bonus',
        'retention_bonus'    => 'Retention Bonus',
        'arrears'            => 'Arrears',
        'leave_encashment'   => 'Leave Encashment',
        'notice_pay_addition'=> 'Notice Pay Addition',
        'custom_earnings'    => 'Custom Earnings',
        'shift_differential' => 'Shift Differential',
        'overtime_pay'       => 'Overtime Pay',
    ];

    private const DEDUCTION_FIELDS = [
        'pf_employee'     => 'Provident Fund',
        'esi_employee'    => 'Employee State Insurance',
        'pt'              => 'Professional Tax',
        'tds'             => 'Income Tax (TDS)',
        'nps_employee'    => 'NPS (Employee)',
        'vpf_employee'    => 'Voluntary PF',
        'lwf'             => 'Labour Welfare Fund',
        'medical_insurance'=> 'Medical Insurance',
        'life_insurance'  => 'Life Insurance',
        'lOP_deduction'   => 'Loss of Pay',
        'custom_deductions'=> 'Custom Deductions',
        'notice_pay_recovery'=> 'Notice Pay Recovery',
    ];

    public function generatePayslip(PayrollItem $item): Dompdf
    {
        $user = $item->user()->with([
            'employeeProfile',
            'employeeBankAccounts',
            'organization',
            'employeeWorkInfo',
            'payrollProfile',
        ])->first();

        $org = $user->organization;

        // Logo as base64
        $logoBase64 = $this->loadLogoBase64($org);

        // Company address block
        $addressParts = array_filter([
            $org->address_line,
            trim(($org->city ?? '') . ', ' . ($org->state ?? '') . ' ' . ($org->postal_code ?? '')),
            $org->country,
        ]);
        $companyAddress = implode('<br>', $addressParts);

        // Build non-zero earnings/deductions arrays
        $earningsComponents = $this->buildComponents($item, self::EARNINGS_FIELDS);
        $deductionsComponents = $this->buildComponents($item, self::DEDUCTION_FIELDS);

        $options = new Options();
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', false);
        $options->set('defaultFont', 'DejaVu Sans');

        $pdf = new Dompdf($options);

        $html = view('pdf.payslip', [
            'employerName'          => $org->name ?? 'Organization',
            'companyAddress'        => $companyAddress,
            'logoBase64'            => $logoBase64,
            'monthYear'             => $item->payrollRun?->month_year ?? now()->format('Y-m'),
            'employeeName'          => $user->name,
            'employeeCode'          => $user->employeeWorkInfo?->employee_code,
            'designation'           => $user->employeeWorkInfo?->designation,
            'panNumber'             => $user->employeeProfile?->pan_number,
            'uanNumber'             => $user->payrollProfile?->uan ?? $user->employeeProfile?->uan_number,
            'pfAccountNumber'       => $user->payrollProfile?->pf_account_number,
            'bankAccount'           => $user->employeeBankAccounts->first()?->account_number,
            'bankIfsc'              => $user->employeeBankAccounts->first()?->ifsc_code,
            'workingDays'           => $item->total_working_days ?? 0,
            'paidDays'              => $item->days_present ?? 0,
            'lopDays'               => (float) ($item->lOP_days ?? 0),
            'basic'                 => (float) ($item->basic ?? 0),
            'grossSalary'           => (float) ($item->gross_salary ?? 0),
            'totalDeductions'       => (float) ($item->total_deductions ?? 0),
            'netPay'                => (float) ($item->net_pay ?? 0),
            'earningsComponents'    => $earningsComponents,
            'deductionsComponents'  => $deductionsComponents,
            'generatedAt'           => now()->format('d M Y, h:i A'),
        ])->render();

        $pdf->loadHtml($html);
        $pdf->setPaper('A4', 'portrait');
        $pdf->render();

        return $pdf;
    }

    public function generatePayslipBase64(PayrollItem $item): string
    {
        $pdf = $this->generatePayslip($item);
        return base64_encode($pdf->output());
    }

    private function loadLogoBase64($org): ?string
    {
        $logoUrl = $org->settings['branding']['logo_url'] ?? null;
        if (!$logoUrl) {
            return null;
        }

        // Convert /api/media/public/... to storage path
        $relativePath = preg_replace('#^/api/media/public/#', '', $logoUrl);

        if (!$relativePath || !Storage::disk('public')->exists($relativePath)) {
            return null;
        }

        $mimeType = Storage::disk('public')->mimeType($relativePath);
        $contents = Storage::disk('public')->get($relativePath);

        return 'data:' . $mimeType . ';base64,' . base64_encode($contents);
    }

    private function buildComponents(PayrollItem $item, array $fieldMap): array
    {
        $components = [];
        foreach ($fieldMap as $field => $label) {
            $amount = (float) ($item->{$field} ?? 0);
            if ($amount > 0) {
                $components[] = [
                    'label'  => $label,
                    'amount' => $amount,
                ];
            }
        }
        return $components;
    }
}
