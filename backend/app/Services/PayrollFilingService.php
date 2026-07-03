<?php

namespace App\Services;

use App\Models\PayrollFiling;
use App\Models\PayrollMonthlyRun;
use App\Models\PayrollItem;
use App\Models\EmployeePayrollTemplate;
use App\Models\User;
use App\Models\Organization;
use App\Models\PerquisiteRecord;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class PayrollFilingService
{
    protected PayrollCalculatorService $calculator;

    /**
     * State-wise LWF rate config (employee share, monthly).
     * Central reference — keep in sync with SalaryCalculationService::calculateLwf().
     */
    public const LWF_CONFIG = [
        'maharashtra' => 50,
        'gujarat' => 50,
        'karnataka' => 15,
        'andhra_pradesh' => 20,
        'telangana' => 20,
        'tamil_nadu' => 25,
        'west_bengal' => 10,
        'kerala' => 20,
        'bihar' => 10,
        'delhi' => 6,
        'madhya_pradesh' => 18.75,
        'rajasthan' => 10,
        'goa' => 15,
        'odisha' => 10,
    ];

    public function __construct(PayrollCalculatorService $calculator)
    {
        $this->calculator = $calculator;
    }

    public function generatePfEcr(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo')->get();
        $org = Organization::find($orgId);
        $lines = [];
        $totalWages = 0;

        foreach ($items as $item) {
            $profile = $item->user->employeeProfile;   // may be null
            $workInfo = $item->user->employeeWorkInfo; // may be null
            $pfWages = min($item->basic, 15000);
            $totalWages += $pfWages;

            $lines[] = sprintf(
                "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%.2f\t%.2f\t%.2f\t%.2f\t%.2f",
                $profile?->uan_number ?? '',
                $profile?->uan_number ?? '',
                $item->user->name ?? '',
                $workInfo?->father_name ?? '',
                $profile?->date_of_birth ? Carbon::parse($profile->date_of_birth)->format('d/m/Y') : '',
                ($profile?->gender === 'female') ? 'F' : 'M',
                $workInfo?->date_of_joining ? Carbon::parse($workInfo->date_of_joining)->format('d/m/Y') : '',
                $pfWages,
                $item->pf_employee ?? 0,
                $item->eps ?? 0,
                $item->epf ?? 0,
                $item->pf_employer ?? 0,
            );
        }

        $content = implode("\n", $lines);
        $filename = sprintf('pf_ecr_%s_%s.txt', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/pf/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'pf_ecr',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => $items->count(),
                'total_wages' => $totalWages,
                'total_pf' => $items->sum('pf_employee'),
                'month_year' => $run->month_year,
            ],
        ]);
    }

    public function generateEsiChallan(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile')->where('esi_employee', '>', 0)->get();
        $org = Organization::find($orgId);
        $lines = [];

        $esiCode = $org->settings['esi_code'] ?? '';
        $lines[] = "EMPLOYER'S NAME: {$org->name}";
        $lines[] = "EMPLOYER'S CODE: {$esiCode}";
        $lines[] = "MONTH: {$run->month_year}";
        $lines[] = str_repeat('-', 80);
        $lines[] = "EMP_NO\tNAME\tIP_NUMBER\tGROSS_WAGES\tEMPLOYEE_CONTRIBUTION\tEMPLOYER_CONTRIBUTION";

        foreach ($items as $item) {
            $profile = $item->user->employeeProfile;
            $lines[] = sprintf(
                "%s\t%s\t%s\t%.2f\t%.2f\t%.2f",
                $item->user->employeeWorkInfo->employee_code ?? '',
                $item->user->name,
                $profile->esi_ip_number ?? '',
                $item->gross_salary,
                $item->esi_employee,
                $item->esi_employer,
            );
        }

        $lines[] = str_repeat('-', 80);
        $lines[] = sprintf("TOTAL\t\t\t%.2f\t%.2f\t%.2f",
            $items->sum('gross_salary'),
            $items->sum('esi_employee'),
            $items->sum('esi_employer'),
        );

        $content = implode("\n", $lines);
        $filename = sprintf('esi_challan_%s_%s.txt', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/esi/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'esi_challan',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'total_employees' => $items->count(),
                'total_gross' => $items->sum('gross_salary'),
                'total_ee_esi' => $items->sum('esi_employee'),
                'total_er_esi' => $items->sum('esi_employer'),
            ],
        ]);
    }

    public function generateForm24Q(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo')->get();
        $org = Organization::find($orgId);
        $quarter = $this->getQuarterFromMonth(explode('-', $run->month_year)[1] ?? date('m'));
        $finYear = $this->getFinancialYear($run->month_year);

        $xml = new \SimpleXMLElement('<?xml version="1.0" encoding="UTF-8"?><Form24Q></Form24Q>');
        $header = $xml->addChild('Header');
        $header->addChild('FinancialYear', $finYear);
        $header->addChild('Quarter', $quarter);
        $header->addChild('EmployerName', $org->name);
        $header->addChild('EmployerPAN', $org->settings['pan_number'] ?? '');
        $header->addChild('EmployerTAN', $org->settings['tan_number'] ?? '');
        $header->addChild('EmployerAddress', $org->address ?? '');

        $deductor = $xml->addChild('Deductor');
        $deductor->addChild('Name', $org->name);
        $deductor->addChild('PAN', $org->settings['pan_number'] ?? '');
        $deductor->addChild('TAN', $org->settings['tan_number'] ?? '');
        $deductor->addChild('Address', $org->address ?? '');

        foreach ($items as $item) {
            $deductee = $xml->addChild('Deductee');
            $deductee->addChild('Name', $item->user->name);
            $deductee->addChild('PAN', $item->user->employeeProfile->pan_number ?? '');
            $deductee->addChild('Address', $item->user->employeeWorkInfo->address ?? '');
            $deductee->addChild('GrossSalary', number_format($item->gross_salary, 2, '.', ''));
            $deductee->addChild('TotalDeductions', number_format($item->total_deductions, 2, '.', ''));
            $deductee->addChild('TaxDeducted', number_format($item->tds, 2, '.', ''));
        }

        $filename = sprintf('form_24q_Q%s_%s_%s.xml', $quarter, $org->code ?? 'org', $finYear);
        $path = "filings/{$orgId}/tds/{$filename}";
        Storage::disk('local')->put($path, $xml->asXML());

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_24q',
            'period_type' => 'quarterly',
            'period_quarter' => $quarter,
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'financial_year' => $finYear,
                'quarter' => $quarter,
                'total_employees' => $items->count(),
                'total_tds' => $items->sum('tds'),
            ],
        ]);
    }

    /**
     * Generate Form 16 (TDS certificate) for an employee for one financial year.
     * Aggregates all `payroll_items` for the user across the FY (Apr-Mar).
     * Renders Part A (employer/deductor details) + Part B (annualized tax computation)
     * via filings.form16_annual view and saves as PDF.
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
        $annualExemptions = $this->calculator->getApprovedTaxDeductions($employeeUserId, $financialYear);
        $annualizedTds = $this->calculator->calculateMonthlyTDS(
            annualGross: $totals['gross'],
            taxRegime: $taxRegime,
            exemptions: ['section_80c' => $annualExemptions]
        );

        $html = view('filings.form16_annual', [
            'employer' => $org,
            'employee' => $user,
            'financialYear' => $financialYear,
            'totals' => $totals,
            'annualizedTds' => $annualizedTds,
            'taxRegime' => $taxRegime,
            'months' => $items,
            'pan' => $org->settings['pan_number'] ?? '',
            'tan' => $org->settings['tan_number'] ?? '',
            'certificateNo' => 'FORM16-' . str_replace('-', '', $financialYear) . '-' . $employeeUserId,
            'generatedAt' => now(),
        ])->render();

        $filename = sprintf('form_16_%s_%s.html', $user->employeeProfile->pan_number ?? 'NOPAN', $financialYear);
        $path = "filings/{$orgId}/form16/{$filename}";

        // Persist HTML (the existing PayrollPdfService is for payslips, not tax certificates;
        // HTML keeps the file human-readable & printable without pulling in another PDF lib).
        Storage::disk('local')->put($path, $html);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_16',
            'period_type' => 'annual',
            'period_year' => (int) explode('-', $financialYear)[0],
            'status' => 'generated',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $generatorId,
            'meta_data' => [
                'user_id' => $employeeUserId,
                'pan' => $user->employeeProfile->pan_number ?? '',
                'financial_year' => $financialYear,
                'tax_regime' => $taxRegime,
                'annual_gross' => $totals['gross'],
                'annual_tds' => $totals['tds'],
                'recomputed_annual_tds' => $annualizedTds['annual_tax'] ?? null,
                'months_included' => $items->count(),
            ],
        ]);
    }

    public function generateForm12BA(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo')->get();
        $org = Organization::find($orgId);

        $entries = [];
        foreach ($items as $item) {
            $perquisites = PerquisiteRecord::where('user_id', $item->user_id)
                ->where('is_active', true)
                ->sum('monthly_value');

            $entries[] = [
                'employee' => $item->user->name,
                'pan' => $item->user->employeeProfile->pan_number ?? '',
                'gross_salary' => $item->gross_salary,
                'perquisites' => $perquisites,
                'profits_in_lieu' => 0,
                'total_income' => $item->gross_salary + $perquisites,
                'tds' => $item->tds,
            ];
        }

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_12ba',
            'period_type' => 'annual',
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => ['entries' => $entries],
        ]);
    }

    public function generatePtReturn(PayrollMonthlyRun $run, string $state, int $orgId, int $userId): PayrollFiling
    {
        // Filter items whose employee's template is in the given state.
        $userIdsInState = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('pt_state', $state)
            ->pluck('user_id');
        $items = $run->items()
            ->with('user.employeeProfile', 'user.employeeWorkInfo')
            ->whereIn('user_id', $userIdsInState)
            ->get();
        $org = Organization::find($orgId);

        $lines = [];
        $lines[] = "PROFESSIONAL TAX RETURN - {$state}";
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
        $filename = sprintf('pt_return_%s_%s_%s.txt', strtolower($state), $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/pt/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'pt_return',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => ['state' => $state, 'total_pt' => $items->sum('pt')],
        ]);
    }

    public function generateLwfReturn(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $userIdsWithLwf = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('lwf_enabled', true)
            ->pluck('user_id');
        $items = $run->items()
            ->with('user.employeeProfile', 'user.employeeWorkInfo')
            ->whereIn('user_id', $userIdsWithLwf)
            ->get();
        $org = Organization::find($orgId);

        $lines = [];
        $lines[] = "LABOUR WELFARE FUND RETURN";
        $lines[] = "ORGANIZATION: {$org->name}";
        $lines[] = "MONTH: {$run->month_year}";
        $lines[] = str_repeat('-', 60);
        $lines[] = "EMP_CODE\tNAME\tLWF_AMOUNT";

        foreach ($items as $item) {
            $state = strtolower($item->user->employeeProfile->state ?? 'others');
            $lwfAmount = $item->gross_salary > 0 ? (self::LWF_CONFIG[$state] ?? 0) : 0;
            $lines[] = sprintf("%s\t%s\t%d", $item->user->employeeWorkInfo->employee_code ?? '', $item->user->name, $lwfAmount);
        }

        $content = implode("\n", $lines);
        $filename = sprintf('lwf_return_%s_%s.txt', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/lwf/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'lwf_return',
            'period_type' => 'monthly',
            'period_month' => explode('-', $run->month_year)[1] ?? date('m'),
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
        ]);
    }

    public function generateBonusFormC(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile')
            ->where('basic', '<=', 21000)
            ->get();
        $org = Organization::find($orgId);

        $lines = [];
        $lines[] = "BONUS ACT - FORM C (Annual Return)";
        $lines[] = "ORGANIZATION: {$org->name}";
        $lines[] = "YEAR: " . explode('-', $run->month_year)[0];
        $lines[] = str_repeat('=', 80);
        $lines[] = "EMP_CODE\tNAME\tDESIGNATION\tWAGES\tBONUS_PERCENT\tBONUS_AMOUNT";

        foreach ($items as $item) {
            $bonusPercent = 8.33;
            // Payment of Bonus Act: bonus is 8.33% of annual wages,
            // where monthly wages are capped at ₹7,000.
            $monthlyWages = min($item->basic, 7000);
            $annualWages = $monthlyWages * 12;
            $bonusAmount = $annualWages * ($bonusPercent / 100);
            $lines[] = sprintf(
                "%s\t%s\t%s\t%.2f\t%.2f%%\t%.2f",
                $item->user->employeeWorkInfo->employee_code ?? '',
                $item->user->name,
                $item->user->employeeWorkInfo->designation ?? '',
                $item->basic,
                $bonusPercent,
                $bonusAmount,
            );
        }

        $content = implode("\n", $lines);
        $filename = sprintf('bonus_form_c_%s_%s.txt', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/bonus/{$filename}";
        Storage::disk('local')->put($path, $content);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'bonus_form_c',
            'period_type' => 'annual',
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
        ]);
    }

    public function generateAllFilings(PayrollMonthlyRun $run, int $orgId, int $userId): array
    {
        $filings = [];
        $filings[] = $this->generatePfEcr($run, $orgId, $userId);
        $filings[] = $this->generateEsiChallan($run, $orgId, $userId);
        $filings[] = $this->generateForm24Q($run, $orgId, $userId);
        $filings[] = $this->generateForm12BA($run, $orgId, $userId);
        $filings[] = $this->generateLwfReturn($run, $orgId, $userId);

        $templates = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->whereNotNull('pt_state')
            ->distinct('pt_state')
            ->pluck('pt_state');

        foreach ($templates as $state) {
            $filings[] = $this->generatePtReturn($run, $state, $orgId, $userId);
        }

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
            $org = \App\Models\Organization::find($orgId);
            if (!$org) {
                return;
            }
            $payrollSettings = $org->settings['payroll'] ?? [];
            if (!empty($payrollSettings['first_filing_generated_at'])) {
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

    private function getQuarterFromMonth(string $month): string
    {
        $m = (int) $month;
        if ($m >= 1 && $m <= 3) return 'Q4';
        if ($m >= 4 && $m <= 6) return 'Q1';
        if ($m >= 7 && $m <= 9) return 'Q2';
        return 'Q3';
    }

    private function getFinancialYear(string $monthYear): string
    {
        [$year, $month] = explode('-', $monthYear);
        $y = (int) $year;
        $m = (int) $month;
        $start = $m >= 4 ? $y : ($y - 1);
        return $start . '-' . substr($start + 1, -2);
    }

    /**
     * Returns [start_month_year, end_month_year] for a financial year string.
     * Example: getFinancialYearRange('2025-2026') => ['2025-04', '2026-03']
     */
    private function getFinancialYearRange(string $financialYear): array
        {
            // Accept both YYYY-YY (short) and YYYY-YYYY (long, for backward compat)
            if (!preg_match('/^(\\d{4})-(\\d{2,4})$/', $financialYear, $m)) {
                throw new \InvalidArgumentException("Invalid financial year format: {$financialYear} (expected YYYY-YY or YYYY-YYYY)");
            }
            $startYear = (int) $m[1];
            $endYear = (int) $m[2];
            if ($endYear >= 100) {
                // Long format YYYY-YYYY — validate end = start + 1
                if ($endYear !== $startYear + 1) {
                    throw new \InvalidArgumentException("Financial year end ({$endYear}) must be start + 1 ({$startYear})");
                }
            } else {
                // Short format YYYY-YY — reconstruct full year
                $century = (int) substr((string) $startYear, 0, 2);
                $endYear = (int) ($century . sprintf('%02d', $endYear));
                if ($endYear !== $startYear + 1) {
                    throw new \InvalidArgumentException("Financial year end ({$endYear}) must be start + 1 ({$startYear})");
                }
            }
            return [sprintf('%d-04', $startYear), sprintf('%d-03', $endYear)];
        }
    }
