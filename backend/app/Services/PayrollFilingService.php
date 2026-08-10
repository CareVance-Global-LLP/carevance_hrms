<?php

namespace App\Services;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayGroup;
use App\Models\PayrollFiling;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\PerquisiteRecord;
use App\Models\User;
use App\Models\FullAndFinalSettlement;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Style\Alignment;
use PhpOffice\PhpSpreadsheet\Style\Border;
use PhpOffice\PhpSpreadsheet\Style\Fill;
use PhpOffice\PhpSpreadsheet\Style\Font;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\Storage;

class PayrollFilingService
{
    protected PayrollCalculatorService $calculator;

    public function __construct(PayrollCalculatorService $calculator)
    {
        $this->calculator = $calculator;
    }

    /**
     * An organization's statutory identifier, wherever setup happened to store it.
     *
     * The payroll setup wizard writes these under
     * `settings.payroll.statutory.{tan,pan,establishmentCode,esiCode,…}`, while
     * this service was reading top-level `settings.tan_number` /
     * `settings.pan_number`. The two never met: an admin could complete the
     * whole Statutory Details step and every filing would still report
     * "not configured". Both shapes are accepted so neither path is broken.
     *
     * @param  string  $wizardKey  key under settings.payroll.statutory
     * @param  array<int, string>  $legacyKeys  top-level fallbacks
     */
    /** A well-formed PAN: five letters, four digits, one letter. */
    public const PAN_PATTERN = '/^[A-Z]{5}[0-9]{4}[A-Z]$/';

    /** A UAN is exactly twelve digits. */
    public const UAN_PATTERN = '/^\d{12}$/';

    /**
     * Days that count toward PF/ESI contribution for one payroll item.
     *
     * payroll_items carries two parallel sets of attendance-day columns and
     * only one of them is written: on the live database `present_days` and
     * `paid_leave_days` are zero in every row, while `days_present` holds real
     * values. The ECR and ESI generators read the empty pair, so contributory
     * days computed as 0 and non-contributory days were reported as the entire
     * month for every employee — a filing that is wrong for everyone.
     *
     * Reads the populated columns first and falls back to the legacy pair, so
     * this is correct on both old and new rows. The duplicate columns should be
     * converged and one set dropped; until then this is the single place that
     * decides which to trust.
     */
    /**
     * Basic actually earned this month — full-month basic less the loss-of-pay
     * share, on the divisor the item was computed with.
     *
     * The ECR declared EPF wages must agree with the contribution that was
     * actually deducted. Declaring the full-month basic while the engine
     * computed PF on the LOP-reduced basic makes the employee contribution
     * fall short of 12% of the declared wage, which EPFO's edit check rejects
     * outright — and where it is accepted it reads as an under-remittance,
     * with s.7Q interest and s.14B damages on the difference.
     */
    private static function payableBasic(object $item): float
    {
        $basic = (float) ($item->basic ?? 0);
        $lopDays = (float) ($item->lOP_days ?? 0);

        if ($basic <= 0 || $lopDays <= 0) {
            return max(0.0, $basic);
        }

        $divisor = app(\App\Services\Payroll\PayrollDayBasisResolver::class)->forStoredItem($item);

        if ($divisor <= 0) {
            return $basic;
        }

        return max(0.0, $basic * max(0.0, $divisor - $lopDays) / $divisor);
    }

    private static function contributoryDays(object $item): float
    {
        $present = (float) ($item->days_present ?? 0) + (float) ($item->days_leave ?? 0);

        if ($present > 0) {
            return $present;
        }

        return (float) ($item->present_days ?? 0) + (float) ($item->paid_leave_days ?? 0);
    }

    private function orgStatutoryId(?Organization $org, string $wizardKey, array $legacyKeys = []): string
    {
        $settings = $org?->settings ?? [];

        $fromWizard = $settings['payroll']['statutory'][$wizardKey] ?? null;
        if (filled($fromWizard)) {
            return trim((string) $fromWizard);
        }

        foreach ($legacyKeys as $key) {
            if (filled($settings[$key] ?? null)) {
                return trim((string) $settings[$key]);
            }
        }

        return '';
    }

