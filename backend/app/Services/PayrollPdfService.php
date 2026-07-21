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
            'department'            => $user->employeeWorkInfo?->department?->name ?? $user->employeeWorkInfo?->department_name ?? null,
            'subDepartment'         => null,
            'dateOfJoining'         => $user->employeeWorkInfo?->date_of_joining?->format('d-M-Y') ?? null,
            'paymentMode'           => 'Bank Transfer',
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
            'netPayWords'           => $this->numberToWords($item->net_pay ?? 0),
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

    /**
     * Render an arbitrary Blade view to a Dompdf instance using the same
     * options as the payslip generator (no remote resources, DejaVu Sans).
     *
     * Used by the statutory filing generators (Form 12BA, Form 16 Part B,
     * Bonus Form C) that need to emit a human-readable PDF without pulling
     * in a separate PDF library.
     */
    public function renderPdf(string $view, array $data, string $paper = 'A4', string $orientation = 'portrait'): Dompdf
    {
        $options = new Options();
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', false);
        $options->set('defaultFont', 'DejaVu Sans');

        $pdf = new Dompdf($options);
        $html = view($view, $data)->render();
        $pdf->loadHtml($html);
        $pdf->setPaper($paper, $orientation);
        $pdf->render();

        return $pdf;
    }

    /**
     * Render a Blade view to a PDF and persist it to the local disk.
     * Returns the storage path; callers set `file_path`/`original_filename`
     * on the corresponding PayrollFiling record.
     */
    public function renderPdfToStorage(string $view, array $data, string $path, string $paper = 'A4', string $orientation = 'portrait'): void
    {
        $pdf = $this->renderPdf($view, $data, $paper, $orientation);
        Storage::disk('local')->put($path, $pdf->output());
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

    private function numberToWords(float $number): string
    {
        $number = round($number, 2);
        $whole = (int) $number;
        $fraction = round(($number - $whole) * 100);

        if ($whole === 0 && $fraction === 0) {
            return 'Zero Rupees Only';
        }

        $ones = [
            '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
            'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
            'Seventeen', 'Eighteen', 'Nineteen',
        ];
        $tens = [
            '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
        ];

        $convert = function ($num) use ($ones, $tens, &$convert) {
            if ($num === 0) return '';
            if ($num < 20) return $ones[$num];
            if ($num < 100) return $tens[(int)($num / 10)] . ($num % 10 ? ' ' . $ones[$num % 10] : '');
            if ($num < 1000) return $ones[(int)($num / 100)] . ' Hundred' . ($num % 100 ? ' and ' . $convert($num % 100) : '');
            if ($num < 100000) return $convert((int)($num / 1000)) . ' Thousand' . ($num % 1000 ? ' ' . $convert($num % 1000) : '');
            if ($num < 10000000) return $convert((int)($num / 100000)) . ' Lakh' . ($num % 100000 ? ' ' . $convert($num % 100000) : '');
            return $convert((int)($num / 10000000)) . ' Crore' . ($num % 10000000 ? ' ' . $convert($num % 10000000) : '');
        };

        $words = $convert($whole) . ' Rupees';
        if ($fraction > 0) {
            $words .= ' and ' . $convert($fraction) . ' Paise';
        }
        $words .= ' Only';

        return $words;
    }
}
