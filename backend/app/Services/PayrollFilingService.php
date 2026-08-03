<?php

namespace App\Services;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollFiling;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\PerquisiteRecord;
use App\Models\User;
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
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo')->get();
        $org = Organization::find($orgId);
        $lines = [];
        $totalWages = 0;
        $totalEpfWages = 0;
        $totalEpf = 0;

        $pfCap = 15000;

        foreach ($items as $item) {
            $profile = $item->user->employeeProfile;   // may be null
            $workInfo = $item->user->employeeWorkInfo; // may be null

            // PF wages are capped at the statutory ceiling.
            $epfWages = min((float) $item->basic, $pfCap);
            $grossWages = (float) $item->gross_salary;
            $edliWages = min((float) $item->basic, $pfCap);

            // EPF EE contribution (capped-wage based).
            $epfEe = (float) $item->pf_employee;
            // Employer EPS (8.33% of EPFO wages, capped) and employer EPF (3.67%).
            $epsEr = (float) $item->eps;
            $epfEr = (float) $item->pf_employer;

            $totalWages += $grossWages;
            $totalEpfWages += $epfWages;
            $totalEpf += $epfEe;

            // NCP days = non-contributory paid days. We derive from attendance:
            // working days minus actually paid/contributory days.
            $workingDays = (float) ($item->total_working_days ?? 0);
            $contributoryDays = (float) ($item->present_days ?? 0) + (float) ($item->paid_leave_days ?? 0);
            $ncpDays = $workingDays > 0 ? max(0, round($workingDays - $contributoryDays, 2)) : 0;

            $lines[] = implode('||', [
                $profile?->uan_number ?? '',
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

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'pf_ecr',
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
                'format' => 'EPFO ECR 11-column ||-delimited',
                'filing_ready' => true,
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
     * Generate the ESI contribution export. EPFO has no official CSV upload
     * format published for bulk employer IP contribution the way PF does, but
     * the ESIC employer portal "Upload Excel" for monthly contribution expects
     * per-IP rows with: Employer Code, IP Number, Name, Days, Gross Wages,
     * Employee Contribution, Employer Contribution. We emit that as a CSV
     * (machine-usable, portal-aligned columns) AND keep a human-readable
     * summary as a secondary download in meta_data. The actual challan is still
     * generated on the ESIC portal — this file feeds/pre-fills it, it is not the
     * legal challan itself.
     */
    public function generateEsiChallan(PayrollMonthlyRun $run, int $orgId, int $userId): PayrollFiling
    {
        $items = $run->items()->with('user.employeeProfile', 'user.employeeWorkInfo')->where('esi_employee', '>', 0)->get();
        $org = Organization::find($orgId);

        $esiCode = $org->settings['esi_code'] ?? '';
        $totalGross = 0;
        $totalEe = 0;
        $totalEr = 0;

        // Portal-aligned CSV (Employer Code, IP Number, Name, Days, Wages, EE, ER)
        $csvHeader = ['EMPLOYER_CODE', 'IP_NUMBER', 'NAME', 'DAYS', 'GROSS_WAGES', 'EMPLOYEE_CONTRIBUTION', 'EMPLOYER_CONTRIBUTION'];
        $csvRows = [$csvHeader];

        $summaryLines = [];
        $summaryLines[] = "EMPLOYER'S NAME: {$org->name}";
        $summaryLines[] = "EMPLOYER'S CODE: {$esiCode}";
        $summaryLines[] = "MONTH: {$run->month_year}";
        $summaryLines[] = str_repeat('-', 80);
        $summaryLines[] = "EMP_NO\tNAME\tIP_NUMBER\tGROSS_WAGES\tEMPLOYEE_CONTRIBUTION\tEMPLOYER_CONTRIBUTION";

        foreach ($items as $item) {
            $profile = $item->user->employeeProfile;
            $workInfo = $item->user->employeeWorkInfo;
            $ipNumber = $profile->esi_ip_number ?? '';
            $gross = (float) $item->gross_salary;
            $ee = (float) $item->esi_employee;
            $er = (float) $item->esi_employer;
            $days = (float) ($item->present_days ?? 0) + (float) ($item->paid_leave_days ?? 0);

            $totalGross += $gross;
            $totalEe += $ee;
            $totalEr += $er;

            $csvRows[] = [
                $esiCode,
                $ipNumber,
                $item->user->name,
                number_format($days, 2, '.', ''),
                number_format($gross, 2, '.', ''),
                number_format($ee, 2, '.', ''),
                number_format($er, 2, '.', ''),
            ];
            $summaryLines[] = sprintf(
                "%s\t%s\t%s\t%.2f\t%.2f\t%.2f",
                $workInfo->employee_code ?? '',
                $item->user->name,
                $ipNumber,
                $gross,
                $ee,
                $er,
            );
        }

        $summaryLines[] = str_repeat('-', 80);
        $summaryLines[] = sprintf("TOTAL\t\t\t%.2f\t%.2f\t%.2f", $totalGross, $totalEe, $totalEr);

        $csvContent = implode("\n", array_map(
            fn ($row) => implode(',', array_map(fn ($v) => str_contains((string) $v, ',') ? '"'.$v.'"' : $v, $row)),
            $csvRows
        ));
        $summaryContent = implode("\n", $summaryLines);

        $filename = sprintf('esi_contribution_%s_%s.csv', $org->code ?? 'org', $run->month_year);
        $path = "filings/{$orgId}/esi/{$filename}";
        Storage::disk('local')->put($path, $csvContent);

        $summaryFilename = sprintf('esi_contribution_summary_%s_%s.txt', $org->code ?? 'org', $run->month_year);
        $summaryPath = "filings/{$orgId}/esi/{$summaryFilename}";
        Storage::disk('local')->put($summaryPath, $summaryContent);

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'esi_challan',
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
                'is_reference_summary' => true,
                'filing_ready' => false,
                'guidance' => 'Portal-aligned CSV of ESIC-eligible employees (Employer Code, IP Number, Name, Days, Wages, EE/ER contribution). Use it to pre-fill the ESIC employer portal monthly contribution; the actual challan is generated there.',
                'summary_file_path' => $summaryPath,
                'summary_filename' => $summaryFilename,
                'total_employees' => $items->count(),
                'total_gross' => $totalGross,
                'total_ee_esi' => $totalEe,
                'total_er_esi' => $totalEr,
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

        // NOTE: This is a SOURCE-DATA export, NOT a filing-ready e-TDS file.
        // Real Form 24Q quarterly returns must be filed in NSDL/Protean's
        // File Validation Utility (FVU) format — a fixed-structure text file
        // with Batch Header / Challan / Deductee record types that passes the
        // FVU. A custom XML is not accepted by the actual TDS filing system.
        // HR/finance must feed this export into NSDL-approved RPUTIN-FC software
        // to prepare the actual filing.
        $filename = sprintf('form_24q_Q%s_%s_%s_data.xml', $quarter, $org->code ?? 'org', $finYear);
        $path = "filings/{$orgId}/tds/{$filename}";
        Storage::disk('local')->put($path, $xml->asXML());

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_24q',
            'period_type' => 'quarterly',
            'period_quarter' => $quarter,
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'compliance_status' => 'reference_only',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'is_source_data_only' => true,
                'filing_ready' => false,
                'guidance' => 'Source data export. Prepare the actual e-TDS return using NSDL-approved RPU/TIN-FC software (File Validation Utility format) before filing.',
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
        $filename = sprintf('form_16_part_b_%s_%s.pdf', $user->employeeProfile->pan_number ?? 'NOPAN', $financialYear);
        $path = "filings/{$orgId}/form16/{$filename}";

        $this->renderAndStorePdf('filings.form16_annual', [
            'employer' => $org,
            'employee' => $user,
            'financialYear' => $financialYear,
            'totals' => $totals,
            'annualizedTds' => $annualizedTds,
            'taxRegime' => $taxRegime,
            'months' => $items,
            'pan' => $org->settings['pan_number'] ?? '',
            'tan' => $org->settings['tan_number'] ?? '',
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
                'pan' => $user->employeeProfile->pan_number ?? '',
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
            'pan' => $org->settings['pan_number'] ?? '',
            'tan' => $org->settings['tan_number'] ?? '',
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

        $ptPortal = self::STATE_PORTAL["{$state}_pt"] ?? null;

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
        $filename = sprintf('pt_contribution_summary_%s_%s_%s.txt', strtolower($state), $org->code ?? 'org', $run->month_year);
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
                'state' => $state,
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
    public function generateLwfReturn(PayrollMonthlyRun $run, string $state, int $orgId, int $userId): PayrollFiling
    {
        if (! isset(self::LWF_STATE_CONFIG[$state])) {
            throw new \InvalidArgumentException(
                "LWF is not configured for state '{$state}'. This state is either unsupported by the current rate table or has no LWF Act. Add the correct rates for this state before generating."
            );
        }

        $config = self::LWF_STATE_CONFIG[$state];
        $payMonth = (int) (explode('-', $run->month_year)[1] ?? date('m'));

        // Bi-annual states only contribute in their designated months; outside
        // those months there is genuinely nothing to file for LWF.
        if ($config['frequency'] === 'bi_annual' && ! in_array($payMonth, $config['months'] ?? [])) {
            throw new \InvalidArgumentException(
                "LWF for '{$state}' is payable only in month(s) ".implode(', ', $config['months'] ?? [])." of the year. No contribution is due for {$run->month_year}."
            );
        }

        $lwfAmount = (float) $config['amount'];

        $userIdsWithLwf = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('lwf_enabled', true)
            ->pluck('user_id');
        $items = $run->items()
            ->with('user.employeeProfile', 'user.employeeWorkInfo')
            ->whereIn('user_id', $userIdsWithLwf)
            ->get();
        $org = Organization::find($orgId);

        $lines = [];
        $lines[] = "LABOUR WELFARE FUND RETURN — {$state}";
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
        $filename = sprintf('lwf_return_%s_%s_%s.txt', strtolower($state), $org->code ?? 'org', $run->month_year);
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
                'state' => $state,
                'frequency' => $config['frequency'],
                'per_employee_amount' => $lwfAmount,
                'employees' => $items->count(),
                'total_lwf' => $lwfAmount * $items->count(),
                'portal' => self::STATE_PORTAL[$state] ?? null,
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
            ->with('user.employeeProfile', 'user.employeeWorkInfo')
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

    public function generateAllFilings(PayrollMonthlyRun $run, int $orgId, int $userId): array
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
                $filings[] = $this->generateLwfReturn($run, $state, $orgId, $userId);
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
}