    /**
     * Generate the PF ECR in EPFO's actual Electronic Challan cum Return (ECR)
     * format. EPFO revamped ECR is a `||`-delimited, 11-column text file:
     *
     *   1. UAN
     *   2. NAME
     *   3. GROSS_WAGES
     *   4. EPF_WAGES
     *   5. EPS_WAGES
     *   6. EDLI_WAGES
     *   7. EPF_EE (employee contribution)
     *   8. EPS_ER (employer EPS)
     *   9. EPF_ER (employer EPF, i.e. diff EPF ER)
     *  10. NCP_DAYS (non-contributory paid days)
     *  11. REFUND
     *
     * This is the exact structure the unified EPFO employer portal ECR Upload
     * accepts. PF wages are capped at ₹15,000 per the Act ceiling.
     */
    public function generatePfEcr(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();
        $org = Organization::find($orgId);
        $lines = [];
        $totalWages = 0;
        $totalEpfWages = 0;
        $totalEpf = 0;

        $pfCap = 15000;

        foreach ($items as $item) {
            $profile = $item->user->employeeProfile;   // may be null
            $workInfo = $item->user->employeeWorkInfo; // may be null

            // PF wages are the basic actually EARNED, capped at the statutory
            // ceiling — the same base the contribution below was computed on.
            $payableBasic = self::payableBasic($item);
            $epfWages = min($payableBasic, $pfCap);
            $grossWages = (float) $item->gross_salary;
            $edliWages = min($payableBasic, $pfCap);

            // EPF EE contribution (capped-wage based).
            $epfEe = (float) $item->pf_employee;
            // Employer EPS (8.33% of EPFO wages, capped) and employer EPF (3.67%).
            $epsEr = (float) $item->eps;
            $epfEr = (float) $item->pf_employer;

            $totalWages += $grossWages;
            $totalEpfWages += $epfWages;
            $totalEpf += $epfEe;

            /*
             * NCP = non-contributory period days, the days of the month no
             * wages were payable for. It must sit on the same basis as the
             * wages declared beside it: EPFO reads the two together, and a
             * gross reduced on a calendar divisor next to an NCP count derived
             * from working days does not reconcile.
             *
             * lOP_days is that figure directly. The attendance subtraction is
             * kept only for rows written before LOP was recorded.
             */
            $ncpDays = (float) ($item->lOP_days ?? 0);
            if ($ncpDays <= 0) {
                $workingDays = (float) ($item->total_working_days ?? 0);
                $contributoryDays = self::contributoryDays($item);
                $ncpDays = $workingDays > 0 ? max(0, round($workingDays - $contributoryDays, 2)) : 0;
            }
            $ncpDays = round($ncpDays, 2);

            $lines[] = implode('||', [
                // Column 1 of the ECR. EPFO rejects the upload if it is blank.
                $item->user?->statutoryId('uan') ?? '',
                $item->user->name ?? '',
                number_format($grossWages, 2, '.', ''),
                number_format($epfWages, 2, '.', ''),
                number_format($epfWages, 2, '.', ''),
                number_format($edliWages, 2, '.', ''),
                number_format($epfEe, 2, '.', ''),
                number_format($epsEr, 2, '.', ''),
                number_format($epfEr, 2, '.', ''),
                number_format($ncpDays, 2, '.', ''),
                '0.00',
            ]);
        }

        $content = implode("\n", $lines);
        $filename = sprintf('pf_ecr_%s_%s.txt', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/pf/{$filename}";
        Storage::disk('local')->put($path, $content);

        // UAN is column 1 and mandatory: EPFO rejects the upload outright if any
        // row is missing one. Reporting the file as ready regardless meant the
        // rejection was only discovered on the portal, after the due date.
        $validationErrors = [];
        $withoutUan = $items->filter(fn ($item) => blank($item->user?->statutoryId('uan')))->count();
        if ($withoutUan > 0) {
            $validationErrors[] = "{$withoutUan} employee(s) have no UAN on record — "
                . 'EPFO rejects an ECR containing blank UANs.';
        }

        // Presence was checked but never shape, so a UAN of "UAN0000000004" —
        // which is what the seeded data actually holds — passed as valid and the
        // ECR reported itself ready. EPFO rejects on format just as hard as on
        // absence, and the rejection only surfaces on the portal after the due
        // date. Malformed is as fatal as missing, so it is treated the same.
        $malformedUan = $items->filter(function ($item) {
            $uan = $item->user?->statutoryId('uan');

            return filled($uan) && ! preg_match(self::UAN_PATTERN, preg_replace('/\D/', '', (string) $uan));
        })->count();
        if ($malformedUan > 0) {
            $validationErrors[] = "{$malformedUan} employee(s) have a UAN that is not 12 digits — "
                . 'EPFO will reject the upload.';
        }
        $filingReady = empty($validationErrors);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'pf_ecr',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => $filingReady ? 'ready' : 'reference_only',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'format' => 'EPFO ECR 11-column ||-delimited',
                'filing_ready' => $filingReady,
                'validation_errors' => $validationErrors,
                'total_employees' => $items->count(),
                'total_gross_wages' => $totalWages,
                'total_epf_wages' => $totalEpfWages,
                'total_epf_ee' => $totalEpf,
                'pf_cap' => $pfCap,
                'month_year' => $run->month_year,
            ],
        ]);
    }

    /**
     * Generate the ESIC contribution export as an Excel (.xls) file
     * matching the ESIC portal's upload template format.
     *
     * Columns: IP Number, IP Name, No of Days, Total Monthly Wages,
     * Reason Code, Last Working Day. Employer Code is entered
     * separately on the ESIC portal — it is NOT included in the file.
     */
    public function generateEsiChallan(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->where('esi_employee', '>', 0)->get();
        $org = Organization::find($orgId);

        $esiCode = $this->orgStatutoryId($org, 'esiCode', ['esi_code']);
        $totalGross = 0;
        $totalEe = 0;
        $totalEr = 0;

        $spreadsheet = new Spreadsheet();
        $sheet = $spreadsheet->getActiveSheet();

        // Header row
        $sheet->setCellValue('A1', 'IP Number');
        $sheet->setCellValue('B1', 'IP Name');
        $sheet->setCellValue('C1', 'No of Days');
        $sheet->setCellValue('D1', 'Total Monthly Wages');
        $sheet->setCellValue('E1', 'Reason Code');
        $sheet->setCellValue('F1', 'Last Working Day');

        // Style header row
        $headerFont = new Font();
        $headerFont->setBold(true);
        $sheet->getStyle('A1:F1')->getFont()->setBold(true);
        $sheet->getStyle('A1:F1')->getFill()->setFillType(Fill::FILL_SOLID)->getStartColor()->setRGB('D9E1F2');
        $sheet->getStyle('A1:F1')->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);

        $row = 2;
        foreach ($items as $item) {
            $profile = $item->user->employeeProfile;
            $workInfo = $item->user->employeeWorkInfo;
            $ipNumber = $profile->esi_ip_number ?? '';
            $gross = (float) $item->gross_salary;
            $ee = (float) $item->esi_employee;
            $er = (float) $item->esi_employer;
            $days = self::contributoryDays($item);

            $totalGross += $gross;
            $totalEe += $ee;
            $totalEr += $er;

            // Reason Code: 0 for normal contribution, 1 for exemption, etc.
            // Default to 0 (normal) for all ESIC-eligible employees.
            $reasonCode = '0';

            // Last Working Day: use the run month's last day as a reasonable default
            $monthYear = $run->month_year;
            [$year, $month] = explode('-', $monthYear);
            $lastDay = date('t', mktime(0, 0, 0, (int) $month, 1, (int) $year));
            $lastWorkingDay = sprintf('%02d/%02d/%s', $lastDay, (int) $month, $year);

            $sheet->setCellValue('A' . $row, $ipNumber);
            $sheet->setCellValue('B' . $row, $item->user->name);
            $sheet->setCellValue('C' . $row, (int) $days);
            $sheet->setCellValue('D' . $row, number_format($gross, 2, '.', ''));
            $sheet->setCellValue('E' . $row, $reasonCode);
            $sheet->setCellValue('F' . $row, $lastWorkingDay);

            $sheet->getStyle('A' . $row . ':F' . $row)->getBorders()->getAllBorders()->setBorderStyle(Border::BORDER_THIN);
            $sheet->getStyle('D' . $row)->getNumberFormat()->setFormatCode('#,##0.00');

            $row++;
        }

        // Auto-size columns
        foreach (range('A', 'F') as $col) {
            $sheet->getColumnDimension($col)->setAutoSize(true);
        }

        $filename = sprintf('esi_contribution_%s_%s.xls', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/esi/{$filename}";

        $writer = IOFactory::createWriter($spreadsheet, 'Xls');
        $tempPath = sys_get_temp_dir() . '/' . uniqid('esi_') . '.xls';
        $writer->save($tempPath);
        Storage::disk('local')->put($path, file_get_contents($tempPath));
        @unlink($tempPath);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'esi_challan',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'format' => 'ESIC portal upload template (.xls)',
                'filing_ready' => true,
                'columns' => ['IP Number', 'IP Name', 'No of Days', 'Total Monthly Wages', 'Reason Code', 'Last Working Day'],
                'employer_code_note' => 'Employer Code is entered separately on the ESIC portal — it is not included in this file.',
                'total_employees' => $items->count(),
                'total_gross' => $totalGross,
                'total_ee_esi' => $totalEe,
                'total_er_esi' => $totalEr,
            ],
        ]);
    }

    /**
     * Generate Form 24Q in NSDL's File Validation Utility (FVU) format.
     *
     * The FVU format is the actual upload format accepted by the TDS-CPC
     * portal. It is a `^`-delimited ASCII text file with `\r\n` line
     * endings and the following record types:
     *
     *   FH  — File Header (1 record)
     *   BH  — Batch Header (1 record per quarter)
     *   CD  — Challan Detail (1 record per challan)
     *   DD  — Deductee Detail (1 record per deductee)
     *   SD  — Summary Detail (1 record per quarter)
     *
     * Dates are in ddmmyyyy format. Amounts are 2 decimal places (4 for
     * TDS rate). PAN is validated for format or marked as PANAPPLIED /
     * PANINVALID / PANNOTAVBL.
     *
     * This performs structural validation only — it does not compute
     * cryptographic checksums or replace NSDL's RPU/FVU software.
     */
    public function generateForm24Q(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();
        $org = Organization::find($orgId);
        $quarter = $this->getQuarterFromMonth(explode('-', $run->month_year)[1] ?? date('m'));
        $finYear = $this->getFinancialYear($run->month_year);

        $pan = $this->orgStatutoryId($org, 'pan', ['pan_number']);
        $tan = $this->orgStatutoryId($org, 'tan', ['tan_number']);

        // Validate PAN format (10-char alphanumeric starting with letters)
        $panStatus = preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/', $pan) ? $pan : 'PANINVALID';

        $lines = [];

        // --- File Header (FH) ---
        $fh = [
            'FH',
            '1',                          // Version
            $panStatus,                   // PAN
            str_pad($tan, 10, ' ', STR_PAD_RIGHT),  // TAN (10 chars)
            'TDS',                        // Return type
            $finYear,                     // Financial year
            $quarter,                     // Quarter
            date('dmY'),                  // Filing date (ddmmyyyy)
            'N',                          // Original/Revised (N=Original)
            '1',                          // Return filing category (1=Regular)
            str_repeat(' ', 10),          // Padding
        ];
        $lines[] = implode('^', $fh);

        // --- Batch Header (BH) ---
        $bh = [
            'BH',
            $panStatus,
            str_pad($tan, 10, ' ', STR_PAD_RIGHT),
            'TDS',
            $finYear,
            $quarter,
            '001',                        // Batch number
            date('dmY'),                  // Batch date
            str_repeat(' ', 50),          // Padding
        ];
        $lines[] = implode('^', $bh);

        // --- Challan Detail (CD) ---
        $totalTds = (float) $items->sum('tds');
        $cd = [
            'CD',
            '001',                        // Challan serial number
            str_pad($tan, 10, ' ', STR_PAD_RIGHT),
            $panStatus,
            '01',                         // Major head code (01=Salaries)
            '001',                        // Minor head code
            '0001',                       // Detail head code
            'INCOME TAX',                 // Nature of payment
            date('dmY'),                  // Date of deposit
            number_format($totalTds, 2, '.', ''),  // Amount deposited
            number_format($totalTds, 2, '.', ''),  // Tax deposited
            str_repeat(' ', 50),          // Padding
        ];
        $lines[] = implode('^', $cd);

        // --- Deductee Detail (DD) ---
        $ddSerial = 1;
        foreach ($items as $item) {
            $deducteePan = $item->user?->statutoryId('pan') ?? '';
            $deducteePanStatus = preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/', $deducteePan)
                ? $deducteePan
                : (empty($deducteePan) ? 'PANNOTAVBL' : 'PANINVALID');

            $dd = [
                'DD',
                str_pad((string) $ddSerial, 5, '0', STR_PAD_LEFT),
                $deducteePanStatus,
                str_pad($item->user->name, 40, ' ', STR_PAD_RIGHT),
                '01',                         // Major head
                '001',                        // Minor head
                '0001',                       // Detail head
                number_format((float) $item->gross_salary, 2, '.', ''),  // Gross total income
                number_format((float) $item->total_deductions, 2, '.', ''),  // Total deductions
                number_format((float) $item->tds, 2, '.', ''),  // Tax deducted at source
                number_format((float) $item->tds, 4, '.', ''),  // TDS rate (4 decimal places)
                str_repeat(' ', 50),          // Padding
            ];
            $lines[] = implode('^', $dd);
            $ddSerial++;
        }

        // --- Summary Detail (SD) ---
        $sd = [
            'SD',
            $panStatus,
            str_pad($tan, 10, ' ', STR_PAD_RIGHT),
            'TDS',
            $finYear,
            $quarter,
            number_format($totalTds, 2, '.', ''),  // Total tax deducted
            number_format($items->count(), 0, '.', ''),  // Total deductees
            str_repeat(' ', 50),          // Padding
        ];
        $lines[] = implode('^', $sd);

        // --- File Trailer (FT) ---
        $ft = [
            'FT',
            '1',                          // Number of batches
            number_format($totalTds, 2, '.', ''),  // Total tax deposited
            str_repeat(' ', 50),          // Padding
        ];
        $lines[] = implode('^', $ft);

        $content = implode("\r\n", $lines) . "\r\n";
        $filename = sprintf('form_24q_Q%s_%s_%s_fvu.txt', $quarter, $org->code ?? 'org', $finYear);
        $path = "filings/{$orgId}/tds/{$filename}";
        Storage::disk('local')->put($path, $content);

        // Validate the FVU structure before marking as ready
        $validationErrors = $this->validateFvuStructure($content);

        // Structural validity is not the same as filability. The deductor's own
        // TAN and PAN are what NSDL matches the return against, and with neither
        // configured the header goes out reading literally "PANINVALID" — while
        // the filing still reported itself ready. Say so instead.
        if ($panStatus === 'PANINVALID') {
            $validationErrors[] = blank($pan)
                ? 'Organization PAN is not configured — required in the 24Q file header.'
                : "Organization PAN '{$pan}' is not a valid PAN format (AAAAA9999A).";
        }
        if (blank($tan)) {
            $validationErrors[] = 'Organization TAN is not configured — NSDL will reject a return without it.';
        }

        $deducteesWithoutPan = $items->filter(
            fn ($item) => blank($item->user?->statutoryId('pan'))
        )->count();
        if ($deducteesWithoutPan > 0) {
            $validationErrors[] = "{$deducteesWithoutPan} employee(s) have no PAN on record — "
                . 'TDS must be deducted at the higher rate under section 206AA for them.';
        }

        // Only blankness was checked, so a malformed PAN sailed through and the
        // return reported 'ready'. NSDL's FVU validates the AAAAA9999A shape, so
        // a badly-formed PAN fails the same way a missing one does — and every
        // PAN currently on the live database is malformed.
        $deducteesWithBadPan = $items->filter(function ($item) {
            $pan = $item->user?->statutoryId('pan');

            return filled($pan) && ! preg_match(self::PAN_PATTERN, strtoupper(trim((string) $pan)));
        })->count();
        if ($deducteesWithBadPan > 0) {
            $validationErrors[] = "{$deducteesWithBadPan} employee(s) have a malformed PAN — "
                . 'the NSDL FVU expects five letters, four digits and one letter.';
        }

        $complianceStatus = empty($validationErrors) ? 'ready' : 'reference_only';

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_24q',
            'period_type' => 'quarterly',
            'period_quarter' => $quarter,
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => $complianceStatus,
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'format' => 'NSDL FVU ^-delimited ASCII .txt with \\r\\n line endings',
                'filing_ready' => $complianceStatus === 'ready',
                'validation_errors' => $validationErrors,
                'financial_year' => $finYear,
                'quarter' => $quarter,
                'total_employees' => $items->count(),
                'total_tds' => $totalTds,
                'fvu_version' => '1',
            ],
        ]);
    }

    /**
     * Generate Form 16 (TDS certificate) for an employee for one financial year.
     * Aggregates all `payroll_items` for the user across the FY (Apr-Mar).
     * Renders Part A (employer/deductor details) + Part B (annualized tax computation)
     * via filings.form16_annual view and saves as PDF.
     */
    /**
     * Generate Form 16 Part B (Salary Statement) for an employee for one financial year.
     * Aggregates all `payroll_items` for the user across the FY (Apr-Mar) and renders a
     * real PDF via Dompdf.
     *
     * Note: a genuine Form 16 Part A (deductor TDS summary) can ONLY be obtained from
     * TRACES after quarterly TDS returns are filed — it carries the certificate number
     * issued by the department. This system cannot mint that number (doing so would be
     * misleading), so we honestly produce Part B only. Part A must be uploaded by an
     * admin from TRACES and merged/stored alongside this Part B before distribution.
     */
    public function generateForm16(int $employeeUserId, string $financialYear, int $orgId, int $generatorId): PayrollFiling
    {
        [$fyStart, $fyEnd] = $this->getFinancialYearRange($financialYear);

        $user = User::with('employeeProfile', 'employeeWorkInfo')
            ->where('organization_id', $orgId)
            ->findOrFail($employeeUserId);
        $org = Organization::find($orgId);

        $items = PayrollItem::where('organization_id', $orgId)
            ->where('user_id', $employeeUserId)
            ->whereBetween('month_year', [$fyStart, $fyEnd])
            ->orderBy('month_year')
            ->get();

        if ($items->isEmpty()) {
            throw new \RuntimeException("No payroll items found for user {$employeeUserId} in FY {$financialYear}");
        }

        // Aggregate annual totals
        $totals = [
            'gross' => (float) $items->sum('gross_salary'),
            'basic' => (float) $items->sum('basic'),
            'hra' => (float) $items->sum('hra'),
            'pf_employee' => (float) $items->sum('pf_employee'),
            'esi_employee' => (float) $items->sum('esi_employee'),
            'pt' => (float) $items->sum('pt'),
            'tds' => (float) $items->sum('tds'),
            'total_deductions' => (float) $items->sum('total_deductions'),
        ];

        // Use first item's tax regime as the canonical one (we assume it doesn't change mid-year)
        $firstItem = $items->first();
        $taxRegime = $firstItem->template_snapshot['tax_regime'] ?? 'new';

        // Recompute annual tax via the canonical service so the certificate matches
        // what we actually deducted, rather than echoing the sum.
        // Per-section map: collapsing every section into section_80c caps the
        // lot at 1.5L, which would understate Chapter VI-A relief on the
        // Form 16 Part B certificate itself.
        $annualExemptions = $this->calculator->getApprovedTaxDeductionMap($employeeUserId, $financialYear);
        $annualizedTds = $this->calculator->calculateMonthlyTDS(
            annualGross: $totals['gross'],
            taxRegime: $taxRegime,
            exemptions: $annualExemptions
        );

        // No fabricated certificate number: a real one only exists after TRACES
        // issues Part A post quarterly TDS filing. We render Part B only.
        $filename = sprintf('form_16_part_b_%s_%s.pdf', $user?->statutoryId('pan') ?? 'NOPAN', $financialYear);
        $path = "filings/{$orgId}/form16/{$filename}";

        $this->renderAndStorePdf('filings.form16_annual', [
            'employer' => $org,
            'employee' => $user,
            'financialYear' => $financialYear,
            'totals' => $totals,
            'annualizedTds' => $annualizedTds,
            'taxRegime' => $taxRegime,
            'months' => $items,
            'pan' => $this->orgStatutoryId($org, 'pan', ['pan_number']),
            'tan' => $this->orgStatutoryId($org, 'tan', ['tan_number']),
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_16',
            'period_type' => 'annual',
            'period_year' => (int) explode('-', $financialYear)[0],
            'status' => 'generated',
            'compliance_status' => 'needs_external_input',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $generatorId,
            'meta_data' => [
                'user_id' => $employeeUserId,
                'pan' => $user?->statutoryId('pan') ?? '',
                'financial_year' => $financialYear,
                'tax_regime' => $taxRegime,
                'part' => 'B',
                'part_a_certificate_no' => null,
                'annual_gross' => $totals['gross'],
                'annual_tds' => $totals['tds'],
                'recomputed_annual_tds' => $annualizedTds['annual_tax'] ?? null,
                'months_included' => $items->count(),
            ],
        ]);
    }

    public function generateForm12BA(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();
        $org = Organization::find($orgId);

        $entries = [];
        foreach ($items as $item) {
            $perquisites = PerquisiteRecord::where('user_id', $item->user_id)
                ->where('is_active', true)
                ->sum('monthly_value');

            $entries[] = [
                'employee' => $item->user->name,
                'pan' => $item->user?->statutoryId('pan') ?? '',
                'gross_salary' => (float) $item->gross_salary,
                'perquisites' => (float) $perquisites,
                'profits_in_lieu' => 0,
                'total_income' => (float) $item->gross_salary + (float) $perquisites,
                'tds' => (float) $item->tds,
            ];
        }

        $totals = [
            'gross' => (float) collect($entries)->sum('gross_salary'),
            'perquisites' => (float) collect($entries)->sum('perquisites'),
            'profits_in_lieu' => (float) collect($entries)->sum('profits_in_lieu'),
            'total_income' => (float) collect($entries)->sum('total_income'),
            'tds' => (float) collect($entries)->sum('tds'),
        ];

        $filename = sprintf('form_12ba_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/form12ba/{$filename}";

        $this->renderAndStorePdf('filings.form12ba', [
            'run' => $run,
            'employer' => $org,
            'entries' => $entries,
            'totals' => $totals,
            'pan' => $this->orgStatutoryId($org, 'pan', ['pan_number']),
            'tan' => $this->orgStatutoryId($org, 'tan', ['tan_number']),
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_12ba',
            'period_type' => 'annual',
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => ['entries' => $entries, 'totals' => $totals],
        ]);
    }

    /**
     * State portal map for the semi-auto "Upload to portal" flow. Each entry
     * carries the human-facing portal name, the official URL a human opens to
     * log in + file, and (where a fixed statutory form number applies) the form
     * number. These are public government URLs — we never POST to them; the
     * human always performs login + payment. States without a dedicated single
     * portal (or where filing is done via a unified portal) are represented
     * honestly.
     */
    public const STATE_PORTAL = [
        'maharashtra' => ['portal' => 'Maharashtra Labour Department — LWF', 'url' => 'https://mahakamgar.maharashtra.gov.in', 'form' => 'Form III / V'],
        'gujarat' => ['portal' => 'Gujarat Labour Welfare Board', 'url' => 'https://gujaratindustries.gujarat.gov.in', 'form' => 'LWF Return'],
        'karnataka' => ['portal' => 'Karnataka Labour Department', 'url' => 'https://labouronline.karnataka.gov.in', 'form' => 'LWF Return'],
        'andhra_pradesh' => ['portal' => 'Andhra Pradesh Labour Department', 'url' => 'https://www.ap.gov.in', 'form' => 'LWF Return'],
        'telangana' => ['portal' => 'Telangana Labour Department', 'url' => 'https://labour.telangana.gov.in', 'form' => 'LWF Return'],
        'tamil_nadu' => ['portal' => 'Tamil Nadu Labour Welfare Board', 'url' => 'https://labour.tn.gov.in', 'form' => 'LWF Return'],
        'west_bengal' => ['portal' => 'West Bengal Labour Department', 'url' => 'https://labour.wb.gov.in', 'form' => 'LWF Return'],
        'kerala' => ['portal' => 'Kerala Labour Department', 'url' => 'https://labour.kerala.gov.in', 'form' => 'LWF Return'],
        'delhi' => ['portal' => 'Delhi Labour Department', 'url' => 'https://labour.delhi.gov.in', 'form' => 'LWF Return'],
        'madhya_pradesh' => ['portal' => 'Madhya Pradesh Labour Department', 'url' => 'https://labour.mp.gov.in', 'form' => 'LWF Return'],
        'goa' => ['portal' => 'Goa Labour Department', 'url' => 'https://labour.goa.gov.in', 'form' => 'LWF Return'],
        'odisha' => ['portal' => 'Odisha Labour Department', 'url' => 'https://labour.odisha.gov.in', 'form' => 'LWF Return'],
        'haryana' => ['portal' => 'Haryana Labour Department', 'url' => 'https://labour.haryana.gov.in', 'form' => 'LWF Return'],
        'punjab' => ['portal' => 'Punjab Labour Department', 'url' => 'https://labour.punjab.gov.in', 'form' => 'LWF Return'],
        'chhattisgarh' => ['portal' => 'Chhattisgarh Labour Department', 'url' => 'https://labour.cg.gov.in', 'form' => 'LWF Return'],
        // Professional Tax is collected by each state's commercial-tax
        // department; only a subset of states levy PT. We surface the portal
        // for the states that actually have a PT Act.
        'maharashtra_pt' => ['portal' => 'Maharashtra GST/PT Department', 'url' => 'https://mahagst.gov.in', 'form' => 'PT Return'],
        'karnataka_pt' => ['portal' => 'Karnataka Commercial Taxes', 'url' => 'https://ctax.karnataka.gov.in', 'form' => 'PT Return'],
        'tamil_nadu_pt' => ['portal' => 'Tamil Nadu Commercial Taxes', 'url' => 'https://www.tn.gov.in', 'form' => 'PT Return'],
        'west_bengal_pt' => ['portal' => 'West Bengal Commercial Taxes', 'url' => 'https://wbcommerce.nic.in', 'form' => 'PT Return'],
        'gujarat_pt' => ['portal' => 'Gujarat Commercial Taxes', 'url' => 'https://gujaratindustries.gujarat.gov.in', 'form' => 'PT Return'],
        'telangana_pt' => ['portal' => 'Telangana Commercial Taxes', 'url' => 'https://www.telangana.gov.in', 'form' => 'PT Return'],
        'andhra_pradesh_pt' => ['portal' => 'Andhra Pradesh Commercial Taxes', 'url' => 'https://www.ap.gov.in', 'form' => 'PT Return'],
        'assam_pt' => ['portal' => 'Assam Commercial Taxes', 'url' => 'https://taxassam.gov.in', 'form' => 'PT Return'],
        'kerala_pt' => ['portal' => 'Kerala Commercial Taxes', 'url' => 'https://tax.lsgkerala.gov.in', 'form' => 'PT Return'],
        'odisha_pt' => ['portal' => 'Odisha Commercial Taxes', 'url' => 'https://odishatreasury.gov.in', 'form' => 'PT Return'],
        'punjab_pt' => ['portal' => 'Punjab Commercial Taxes', 'url' => 'https://epunjabtax.gov.in', 'form' => 'PT Return'],
        'jharkhand_pt' => ['portal' => 'Jharkhand Commercial Taxes', 'url' => 'https://www.jharkhand.gov.in', 'form' => 'PT Return'],
        'madhya_pradesh_pt' => ['portal' => 'Madhya Pradesh Commercial Taxes', 'url' => 'https://www.mptax.mp.gov.in', 'form' => 'PT Return'],
        'bihar_pt' => ['portal' => 'Bihar Commercial Taxes', 'url' => 'https://state.bihar.gov.in', 'form' => 'PT Return'],
        'rajasthan_pt' => ['portal' => 'Rajasthan Commercial Taxes', 'url' => 'https://tax.rajasthan.gov.in', 'form' => 'PT Return'],
    ];

    /**
     * Resolve the actual state for a filing from the pay group's filing_details.
     * Returns the state code if found, or null if the pay group has no
     * filing_details for the given filing type.
     */
    public function resolveStateForFiling(int $payGroupId, string $filingType): ?string
    {
        $payGroup = PayGroup::with('filingDetails')
            ->where('id', $payGroupId)
            ->where('organization_id', auth()->user()->organization_id)
            ->first();

        if (! $payGroup) {
            return null;
        }

        $detail = $payGroup->filingDetails
            ->first(fn ($d) => $d->filing_type === $filingType);

        return $detail?->state_code ?? null;
    }

    public function generatePtReturn(PayrollMonthlyRun $run, string $state, int $orgId, int $userId, ?int $payGroupId = null): PayrollFiling
    {
        // If a pay group is provided, resolve the actual state from its filing details.
        // This enables per-employee actual state resolution when the user has
        // configured state overrides in the pay group settings.
        $resolvedState = $payGroupId
            ? ($this->resolveStateForFiling($payGroupId, 'pt_return') ?? $state)
            : $state;

        // Filter items whose employee's template is in the resolved state.
        $userIdsInState = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('pt_state', $resolvedState)
            ->pluck('user_id');
        $items = $run->items()
            ->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')
            ->whereIn('user_id', $userIdsInState)
            ->get();
        $org = Organization::find($orgId);

        $ptPortal = self::STATE_PORTAL["{$resolvedState}_pt"] ?? null;

        $lines = [];
        $lines[] = "PROFESSIONAL TAX RETURN - {$resolvedState}";
        $lines[] = "MONTH: {$run->month_year}";
        $lines[] = str_repeat('=', 80);
        $lines[] = "EMP_CODE\tNAME\tGROSS\tPT_AMOUNT\tPAID";

        foreach ($items as $item) {
            $lines[] = sprintf(
                "%s\t%s\t%.2f\t%.2f\t%s",
                $item->user->employeeWorkInfo->employee_code ?? '',
                $item->user->name,
                $item->gross_salary,
                $item->pt,
                $item->pt > 0 ? 'Y' : 'N',
            );
        }

        $content = implode("\n", $lines);
        $filename = sprintf('pt_contribution_summary_%s_%s_%s.txt', strtolower($resolvedState), $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/pt/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'pt_return',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'reference_only',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'state' => $resolvedState,
                'pay_group_id' => $payGroupId,
                'is_reference_summary' => true,
                'filing_ready' => false,
                'guidance' => 'Contribution summary for manual entry / reference. The actual PT payment/return uses the state commercial tax dept portal, not this file.',
                'portal' => $ptPortal ? ['name' => $ptPortal['portal'], 'url' => $ptPortal['url'], 'form' => $ptPortal['form']] : null,
                'total_pt' => $items->sum('pt'),
            ],
        ]);
    }

    /**
     * Per-state LWF contribution table.
     *
     * Labour Welfare Fund is entirely a state subject — there is no universal
     * formula. Each state sets its own contribution amounts AND periodicity
     * (monthly, bi-annual, etc.), and several states have no LWF Act at all.
     * The amounts below are the employee-side contribution and must be sourced
     * from each state's Labour Welfare Fund Act; states not listed here are
     * treated as "not configured" rather than guessing a number.
     */
    public const LWF_STATE_CONFIG = [
        // States WITH a Labour Welfare Fund Act. Amounts below are the
        // employee-side contribution; several states also carry an employer
        // contribution. These must be re-verified against each state's LWF
        // Rules before being relied on for actual filing.
        'maharashtra' => ['amount' => 50,   'frequency' => 'monthly'],
        'gujarat' => ['amount' => 25,   'frequency' => 'bi_annual', 'months' => [1, 7]],
        'karnataka' => ['amount' => 20,   'frequency' => 'monthly'],
        'andhra_pradesh' => ['amount' => 20,   'frequency' => 'monthly'],
        'telangana' => ['amount' => 20,   'frequency' => 'monthly'],
        'tamil_nadu' => ['amount' => 30,   'frequency' => 'monthly'],
        'west_bengal' => ['amount' => 15,   'frequency' => 'monthly'],
        'kerala' => ['amount' => 20,   'frequency' => 'monthly'],
        'delhi' => ['amount' => 6,    'frequency' => 'monthly'],
        'madhya_pradesh' => ['amount' => 25,   'frequency' => 'monthly'],
        'goa' => ['amount' => 18,   'frequency' => 'monthly'],
        'odisha' => ['amount' => 10,   'frequency' => 'monthly'],
        'haryana' => ['amount' => 25,   'frequency' => 'monthly'],
        'punjab' => ['amount' => 20,   'frequency' => 'monthly'],
        'chhattisgarh' => ['amount' => 25,   'frequency' => 'monthly'],
        // States WITHOUT a Labour Welfare Fund Act (e.g. Uttar Pradesh,
        // Bihar, Jharkhand, Assam, Rajasthan, Uttarakhand) are intentionally
        // NOT listed here — the generator refuses to emit a number for them
        // and reports them as not applicable rather than inventing a rate.
    ];

    /**
     * Generate LWF return for a specific state.
     *
     * Labour Welfare Fund is a state subject (no universal formula), so the
     * state is a required parameter. If the state is not configured in
     * LWF_STATE_CONFIG we do NOT invent a number — we throw, and the caller
     * surfaces a clear "not configured for your state" message.
     */
    public function generateLwfReturn(PayrollMonthlyRun $run, string $state, int $orgId, int $userId, ?int $payGroupId = null): PayrollFiling
    {
        // If a pay group is provided, resolve the actual state from its filing details.
        $resolvedState = $payGroupId
            ? ($this->resolveStateForFiling($payGroupId, 'lwf_return') ?? $state)
            : $state;

        if (! isset(self::LWF_STATE_CONFIG[$resolvedState])) {
            throw new \InvalidArgumentException(
                "LWF is not configured for state '{$resolvedState}'. This state is either unsupported by the current rate table or has no LWF Act. Add the correct rates for this state before generating."
            );
        }

        $config = self::LWF_STATE_CONFIG[$resolvedState];
        $payMonth = (int) (explode('-', $run->month_year)[1] ?? date('m'));

        // Bi-annual states only contribute in their designated months; outside
        // those months there is genuinely nothing to file for LWF.
        if ($config['frequency'] === 'bi_annual' && ! in_array($payMonth, $config['months'] ?? [])) {
            throw new \InvalidArgumentException(
                "LWF for '{$resolvedState}' is payable only in month(s) ".implode(', ', $config['months'] ?? [])." of the year. No contribution is due for {$run->month_year}."
            );
        }

        $lwfAmount = (float) $config['amount'];

        $userIdsWithLwf = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('lwf_enabled', true)
            ->pluck('user_id');
        $items = $run->items()
            ->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')
            ->whereIn('user_id', $userIdsWithLwf)
            ->get();
        $org = Organization::find($orgId);

        $lines = [];
        $lines[] = "LABOUR WELFARE FUND RETURN — {$resolvedState}";
        $lines[] = "ORGANIZATION: {$org->name}";
        $lines[] = "MONTH: {$run->month_year}";
        $lines[] = "PER-EMPLOYEE CONTRIBUTION: ₹{$lwfAmount} ({$config['frequency']})";
        $lines[] = str_repeat('-', 60);
        $lines[] = "EMP_CODE\tNAME\tLWF_AMOUNT";

        foreach ($items as $item) {
            $lines[] = sprintf(
                "%s\t%s\t%.2f",
                $item->user->employeeWorkInfo->employee_code ?? '',
                $item->user->name,
                $lwfAmount
            );
        }

        $lines[] = str_repeat('-', 60);
        $lines[] = sprintf("TOTAL EMPLOYEES: %d\tTOTAL LWF: %.2f", $items->count(), $lwfAmount * $items->count());

        $content = implode("\n", $lines);
        $filename = sprintf('lwf_return_%s_%s_%s.txt', strtolower($resolvedState), $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/lwf/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'lwf_return',
            'period_type' => 'monthly',
            'period_month' => $payMonth ?: (explode('-', $run->month_year)[1] ?? date('m')),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'reference_only',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'state' => $resolvedState,
                'pay_group_id' => $payGroupId,
                'frequency' => $config['frequency'],
                'per_employee_amount' => $lwfAmount,
                'employees' => $items->count(),
                'total_lwf' => $lwfAmount * $items->count(),
                'portal' => self::STATE_PORTAL[$resolvedState] ?? null,
            ],
        ]);
    }

    /**
     * Generate Bonus Form C — Annual Return under the Payment of Bonus Act.
     *
     * Two correctness fixes vs the previous implementation:
     *  1. The applicable bonus percentage is NOT a fixed 8.33%. 8.33% is only
     *     the statutory MINIMUM; the actual rate (8.33%–20%) depends on the
     *     company's allocable surplus for the year and is a finance/HR decision.
     *     So it is a required configurable input (sourced from Payroll Settings),
     *     not a hardcoded constant.
     *  2. Bonus is computed on ANNUAL wages, not a single month's basic. We
     *     therefore aggregate payroll_items across the whole financial year for
     *     each employee (mirroring generateForm16), capped per the Act's wage
     *     ceiling, rather than using one monthly run's figure.
     */
    public function generateBonusFormC(
        PayrollMonthlyRun $run,
        int $orgId,
        int $userId,
        float $bonusPercent,
        ?string $financialYearOverride = null
    ): PayrollFiling {
        if ($bonusPercent < 8.33 || $bonusPercent > 20) {
            throw new \InvalidArgumentException('Bonus percentage must be between 8.33% and 20% per the Payment of Bonus Act.');
        }

        // Determine the financial year from the run if not explicitly supplied.
        $monthYear = $run->month_year;
        [$year, $month] = explode('-', $monthYear);
        $y = (int) $year;
        $m = (int) $month;
        if ($financialYearOverride) {
            [$fyStart, $fyEnd] = $this->getFinancialYearRange($financialYearOverride);
        } else {
            $fyStart = ($m >= 4) ? sprintf('%d-04', $y) : sprintf('%d-04', $y - 1);
            $fyEnd = ($m >= 4) ? sprintf('%d-03', $y + 1) : sprintf('%d-03', $y);
            $financialYearOverride = ($m >= 4) ? "{$y}-".($y + 1) : ($y - 1)."-{$y}";
        }

        $org = Organization::find($orgId);

        // Bonus wage ceiling per the Act (₹7,000/month statutory ceiling on
        // salary considered for bonus computation).
        $bonusWageCeiling = 7000;

        // Aggregate annual wages per employee across the FY for employees
        // whose latest-in-FY basic (or monthly avg) is at/under the Act's scope.
        $annualItems = PayrollItem::where('organization_id', $orgId)
            ->whereBetween('month_year', [$fyStart, $fyEnd])
            ->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')
            ->get();

        // Group by user; sum basic across the year, then cap per the wage ceiling.
        $byUser = $annualItems->groupBy('user_id');

        $lines = [];
        $lines[] = 'BONUS ACT - FORM C (Annual Return)';
        $lines[] = "ORGANIZATION: {$org->name}";
        $lines[] = "FINANCIAL YEAR: {$financialYearOverride}";
        $lines[] = "BONUS PERCENT APPLIED: {$bonusPercent}% (set by finance per allocable surplus)";
        $lines[] = str_repeat('=', 90);
        $lines[] = "EMP_CODE\tNAME\tDESIGNATION\tANNUAL_WAGES(CAPPED)\tBONUS_PERCENT\tBONUS_AMOUNT";

        $totalBonus = 0;
        $count = 0;

        foreach ($byUser as $userIdKey => $userItems) {
            // Scope: employees with establishment-basic <= ₹21,000 (coverage limit).
            // Use the last month's basic in the FY to decide coverage.
            $basicLatest = (float) $userItems->sortByDesc('month_year')->first()->basic;
            if ($basicLatest > 21000) {
                continue;
            }
            // Annual wages = sum of monthly basic across the FY, capped at the
            // ₹7,000/month ceiling before summation (per Act wage-ceiling rule).
            $annualCappedBasic = (float) $userItems->sum(fn ($i) => min((float) $i->basic, $bonusWageCeiling));
            $bonusAmount = $annualCappedBasic * ($bonusPercent / 100);
            $totalBonus += $bonusAmount;
            $count++;

            $first = $userItems->first();
            $lines[] = sprintf(
                "%s\t%s\t%s\t%.2f\t%.2f%%\t%.2f",
                $first->user->employeeWorkInfo->employee_code ?? '',
                $first->user->name,
                $first->user->employeeWorkInfo->designation ?? '',
                $annualCappedBasic,
                $bonusPercent,
                $bonusAmount,
            );
        }

        $lines[] = str_repeat('=', 90);
        $lines[] = sprintf("TOTAL EMPLOYEES: %d\tTOTAL BONUS PAYABLE: %.2f", $count, $totalBonus);

        $content = implode("\n", $lines);
        $filename = sprintf('bonus_form_c_%s_%s.txt', $org->code ?? 'org', $financialYearOverride);
        $path = "filings/{$orgId}/bonus/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'bonus_form_c',
            'period_type' => 'annual',
            'period_year' => explode('-', $financialYearOverride)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'reference_only',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'financial_year' => $financialYearOverride,
                'bonus_percent' => $bonusPercent,
                'bonus_wage_ceiling' => $bonusWageCeiling,
                'employees' => $count,
                'total_bonus' => $totalBonus,
            ],
        ]);
    }

    /**
     * Get the configured bonus percentage from organization settings.
     * Returns null if not configured.
     */
    public function getConfiguredBonusPercent(int $orgId): ?float
    {
        $org = Organization::find($orgId);
        $bonusSettings = $org->settings['bonus'] ?? [];
        $percent = $bonusSettings['percentage'] ?? null;

        if ($percent === null || $percent === '') {
            return null;
        }

        return (float) $percent;
    }

    /**
     * Generate Bonus Form D — Register of Bonus Paid.
     *
     * Bonus Act uses Forms A, B, C, and D. Form D is the register
     * of bonus paid/claimable maintained by the employer. It is a
     * statutory record that must be maintained and produced on demand.
     */
    public function generateBonusFormD(
        PayrollMonthlyRun $run,
        int $orgId,
        int $userId,
        float $bonusPercent,
        ?string $financialYearOverride = null
    ): PayrollFiling {
        if ($bonusPercent < 8.33 || $bonusPercent > 20) {
            throw new \InvalidArgumentException('Bonus percentage must be between 8.33% and 20% per the Payment of Bonus Act.');
        }

        $monthYear = $run->month_year;
        [$year, $month] = explode('-', $monthYear);
        $y = (int) $year;
        $m = (int) $month;
        if ($financialYearOverride) {
            [$fyStart, $fyEnd] = $this->getFinancialYearRange($financialYearOverride);
        } else {
            $fyStart = ($m >= 4) ? sprintf('%d-04', $y) : sprintf('%d-04', $y - 1);
            $fyEnd = ($m >= 4) ? sprintf('%d-03', $y + 1) : sprintf('%d-03', $y);
            $financialYearOverride = ($m >= 4) ? "{$y}-".($y + 1) : ($y - 1)."-{$y}";
        }

        $org = Organization::find($orgId);
        $bonusWageCeiling = 7000;

        $annualItems = PayrollItem::where('organization_id', $orgId)
            ->whereBetween('month_year', [$fyStart, $fyEnd])
            ->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')
            ->get();

        $byUser = $annualItems->groupBy('user_id');

        $lines = [];
        $lines[] = 'BONUS ACT - FORM D (Register of Bonus Paid/Claimable)';
        $lines[] = "ORGANIZATION: {$org->name}";
        $lines[] = "FINANCIAL YEAR: {$financialYearOverride}";
        $lines[] = "BONUS PERCENT APPLIED: {$bonusPercent}% (set by finance per allocable surplus)";
        $lines[] = str_repeat('=', 90);
        $lines[] = "EMP_CODE\tNAME\tDESIGNATION\tANNUAL_WAGES(CAPPED)\tBONUS_PERCENT\tBONUS_AMOUNT\tPAID(Y/N)";

        $totalBonus = 0;
        $count = 0;

        foreach ($byUser as $userIdKey => $userItems) {
            $basicLatest = (float) $userItems->sortByDesc('month_year')->first()->basic;
            if ($basicLatest > 21000) {
                continue;
            }
            $annualCappedBasic = (float) $userItems->sum(fn ($i) => min((float) $i->basic, $bonusWageCeiling));
            $bonusAmount = $annualCappedBasic * ($bonusPercent / 100);
            $totalBonus += $bonusAmount;
            $count++;

            $first = $userItems->first();
            $lines[] = sprintf(
                "%s\t%s\t%s\t%.2f\t%.2f%%\t%.2f\tY",
                $first->user->employeeWorkInfo->employee_code ?? '',
                $first->user->name,
                $first->user->employeeWorkInfo->designation ?? '',
                $annualCappedBasic,
                $bonusPercent,
                $bonusAmount,
            );
        }

        $lines[] = str_repeat('=', 90);
        $lines[] = sprintf("TOTAL EMPLOYEES: %d\tTOTAL BONUS REGISTERED: %.2f", $count, $totalBonus);

        $content = implode("\n", $lines);
        $filename = sprintf('bonus_form_d_%s_%s.txt', $org->code ?? 'org', $financialYearOverride);
        $path = "filings/{$orgId}/bonus/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'bonus_form_d',
            'period_type' => 'annual',
            'period_year' => explode('-', $financialYearOverride)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'reference_only',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'financial_year' => $financialYearOverride,
                'bonus_percent' => $bonusPercent,
                'bonus_wage_ceiling' => $bonusWageCeiling,
                'employees' => $count,
                'total_bonus' => $totalBonus,
                'form_purpose' => 'Register of bonus paid/claimable under the Payment of Bonus Act 1965',
            ],
        ]);
    }

    /**
     * Generate Bonus Form E — Labour Commissioner Summary Return.
     *
     * Form E is NOT a statutory form under the Payment of Bonus Act 1965.
     * It is a non-statutory summary return filed with the Labour Commissioner
     * (when required by state rules). This system generates it as a reference
     * summary only — the actual filing requirements vary by state jurisdiction.
     */
    public function generateBonusFormE(
        PayrollMonthlyRun $run,
        int $orgId,
        int $userId,
        float $bonusPercent,
        ?string $financialYearOverride = null
    ): PayrollFiling {
        if ($bonusPercent < 8.33 || $bonusPercent > 20) {
            throw new \InvalidArgumentException('Bonus percentage must be between 8.33% and 20% per the Payment of Bonus Act.');
        }

        $monthYear = $run->month_year;
        [$year, $month] = explode('-', $monthYear);
        $y = (int) $year;
        $m = (int) $month;
        if ($financialYearOverride) {
            [$fyStart, $fyEnd] = $this->getFinancialYearRange($financialYearOverride);
        } else {
            $fyStart = ($m >= 4) ? sprintf('%d-04', $y) : sprintf('%d-04', $y - 1);
            $fyEnd = ($m >= 4) ? sprintf('%d-03', $y + 1) : sprintf('%d-03', $y);
            $financialYearOverride = ($m >= 4) ? "{$y}-".($y + 1) : ($y - 1)."-{$y}";
        }

        $org = Organization::find($orgId);
        $bonusWageCeiling = 7000;

        $annualItems = PayrollItem::where('organization_id', $orgId)
            ->whereBetween('month_year', [$fyStart, $fyEnd])
            ->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')
            ->get();

        $byUser = $annualItems->groupBy('user_id');

        $lines = [];
        $lines[] = 'BONUS ACT - FORM E (Labour Commissioner Summary Return)';
        $lines[] = "ORGANIZATION: {$org->name}";
        $lines[] = "FINANCIAL YEAR: {$financialYearOverride}";
        $lines[] = "BONUS PERCENT APPLIED: {$bonusPercent}% (set by finance per allocable surplus)";
        $lines[] = str_repeat('=', 90);
        $lines[] = "NOTE: Form E is a non-statutory summary return filed with the Labour Commissioner.";
        $lines[] = "It is NOT prescribed by the Payment of Bonus Act 1965. Filing requirements vary by state.";
        $lines[] = str_repeat('-', 90);
        $lines[] = "EMP_CODE\tNAME\tANNUAL_WAGES(CAPPED)\tBONUS_PERCENT\tBONUS_AMOUNT";

        $totalBonus = 0;
        $count = 0;

        foreach ($byUser as $userIdKey => $userItems) {
            $basicLatest = (float) $userItems->sortByDesc('month_year')->first()->basic;
            if ($basicLatest > 21000) {
                continue;
            }
            $annualCappedBasic = (float) $userItems->sum(fn ($i) => min((float) $i->basic, $bonusWageCeiling));
            $bonusAmount = $annualCappedBasic * ($bonusPercent / 100);
            $totalBonus += $bonusAmount;
            $count++;

            $first = $userItems->first();
            $lines[] = sprintf(
                "%s\t%s\t%.2f\t%.2f%%\t%.2f",
                $first->user->employeeWorkInfo->employee_code ?? '',
                $first->user->name,
                $annualCappedBasic,
                $bonusPercent,
                $bonusAmount,
            );
        }

        $lines[] = str_repeat('-', 90);
        $lines[] = sprintf("TOTAL EMPLOYEES: %d\tTOTAL BONUS: %.2f", $count, $totalBonus);

        $content = implode("\n", $lines);
        $filename = sprintf('bonus_form_e_%s_%s.txt', $org->code ?? 'org', $financialYearOverride);
        $path = "filings/{$orgId}/bonus/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'bonus_form_e',
            'period_type' => 'annual',
            'period_year' => explode('-', $financialYearOverride)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'reference_only',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'financial_year' => $financialYearOverride,
                'bonus_percent' => $bonusPercent,
                'bonus_wage_ceiling' => $bonusWageCeiling,
                'employees' => $count,
                'total_bonus' => $totalBonus,
                'form_purpose' => 'Labour Commissioner summary return (non-statutory — not prescribed by Payment of Bonus Act 1965)',
                'statutory_note' => 'Form E is not a statutory form under the Payment of Bonus Act 1965. It is a non-statutory summary for the Labour Commissioner. Actual filing requirements vary by state jurisdiction.',
            ],
        ]);
    }

    /**
     * Generate all bonus forms (C, D, and E) in one call.
     * Bonus generation is included in generateAllFilings() when bonus_percent
     * is configured in organization settings.
     */
    public function generateBonusAll(
        PayrollMonthlyRun $run,
        int $orgId,
        int $userId,
        float $bonusPercent,
        ?string $financialYearOverride = null
    ): array {
        $filings = [];
        $filings[] = $this->generateBonusFormC($run, $orgId, $userId, $bonusPercent, $financialYearOverride);
        $filings[] = $this->generateBonusFormD($run, $orgId, $userId, $bonusPercent, $financialYearOverride);
        $filings[] = $this->generateBonusFormE($run, $orgId, $userId, $bonusPercent, $financialYearOverride);

        return $filings;
    }

    public function generateForm19(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);
        $settlements = FullAndFinalSettlement::where('organization_id', $orgId)
            ->where('payroll_run_id', $run->id)
            ->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')
            ->get();

        $entries = [];
        foreach ($settlements as $settlement) {
            $entries[] = [
                'employee' => $settlement->user->name ?? '',
                'pan' => $settlement->user?->statutoryId('pan') ?? '',
                'uan' => $settlement->user?->statutoryId('uan') ?? '',
                'last_working_date' => $settlement->last_working_date ? $settlement->last_working_date->format('d/m/Y') : '',
                'net_settlement' => (float) $settlement->net_settlement_amount,
                'gratuity' => (float) $settlement->gratuity_amount,
                'exit_type' => $settlement->exit_type ?? '',
            ];
        }

        $totalSettlement = collect($entries)->sum('net_settlement');
        $totalGratuity = collect($entries)->sum('gratuity');

        $filename = sprintf('form_19_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/form19/{$filename}";

        $this->renderAndStorePdf('filings.form19', [
            'employer' => $org,
            'run' => $run,
            'entries' => $entries,
            'total_settlement' => $totalSettlement,
            'total_gratuity' => $totalGratuity,
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_19',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => $entries->count() ?? count($entries),
                'total_settlement' => $totalSettlement,
                'total_gratuity' => $totalGratuity,
            ],
        ]);
    }

    public function generateForm31(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();

        $entries = [];
        foreach ($items as $item) {
            $workInfo = $item->user->employeeWorkInfo;
            $employmentStatus = $workInfo->employment_status ?? '';
            if ($employmentStatus !== 'transferred' && $employmentStatus !== 'terminated') {
                continue;
            }
            $entries[] = [
                'employee' => $item->user->name ?? '',
                'pan' => $item->user?->statutoryId('pan') ?? '',
                'designation' => $workInfo->designation ?? '',
                'employment_status' => $employmentStatus,
                'joining_date' => $workInfo->joining_date ? $workInfo->joining_date->format('d/m/Y') : '',
                'exit_date' => $workInfo->exit_date ? $workInfo->exit_date->format('d/m/Y') : '',
                'gross_salary' => (float) $item->gross_salary,
            ];
        }

        $filename = sprintf('form_31_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/form31/{$filename}";

        $this->renderAndStorePdf('filings.form31', [
            'employer' => $org,
            'run' => $run,
            'entries' => $entries,
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_31',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => count($entries),
            ],
        ]);
    }

    public function generateForm1(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);

        $filename = sprintf('form_1_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/form1/{$filename}";

        $this->renderAndStorePdf('filings.form1', [
            'employer' => $org,
            'run' => $run,
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_1',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'organization_name' => $org->name,
            ],
        ]);
    }

    public function generateForm2(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();

        $entries = [];
        foreach ($items as $item) {
            $entries[] = [
                'employee' => $item->user->name ?? '',
                'pan' => $item->user?->statutoryId('pan') ?? '',
                'uan' => $item->user?->statutoryId('uan') ?? '',
                'esi_ip' => $item->user?->statutoryId('esi') ?? '',
                'joining_date' => $item->user->employeeWorkInfo->joining_date ? $item->user->employeeWorkInfo->joining_date->format('d/m/Y') : '',
                'designation' => $item->user->employeeWorkInfo->designation ?? '',
                'department' => $item->user->employeeWorkInfo->department ?? '',
                'gross_salary' => (float) $item->gross_salary,
            ];
        }

        $filename = sprintf('form_2_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/form2/{$filename}";

        $this->renderAndStorePdf('filings.form2', [
            'employer' => $org,
            'run' => $run,
            'entries' => $entries,
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_2',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => count($entries),
            ],
        ]);
    }

    public function generateForm6(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();

        $entries = [];
        $totalPfEmployee = 0;
        $totalPfEmployer = 0;
        $totalEsiEmployee = 0;
        $totalEsiEmployer = 0;
        $totalTds = 0;
        $totalGross = 0;

        foreach ($items as $item) {
            $entries[] = [
                'employee' => $item->user->name ?? '',
                'pan' => $item->user?->statutoryId('pan') ?? '',
                'gross_salary' => (float) $item->gross_salary,
                'pf_employee' => (float) $item->pf_employee,
                'pf_employer' => (float) $item->pf_employer,
                'esi_employee' => (float) $item->esi_employee,
                'esi_employer' => (float) $item->esi_employer,
                'tds' => (float) $item->tds,
            ];
            $totalPfEmployee += (float) $item->pf_employee;
            $totalPfEmployer += (float) $item->pf_employer;
            $totalEsiEmployee += (float) $item->esi_employee;
            $totalEsiEmployer += (float) $item->esi_employer;
            $totalTds += (float) $item->tds;
            $totalGross += (float) $item->gross_salary;
        }

        $filename = sprintf('form_6_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/form6/{$filename}";

        $this->renderAndStorePdf('filings.form6', [
            'employer' => $org,
            'run' => $run,
            'entries' => $entries,
            'totals' => [
                'gross' => $totalGross,
                'pf_employee' => $totalPfEmployee,
                'pf_employer' => $totalPfEmployer,
                'esi_employee' => $totalEsiEmployee,
                'esi_employer' => $totalEsiEmployer,
                'tds' => $totalTds,
            ],
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_6',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => count($entries),
                'total_gross' => $totalGross,
                'total_tds' => $totalTds,
            ],
        ]);
    }

    public function generateEShramRegistration(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();

        $entries = [];
        foreach ($items as $item) {
            $entries[] = [
                'employee' => $item->user->name ?? '',
                'pan' => $item->user?->statutoryId('pan') ?? '',
                'uan' => $item->user?->statutoryId('uan') ?? '',
                'joining_date' => $item->user->employeeWorkInfo->joining_date ? $item->user->employeeWorkInfo->joining_date->format('d/m/Y') : '',
                'gross_salary' => (float) $item->gross_salary,
            ];
        }

        $filename = sprintf('eshram_registration_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/eshram/{$filename}";

        $this->renderAndStorePdf('filings.eshram_registration', [
            'employer' => $org,
            'run' => $run,
            'entries' => $entries,
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'eshram_registration',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => count($entries),
            ],
        ]);
    }

    public function generateUanActivation(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();

        $entries = [];
        foreach ($items as $item) {
            $pan = $item->user?->statutoryId('pan') ?? '';
            $uan = $item->user?->statutoryId('uan') ?? '';
            $entries[] = [
                'employee' => $item->user->name ?? '',
                'pan' => $pan,
                'uan' => $uan,
                'uan_status' => !empty($uan) ? 'activated' : 'pending',
                'joining_date' => $item->user->employeeWorkInfo->joining_date ? $item->user->employeeWorkInfo->joining_date->format('d/m/Y') : '',
            ];
        }

        $filename = sprintf('uan_activation_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/uan/{$filename}";

        $this->renderAndStorePdf('filings.uan_activation', [
            'employer' => $org,
            'run' => $run,
            'entries' => $entries,
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'uan_activation',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => count($entries),
                'activated' => collect($entries)->filter(fn ($e) => $e['uan_status'] === 'activated')->count(),
                'pending' => collect($entries)->filter(fn ($e) => $e['uan_status'] === 'pending')->count(),
            ],
        ]);
    }

    public function generateSeRegistration(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);

        $filename = sprintf('se_registration_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/se_registration/{$filename}";

        $this->renderAndStorePdf('filings.se_registration', [
            'employer' => $org,
            'run' => $run,
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'se_registration',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'organization_name' => $org->name,
            ],
        ]);
    }

    public function generateShramCardRegistration(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();

        $entries = [];
        foreach ($items as $item) {
            $entries[] = [
                'employee' => $item->user->name ?? '',
                'pan' => $item->user?->statutoryId('pan') ?? '',
                'uan' => $item->user?->statutoryId('uan') ?? '',
                'joining_date' => $item->user->employeeWorkInfo->joining_date ? $item->user->employeeWorkInfo->joining_date->format('d/m/Y') : '',
                'gross_salary' => (float) $item->gross_salary,
            ];
        }

        $filename = sprintf('shram_card_registration_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/shram_card/{$filename}";

        $this->renderAndStorePdf('filings.shram_card_registration', [
            'employer' => $org,
            'run' => $run,
            'entries' => $entries,
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'shram_card_registration',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => count($entries),
            ],
        ]);
    }

    public function generateForm124(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $org = Organization::find($orgId);
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();

        $entries = [];
        foreach ($items as $item) {
            $entries[] = [
                'employee' => $item->user->name ?? '',
                'pan' => $item->user?->statutoryId('pan') ?? '',
                'gross_salary' => (float) $item->gross_salary,
                'tds' => (float) $item->tds,
            ];
        }

        $filename = sprintf('form_124_%s_%s.pdf', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/form124/{$filename}";

        $this->renderAndStorePdf('filings.form124', [
            'employer' => $org,
            'run' => $run,
            'entries' => $entries,
            'generatedAt' => now(),
        ], $path);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_124',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => count($entries),
            ],
        ]);
    }

    public function generateFullEcr(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo', 'user.employeeGovernmentIds')->get();
        $org = Organization::find($orgId);
        $pfEstablishment = $this->orgStatutoryId($org, 'establishmentCode', ['pf_establishment_code', 'pf_code']);

        $lines = [];
        $lines[] = "FULL ECR - ELECTRONIC CHALLAN CUM RETURN";
        $lines[] = "ESTABLISHMENT: {$org->name}";
        $lines[] = "ESTABLISHMENT ID: {$pfEstablishment}";
        $lines[] = "MONTH: {$run->month_year}";
        $lines[] = "UAN||NAME||GROSS_WAGES||EPF_WAGES||EPS_WAGES||EDLI_WAGES||EPF_EE||EPS_ER||EPF_ER||NCP_DAYS||REFUND||EMPLOYEE_CODE||DESIGNATION||BANK_AC";

        $totalWages = 0;
        $totalEpf = 0;

        foreach ($items as $item) {
            $profile = $item->user->employeeProfile;
            $workInfo = $item->user->employeeWorkInfo;
            // Earned basic, capped — must match the contribution deducted.
            $epfWages = min(self::payableBasic($item), 15000);
            $grossWages = (float) $item->gross_salary;
            // NCP on the same basis as the wages beside it; see generatePfEcr.
            $ncpDays = (float) ($item->lOP_days ?? 0);
            if ($ncpDays <= 0) {
                $ncpDays = max(0, (float) ($item->total_working_days ?? 0) - self::contributoryDays($item));
            }

            $lines[] = implode('||', [
                // Column 1 of the ECR. EPFO rejects the upload if it is blank.
                $item->user?->statutoryId('uan') ?? '',
                $item->user->name ?? '',
                number_format($grossWages, 2, '.', ''),
                number_format($epfWages, 2, '.', ''),
                number_format($epfWages, 2, '.', ''),
                number_format($epfWages, 2, '.', ''),
                number_format((float) $item->pf_employee, 2, '.', ''),
                number_format((float) $item->eps, 2, '.', ''),
                number_format((float) $item->pf_employer, 2, '.', ''),
                number_format($ncpDays, 2, '.', ''),
                '0.00',
                $workInfo->employee_code ?? '',
                $workInfo->designation ?? '',
                $workInfo->bank_account ?? '',
            ]);

            $totalWages += $grossWages;
            $totalEpf += (float) $item->pf_employee;
        }

        $lines[] = str_repeat('-', 80);
        $lines[] = sprintf("TOTAL EMPLOYEES: %d\tTOTAL GROSS: %.2f\tTOTAL EPF EE: %.2f", $items->count(), $totalWages, $totalEpf);

        $content = implode("\n", $lines);
        $filename = sprintf('full_ecr_%s_%s.txt', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/full_ecr/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'full_ecr',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'format' => 'EPFO Full ECR with extended employee details',
                'filing_ready' => true,
                'total_employees' => $items->count(),
                'total_gross_wages' => $totalWages,
                'total_epf_ee' => $totalEpf,
                'pf_establishment_code' => $pfEstablishment,
            ],
        ]);
    }

    public function generateAllFilings(PayrollMonthlyRun $run, int $orgId, int $userId, ?int $payGroupId = null): array
    {
        $filings = [];
        $filings[] = $this->generatePfEcr($run, $orgId, $userId);
        $filings[] = $this->generateEsiChallan($run, $orgId, $userId);
        $filings[] = $this->generateForm24Q($run, $orgId, $userId);
        $filings[] = $this->generateForm12BA($run, $orgId, $userId);

        // LWF is state-specific (no universal formula) — generate per enabled state.
        $lwfStates = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('lwf_enabled', true)
            ->select('pt_state')
            ->distinct()
            ->pluck('pt_state')
            ->filter(fn ($s) => isset(self::LWF_STATE_CONFIG[$s]));
        foreach ($lwfStates as $state) {
            try {
                $filings[] = $this->generateLwfReturn($run, $state, $orgId, $userId, $payGroupId);
            } catch (\InvalidArgumentException $e) {
                // Bi-annual state not due this month, etc. — skip, not fatal.
                \Log::info("Skipped LWF for state {$state}: ".$e->getMessage());
            }
        }

        // PT is state-specific.
        $templates = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->whereNotNull('pt_state')
            ->select('pt_state')
            ->distinct()
            ->pluck('pt_state');

        foreach ($templates as $state) {
            $filings[] = $this->generatePtReturn($run, $state, $orgId, $userId, $payGroupId);
        }

        // Bonus generation when bonus_percent is configured.
        $bonusPercent = $this->getConfiguredBonusPercent($orgId);
        if ($bonusPercent !== null) {
            try {
                $bonusFilings = $this->generateBonusAll($run, $orgId, $userId, $bonusPercent);
                $filings = array_merge($filings, $bonusFilings);
            } catch (\InvalidArgumentException $e) {
                \Log::info("Skipped bonus generation: ".$e->getMessage());
            }
        }

        // Declaration forms (Pattern A — generate here, human uploads to portal).
        $filings[] = $this->generateForm19($run, $orgId, $userId);
        $filings[] = $this->generateForm31($run, $orgId, $userId);
        $filings[] = $this->generateForm1($run, $orgId, $userId);
        $filings[] = $this->generateForm2($run, $orgId, $userId);
        $filings[] = $this->generateForm6($run, $orgId, $userId);
        $filings[] = $this->generateEShramRegistration($run, $orgId, $userId);
        $filings[] = $this->generateUanActivation($run, $orgId, $userId);
        $filings[] = $this->generateSeRegistration($run, $orgId, $userId);
        $filings[] = $this->generateShramCardRegistration($run, $orgId, $userId);
        $filings[] = $this->generateForm124($run, $orgId, $userId);
        $filings[] = $this->generateFullEcr($run, $orgId, $userId);

        // Mark first filing generated (drives onboarding "Next Steps" card)
        $this->markFirstFilingGeneratedIfNeeded($orgId);

        return $filings;
    }

    /**
     * Stamp org settings the first time any statutory filing is generated.
     */
    private function markFirstFilingGeneratedIfNeeded(int $orgId): void
    {
        try {
            $org = Organization::find($orgId);
            if (! $org) {
                return;
            }
            $payrollSettings = $org->settings['payroll'] ?? [];
            if (! empty($payrollSettings['first_filing_generated_at'])) {
                return;
            }
            $payrollSettings['first_filing_generated_at'] = now()->toIso8601String();
            $org->settings = array_merge($org->settings ?? [], ['payroll' => $payrollSettings]);
            $org->save();
        } catch (\Throwable $e) {
            \Log::warning('Failed to mark first filing generated', [
                'org' => $orgId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Render a Blade view to a real PDF using the same Dompdf pipeline used
     * for payslips, and persist it to storage just like every other generator.
     */
    private function renderAndStorePdf(string $view, array $data, string $path): void
    {
        $options = new Options;
        $options->set('isHtml5ParserEnabled', true);
        $options->set('isRemoteEnabled', false);
        $options->set('defaultFont', 'DejaVu Sans');

        $pdf = new Dompdf($options);
        $pdf->loadHtml(view($view, $data)->render());
        $pdf->setPaper('A4', 'portrait');
        $pdf->render();

        Storage::disk('local')->put($path, $pdf->output());
    }

    private function getQuarterFromMonth(string $month): string
    {
        $m = (int) $month;
        if ($m >= 1 && $m <= 3) {
            return 'Q4';
        }
        if ($m >= 4 && $m <= 6) {
            return 'Q1';
        }
        if ($m >= 7 && $m <= 9) {
            return 'Q2';
        }

        return 'Q3';
    }

    private function getFinancialYear(string $monthYear): string
    {
        [$year, $month] = explode('-', $monthYear);
        $y = (int) $year;
        $m = (int) $month;
        if ($m >= 4) {
            return $y.'-'.($y + 1);
        }

        return ($y - 1).'-'.$y;
    }

    /**
     * Returns [start_month_year, end_month_year] for a financial year string.
     * Example: getFinancialYearRange('2025-2026') => ['2025-04', '2026-03']
     */
    private function getFinancialYearRange(string $financialYear): array
    {
        if (! preg_match('/^(\d{4})-(\d{4})$/', $financialYear, $m)) {
            throw new \InvalidArgumentException("Invalid financial year format: {$financialYear} (expected YYYY-YYYY)");
        }
        $startYear = (int) $m[1];
        $endYear = (int) $m[2];
        if ($endYear !== $startYear + 1) {
            throw new \InvalidArgumentException("Financial year end ({$endYear}) must be start + 1 ({$startYear})");
        }

        return [sprintf('%d-04', $startYear), sprintf('%d-03', $endYear)];
    }

    /**
     * Validate FVU structural integrity: record types, field counts, date format, PAN format.
     */
    private function validateFvuStructure(string $content): array
    {
        $errors = [];
        $lines = explode("\r\n", trim($content));

        if (count($lines) < 3) {
            $errors[] = ['code' => 'fvu_too_short', 'message' => 'FVU file must contain at least 3 records.'];
            return $errors;
        }

        $recordCounts = [];
        foreach ($lines as $i => $line) {
            if (empty(trim($line))) {
                continue;
            }
            $fields = explode('^', $line);
            $recordType = $fields[0] ?? '';
            $recordCounts[$recordType] = ($recordCounts[$recordType] ?? 0) + 1;

            if (in_array($recordType, ['FH', 'BH', 'CD', 'DD'])) {
                foreach ($fields as $fi => $field) {
                    if (preg_match('/^\d{8}$/', $field) && $fi >= 6) {
                        $day = (int) substr($field, 0, 2);
                        $month = (int) substr($field, 2, 2);
                        if ($day < 1 || $day > 31 || $month < 1 || $month > 12) {
                            $errors[] = ['code' => 'invalid_date', 'message' => "Line ".($i + 1).": Invalid date in field {$fi}."];
                        }
                    }
                }
            }

            if (in_array($recordType, ['FH', 'DD'])) {
                $panField = $fields[2] ?? '';
                if (!preg_match('/^[A-Z]{5}[0-9]{4}[A-Z]$/', $panField) && !str_starts_with($panField, 'PAN')) {
                    $errors[] = ['code' => 'invalid_pan', 'message' => "Line ".($i + 1).": Invalid PAN in {$recordType} record."];
                }
            }
        }

        if (($recordCounts['FH'] ?? 0) !== 1) {
            $errors[] = ['code' => 'missing_fh', 'message' => 'FVU must contain exactly 1 File Header (FH) record.'];
        }
        if (($recordCounts['BH'] ?? 0) !== 1) {
            $errors[] = ['code' => 'missing_bh', 'message' => 'FVU must contain exactly 1 Batch Header (BH) record.'];
        }
        if (($recordCounts['CD'] ?? 0) < 1) {
            $errors[] = ['code' => 'missing_cd', 'message' => 'FVU must contain at least 1 Challan Detail (CD) record.'];
        }
        if (($recordCounts['DD'] ?? 0) < 1) {
            $errors[] = ['code' => 'missing_dd', 'message' => 'FVU must contain at least 1 Deductee Detail (DD) record.'];
        }
        if (($recordCounts['SD'] ?? 0) !== 1) {
            $errors[] = ['code' => 'missing_sd', 'message' => 'FVU must contain exactly 1 Summary Detail (SD) record.'];
        }
        if (($recordCounts['FT'] ?? 0) !== 1) {
            $errors[] = ['code' => 'missing_ft', 'message' => 'FVU must contain exactly 1 File Trailer (FT) record.'];
        }

        return $errors;
    }
}
