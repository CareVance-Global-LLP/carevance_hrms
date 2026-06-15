<?php

namespace App\Services;

use App\Models\PayrollFiling;
use App\Models\PayrollMonthlyRun;
use App\Models\PayrollItem;
use App\Models\EmployeePayrollTemplate;
use App\Models\User;
use App\Models\Organization;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;

class PayrollFilingService
{
    protected PayrollCalculatorService $calculator;

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
            $profile = $item->user->employeeProfile;
            $workInfo = $item->user->employeeWorkInfo;
            $pfWages = min($item->basic, 15000);
            $totalWages += $pfWages;

            $lines[] = sprintf(
                "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%.2f\t%.2f\t%.2f\t%.2f\t%.2f",
                $profile->uan_number ?? '',
                $profile->uan_number ?? '',
                $item->user->name ?? '',
                $workInfo->father_name ?? '',
                $profile->date_of_birth ? Carbon::parse($profile->date_of_birth)->format('d/m/Y') : '',
                $profile->gender === 'female' ? 'F' : 'M',
                $workInfo->date_of_joining ? Carbon::parse($workInfo->date_of_joining)->format('d/m/Y') : '',
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

    public function generateForm16(PayrollItem $item, int $orgId, int $userId): PayrollFiling
    {
        $user = $item->user()->with('employeeProfile', 'employeeWorkInfo')->first();
        $org = Organization::find($orgId);
        $run = $item->payrollRun;
        $finYear = $this->getFinancialYear($run->month_year);

        $html = view('filings.form16', [
            'employer' => $org,
            'employee' => $user,
            'item' => $item,
            'run' => $run,
            'financialYear' => $finYear,
            'certificateNo' => 'PART-A-' . $item->id,
            'tan' => $org->settings['tan_number'] ?? '',
            'pan' => $org->settings['pan_number'] ?? '',
            'remarks' => '',
        ])->render();

        $filename = sprintf('form_16_%s_%s_%s.pdf', $user->employeeProfile->pan_number ?? 'NOPAN', $user->id, $finYear);
        $path = "filings/{$orgId}/form16/{$filename}";

        $pdfService = app(PayrollPdfService::class);
        $pdf = $pdfService->generatePayslip($item);
        Storage::disk('local')->put($path, $pdf->output());

        return PayrollFiling::create([
            'organization_id' => $orgId,
            'type' => 'form_16',
            'period_type' => 'annual',
            'period_year' => explode('-', $run->month_year)[0] ?? date('Y'),
            'status' => 'generated',
            'file_path' => $path,
            'original_filename' => $filename,
            'generated_at' => now(),
            'generated_by' => $userId,
            'meta_data' => [
                'user_id' => $user->id,
                'pan' => $user->employeeProfile->pan_number ?? '',
                'financial_year' => $finYear,
                'part_a_amount' => $item->gross_salary,
                'part_b_tds' => $item->tds,
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
        $items = $run->items()->with('user.employeeProfile')
            ->whereHas('user.employeePayrollTemplate', fn($q) => $q->where('pt_state', $state))
            ->get();

        $ptService = app(PTStateService::class);
        $slabs = $ptService->getSlabs($state);

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
        $items = $run->items()->with('user.employeeProfile')
            ->whereHas('user.employeePayrollTemplate', fn($q) => $q->where('lwf_enabled', true))
            ->get();
        $org = Organization::find($orgId);

        $lines = [];
        $lines[] = "LABOUR WELFARE FUND RETURN";
        $lines[] = "ORGANIZATION: {$org->name}";
        $lines[] = "MONTH: {$run->month_year}";
        $lines[] = str_repeat('-', 60);
        $lines[] = "EMP_CODE\tNAME\tLWF_AMOUNT";

        foreach ($items as $item) {
            $lwfAmount = $item->gross_salary > 0 ? ($item->gross_salary <= 15000 ? 12 : 36) : 0;
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
            $bonusAmount = $item->basic * ($bonusPercent / 100);
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

        return $filings;
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
        if ($m >= 4) {
            return $y . '-' . ($y + 1);
        }
        return ($y - 1) . '-' . $y;
    }
}
