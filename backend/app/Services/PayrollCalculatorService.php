<?php

namespace App\Services;

use App\Models\EmployeeTaxDeclaration;
use App\Models\SalaryFormula;
use Carbon\Carbon;

class PayrollCalculatorService
{
    const PF_WAGE_CAP = 15000;
    const EMPLOYEE_PF_RATE = 0.12;
    const EMPLOYER_PF_RATE = 0.12;
    const EPS_RATE = 0.0833;
    const EPF_RATE = 0.0367;
    const ESI_GROSS_THRESHOLD = 21000;
    const ESI_EMPLOYEE_RATE = 0.0075;
    const ESI_EMPLOYER_RATE = 0.0325;
    const GRATUITY_RATE = 0.0481;
    const STANDARD_DEDUCTION_NEW = 75000;
    const STANDARD_DEDUCTION_OLD = 50000;
    const REBATE_LIMIT_NEW = 1200000;
    const REBATE_LIMIT_OLD = 500000;
    const REBATE_MAX_OLD = 12500;
    const SECTION_80C_CAP = 150000;
    const SECTION_80CCD1B_CAP = 50000;
    const HEALTH_EDUCATION_CESS = 0.04;
    // Surcharge slabs (FY 2024-25)
    const SURCHARGE_SLABS = [
        ['min' => 5000000,  'max' => 10000000, 'rate' => 0.10],
        ['min' => 10000001, 'max' => 20000000, 'rate' => 0.15],
        ['min' => 20000001, 'max' => 50000000, 'rate' => 0.25],
        ['min' => 50000001, 'max' => PHP_FLOAT_MAX, 'rate' => 0.25, 'capped' => 'old'],
    ];

    public function calculatePayroll(
        float $annualCtc,
        string $stateCode = 'maharashtra',
        bool $isMetroCity = false,
        string $taxRegime = 'new',
        array $customConfig = [],
        float $annualTaxExemptions = 0
    ): array {
        $config = array_merge([
            'basic_percentage' => 0.40,
            'hra_percentage_of_basic' => 0.50,
            'conveyance_allowance' => 1600,
            'medical_allowance' => 0,
        ], $customConfig);

        if (!$isMetroCity) {
            $config['hra_percentage_of_basic'] = 0.40;
        }

        $monthlyCtc = $annualCtc / 12;
        $salaryComponents = $this->calculateSalaryComponents($monthlyCtc, $config);
        $employeeDeductions = $this->calculateEmployeeDeductions(
            $salaryComponents['basic'],
            $salaryComponents['gross'],
            $stateCode,
            $annualCtc,
            $taxRegime,
            $annualTaxExemptions
        );
        $employerContributions = $this->calculateEmployerContributions(
            $salaryComponents['basic'],
            $salaryComponents['gross']
        );

        $totalDeductions = array_sum($employeeDeductions);
        $netPay = $salaryComponents['gross'] - $totalDeductions;

        return [
            'monthly' => [
                'ctc' => round($monthlyCtc, 2),
                'gross' => round($salaryComponents['gross'], 2),
                'net' => round($netPay, 2),
                'total_deductions' => round($totalDeductions, 2),
            ],
            'annual' => [
                'ctc' => round($annualCtc, 2),
                'gross' => round($salaryComponents['gross'] * 12, 2),
                'net' => round($netPay * 12, 2),
            ],
            'components' => [
                'earnings' => [
                    'basic' => round($salaryComponents['basic'], 2),
                    'hra' => round($salaryComponents['hra'], 2),
                    'conveyance' => round($salaryComponents['conveyance'], 2),
                    'special_allowance' => round($salaryComponents['special_allowance'], 2),
                ],
                'deductions' => [
                    'pf_employee' => round($employeeDeductions['pf'], 2),
                    'esi_employee' => round($employeeDeductions['esi'], 2),
                    'pt' => round($employeeDeductions['pt'], 2),
                    'tds' => round($employeeDeductions['tds'], 2),
                ],
                'employer_contributions' => [
                    'pf_employer' => round($employerContributions['pf'], 2),
                    'eps' => round($employerContributions['eps'], 2),
                    'epf' => round($employerContributions['epf'], 2),
                    'esi_employer' => round($employerContributions['esi'], 2),
                    'gratuity' => round($employerContributions['gratuity'], 2),
                ],
            ],
            'breakdown' => [
                'pf_wages' => round(min($salaryComponents['basic'], self::PF_WAGE_CAP), 2),
                'pf_cap_applied' => $salaryComponents['basic'] > self::PF_WAGE_CAP,
                'esi_applicable' => $salaryComponents['gross'] <= self::ESI_GROSS_THRESHOLD,
                'tax_regime' => $taxRegime,
                'state_code' => $stateCode,
                'is_metro_city' => $isMetroCity,
            ],
        ];
    }

    protected function calculateSalaryComponents(float $monthlyCtc, array $config): array
    {
        $basic = $monthlyCtc * $config['basic_percentage'];
        $hra = $basic * $config['hra_percentage_of_basic'];
        $conveyance = $config['conveyance_allowance'];

        $employerPf = $this->calculateEmployerPF($basic);
        $gratuity = $this->calculateGratuityProvision($basic);
        $gross = $monthlyCtc - $employerPf - $gratuity;

        $fixedComponents = $basic + $hra + $conveyance;
        $specialAllowance = max(0, $gross - $fixedComponents);

        return [
            'basic' => $basic,
            'hra' => $hra,
            'conveyance' => $conveyance,
            'special_allowance' => $specialAllowance,
            'gross' => $gross,
        ];
    }

    protected function calculateEmployeeDeductions(
        float $basic,
        float $gross,
        string $stateCode,
        float $annualCtc,
        string $taxRegime,
        float $annualTaxExemptions = 0
    ): array {
        // TDS must be calculated on GROSS SALARY (CTC - employer PF - gratuity)
        // not on CTC, because employer-side contributions are not the employee's
        // taxable income. Both regimes use the same gross definition.
        $employerPfMonthly = $this->calculateEmployerPF($basic);
        $gratuityMonthly   = $this->calculateGratuityProvision($basic);
        $annualGross       = max(0, ($gross) * 12);

        // Exemptions only used for OLD regime. For NEW regime, only standard deduction applies.
        $exemptions = $taxRegime === 'old' ? ['section_80c' => $annualTaxExemptions] : [];

        $tds = $this->calculateMonthlyTDS($annualGross, $taxRegime, $exemptions);

        return [
            'pf' => $this->calculateEmployeePF($basic),
            'esi' => $this->calculateEmployeeESI($gross),
            'pt' => PTStateService::calculate($stateCode, $gross),
            'tds' => $tds['monthly_tds'],
        ];
    }

    protected function calculateEmployerContributions(float $basic, float $gross): array
    {
        $pf = $this->calculateEmployerPF($basic);
        $pfWages = min($basic, self::PF_WAGE_CAP);

        return [
            'pf' => $pf,
            'eps' => $pfWages * self::EPS_RATE,
            'epf' => $pfWages * self::EPF_RATE,
            'esi' => $this->calculateEmployerESI($gross),
            'gratuity' => $this->calculateGratuityProvision($basic),
        ];
    }

    public function calculateEmployeePF(float $basic): float
    {
        return min($basic, self::PF_WAGE_CAP) * self::EMPLOYEE_PF_RATE;
    }

    public function calculateEmployerPF(float $basic): float
    {
        return min($basic, self::PF_WAGE_CAP) * self::EMPLOYER_PF_RATE;
    }

    public function calculateEmployeeESI(float $gross): float
    {
        if ($gross > self::ESI_GROSS_THRESHOLD) return 0;
        return $gross * self::ESI_EMPLOYEE_RATE;
    }

    public function calculateEmployerESI(float $gross): float
    {
        if ($gross > self::ESI_GROSS_THRESHOLD) return 0;
        return $gross * self::ESI_EMPLOYER_RATE;
    }

    public function calculateGratuityProvision(float $basic): float
    {
        return $basic * self::GRATUITY_RATE;
    }

    public function calculateGratuityOnExit(float $lastBasic, float $yearsOfService, float $dearnessAllowance = 0): float
    {
        return (($lastBasic + $dearnessAllowance) * 15 * $yearsOfService) / 26;
    }

    /**
     * Calculate monthly TDS (Tax Deducted at Source).
     *
     * IMPORTANT: TDS is calculated on Gross Salary (CTC minus employer's PF and gratuity
     * contributions, which are NOT part of the employee's income under both Income Tax
     * regimes). For the new regime (Sec 115BAC), only the standard deduction of ₹75,000
     * is allowed — no other exemptions (80C, 80D, HRA, LTA, etc.). For the old regime
     * (default), all Chapter VI-A deductions + HRA exemption are available.
     *
     * @param float $annualGross Annual Gross Salary (CTC - employer PF - gratuity)
     * @param string $taxRegime 'new' (115BAC) or 'old' (default)
     * @param array $exemptions Map of section => annual amount (used for old regime only)
     * @return array{monthly_tds: float, annual_tax: array}
     */
    public function calculateMonthlyTDS(float $annualGross, string $taxRegime = 'new', array $exemptions = []): array
    {
        if ($taxRegime === 'new') {
            // New regime: ONLY standard deduction of ₹75,000 is allowed.
            // All other exemptions (80C, 80D, HRA, LTA) are NOT available.
            $annualTax = $this->calculateNewRegimeTax($annualGross, []);
        } else {
            // Old regime: standard deduction + all Chapter VI-A deductions + HRA
            $annualTax = $this->calculateOldRegimeTax($annualGross, $exemptions);
        }

        $annualTotal = is_array($annualTax) ? $annualTax['total_tax'] : (float) $annualTax;
        return [
            'monthly_tds' => round($annualTotal / 12, 2),
            'annual_tax' => $annualTax,
        ];
    }

    /**
     * Backward-compat shim: return just the monthly TDS as a float.
     */
    public function calculateMonthlyTDSLegacy(float $annualCtc, string $taxRegime = 'new', float $annualTaxExemptions = 0): float
    {
        $result = $this->calculateMonthlyTDS(
            $annualCtc,
            $taxRegime,
            ['section_80c' => $annualTaxExemptions]
        );
        return $result['monthly_tds'];
    }

    /**
     * Calculate surcharge for high-income individuals (FY 2024-25).
     * New regime (Sec 115BAC) surcharge capped at 25%.
     * Old regime surcharge goes up to 30% for income > ₹5Cr but marginal relief applies.
     */
    protected function calculateSurcharge(float $taxBeforeSurcharge, float $totalIncome, string $regime): float
    {
        if ($totalIncome <= 5000000) return 0.0;

        $surchargeRate = 0.0;
        $capped = false;
        foreach (self::SURCHARGE_SLABS as $slab) {
            if ($totalIncome > $slab['min'] && $totalIncome <= $slab['max']) {
                $surchargeRate = $slab['rate'];
                $capped = ($regime === 'new' || ($slab['capped'] ?? false) === 'old');
                break;
            }
        }

        // New regime surcharge cap: 25% (Sec 115BAC)
        if ($regime === 'new' && $surchargeRate > 0.25) {
            $surchargeRate = 0.25;
        }

        return $taxBeforeSurcharge * $surchargeRate;
    }

    public function calculateLOP(float $monthlyGross, int $lopDays, int $workingDays = 26): float
    {
        return ($monthlyGross / $workingDays) * $lopDays;
    }

    public function calculateProRatedSalary(float $monthlyGross, int $daysWorked, int $totalDays = 30): float
    {
        return ($monthlyGross / $totalDays) * $daysWorked;
    }

    public function getApprovedTaxDeductions(int $userId, ?string $financialYear = null): float
    {
        $financialYear = $financialYear ?? $this->getCurrentFinancialYear();

        $declaration = EmployeeTaxDeclaration::where('user_id', $userId)
            ->where('financial_year', $financialYear)
            ->where('status', 'approved')
            ->first();

        if (!$declaration) return 0;

        $items = $declaration->items()->where('status', 'approved')->get();
        $totalDeductions = 0;
        $section80Total = 0;

        foreach ($items as $item) {
            $amount = (float) $item->approved_amount;
            if ($amount <= 0) continue;

            switch ($item->section) {
                case '80C':
                case '80CCC':
                case '80CCD1':
                    $section80Total += $amount;
                    break;
                case '80CCD1B':
                    $totalDeductions += min($amount, self::SECTION_80CCD1B_CAP);
                    break;
                case '80D':
                    $totalDeductions += min($amount, 25000);
                    break;
                case '80DD':
                    $totalDeductions += min($amount, 75000);
                    break;
                case '80DDB':
                    $totalDeductions += min($amount, 40000);
                    break;
                case '80E':
                    $totalDeductions += $amount;
                    break;
                case '80G':
                    $totalDeductions += min($amount, $amount * 0.50);
                    break;
                case '80GG':
                    $totalDeductions += min($amount, 60000);
                    break;
                case '80TTA':
                    $totalDeductions += min($amount, 10000);
                    break;
                case '80TTB':
                    $totalDeductions += min($amount, 50000);
                    break;
                case '24B':
                    $totalDeductions += min($amount, 200000);
                    break;
                default:
                    $totalDeductions += $amount;
            }
        }

        $totalDeductions += min($section80Total, self::SECTION_80C_CAP);
        return $totalDeductions;
    }

    public function getCurrentFinancialYear(): string
    {
        $year = now()->year;
        $month = now()->month;
        if ($month < 4) {
            return ($year - 1) . '-' . substr($year, -2);
        }
        return $year . '-' . substr($year + 1, -2);
    }

    public static function formatCurrency(float $amount): string
    {
        return "\u{20B9}" . number_format($amount, 2);
    }

    public function calculatePT(float $gross, string $state = 'maharashtra'): float
    {
        $ptSlabs = [
            'maharashtra' => [
                ['min' => 0, 'max' => 10000, 'amount' => 0],
                ['min' => 10001, 'max' => 25000, 'amount' => 110],
                ['min' => 25001, 'max' => 50000, 'amount' => 200],
                ['min' => 50001, 'max' => 75000, 'amount' => 300],
                ['min' => 75001, 'max' => 100000, 'amount' => 350],
                ['min' => 100001, 'max' => PHP_FLOAT_MAX, 'amount' => 416],
            ],
            'karnataka' => [
                ['min' => 0, 'max' => 15000, 'amount' => 0],
                ['min' => 15001, 'max' => 20000, 'amount' => 150],
                ['min' => 20001, 'max' => 40000, 'amount' => 300],
                ['min' => 40001, 'max' => PHP_FLOAT_MAX, 'amount' => 400],
            ],
            'tamilnadu' => [
                ['min' => 0, 'max' => 21000, 'amount' => 0],
                ['min' => 21001, 'max' => 30000, 'amount' => 160],
                ['min' => 30001, 'max' => 45000, 'amount' => 300],
                ['min' => 45001, 'max' => 60000, 'amount' => 500],
                ['min' => 60001, 'max' => 75000, 'amount' => 700],
                ['min' => 75001, 'max' => PHP_FLOAT_MAX, 'amount' => 900],
            ],
        ];

        $slabs = $ptSlabs[$state] ?? $ptSlabs['maharashtra'];
        foreach ($slabs as $slab) {
            if ($gross >= $slab['min'] && $gross <= $slab['max']) {
                return (float) $slab['amount'];
            }
        }
        return 0;
    }

    public function calculateNewRegimeTax(float $annualIncome, array $exemptions = []): array
    {
        // New regime (Sec 115BAC): ONLY standard deduction of ₹75,000 is allowed.
        // No HRA, LTA, 80C, 80D, 24(b) etc. exemptions.
        $taxableIncome = max(0, $annualIncome - self::STANDARD_DEDUCTION_NEW);

        // New regime slabs (Sec 115BAC) — FY 2024-25, contiguous boundaries.
        // The rebate u/s 87A is on TOTAL income (annualIncome), not on taxable income.
        $slabs = [
            ['min' => 0,         'max' => 400000,    'rate' => 0],
            ['min' => 400000,    'max' => 800000,    'rate' => 0.05],
            ['min' => 800000,    'max' => 1200000,   'rate' => 0.10],
            ['min' => 1200000,   'max' => 1600000,   'rate' => 0.15],
            ['min' => 1600000,   'max' => 2000000,   'rate' => 0.20],
            ['min' => 2000000,   'max' => 2400000,   'rate' => 0.25],
            ['min' => 2400000,   'max' => PHP_FLOAT_MAX, 'rate' => 0.30],
        ];

        $tax = 0;
        foreach ($slabs as $slab) {
            if ($taxableIncome > $slab['min']) {
                $taxableInSlab = min($taxableIncome, $slab['max']) - $slab['min'];
                if ($taxableInSlab > 0) {
                    $tax += $taxableInSlab * $slab['rate'];
                }
            }
        }

        // 87A rebate: full tax rebate if TOTAL income (annualIncome) <= ₹12L.
        // Sec 87A reads "total income of the assessee ... does not exceed ₹12,00,000".
        $rebate = ($annualIncome <= self::REBATE_LIMIT_NEW) ? $tax : 0;
        $taxAfterRebate = max(0, $tax - $rebate);

        // Surcharge for income > ₹50L (capped at 25% for new regime)
        $surcharge = $this->calculateSurcharge($taxAfterRebate, $annualIncome, 'new');
        $taxWithSurcharge = $taxAfterRebate + $surcharge;

        // Health & Education Cess: 4% on (tax + surcharge)
        $cess = $taxWithSurcharge * self::HEALTH_EDUCATION_CESS;
        $totalTax = $taxWithSurcharge + $cess;

        return [
            'regime' => 'new',
            'taxable_income' => $taxableIncome,
            'tax_before_cess' => round($taxWithSurcharge, 2),
            'rebate_87a' => round($rebate, 2),
            'surcharge' => round($surcharge, 2),
            'cess' => round($cess, 2),
            'total_tax' => round($totalTax, 2),
            'effective_rate' => $annualIncome > 0 ? round($totalTax / $annualIncome * 100, 2) : 0,
        ];
    }

    public function calculateOldRegimeTax(float $annualIncome, array $exemptions = []): array
    {
        // Old regime: Chapter VI-A deductions + HRA exemption + Standard Deduction
        $section80c = min($exemptions['section_80c'] ?? 0, 150000);
        $section80d = min($exemptions['section_80d'] ?? 0, 25000);
        $section80dd = min($exemptions['section_80dd'] ?? 0, 75000);
        $section80ddb = min($exemptions['section_80ddb'] ?? 0, 40000);
        $section80e = $exemptions['section_80e'] ?? 0;
        $section80g = $exemptions['section_80g'] ?? 0;
        $section80gg = min($exemptions['section_80gg'] ?? 0, 60000);
        $section80tta = min($exemptions['section_80tta'] ?? 0, 10000);
        $section24b = min($exemptions['section_24b'] ?? 0, 200000);
        $npsDeduction = min($exemptions['section_80ccd'] ?? 0, 50000);
        $hraExemption = min($exemptions['hra_exemption'] ?? 0, $annualIncome); // computed externally

        $standardDeduction = self::STANDARD_DEDUCTION_OLD;
        $totalDeductions = $standardDeduction
            + $section80c + $section80d + $section80dd + $section80ddb
            + $section80e + $section80g + $section80gg + $section80tta
            + $section24b + $npsDeduction + $hraExemption;
        $taxableIncome = max(0, $annualIncome - $totalDeductions);

        // Old regime slabs — FY 2024-25, contiguous boundaries (the old
        // "+1" offsets caused fractional-rupee under-charges at slab edges).
        $slabs = [
            ['min' => 0,        'max' => 250000,     'rate' => 0],
            ['min' => 250000,   'max' => 500000,     'rate' => 0.05],
            ['min' => 500000,   'max' => 1000000,    'rate' => 0.20],
            ['min' => 1000000,  'max' => PHP_FLOAT_MAX, 'rate' => 0.30],
        ];

        $tax = 0;
        foreach ($slabs as $slab) {
            if ($taxableIncome > $slab['min']) {
                $taxableInSlab = min($taxableIncome, $slab['max']) - $slab['min'];
                if ($taxableInSlab > 0) {
                    $tax += $taxableInSlab * $slab['rate'];
                }
            }
        }

        // 87A rebate: max ₹12,500 if TOTAL income (annualIncome) <= ₹5L.
        // Sec 87A reads "total income of the assessee ... does not exceed ₹5,00,000".
        $rebate = ($annualIncome <= self::REBATE_LIMIT_OLD) ? min($tax, self::REBATE_MAX_OLD) : 0;
        $taxAfterRebate = max(0, $tax - $rebate);

        // Surcharge (up to 30% for income > ₹5Cr in old regime; capped at 25% for > ₹2Cr)
        $surcharge = $this->calculateSurcharge($taxAfterRebate, $annualIncome, 'old');
        $taxWithSurcharge = $taxAfterRebate + $surcharge;

        // Health & Education Cess: 4% on (tax + surcharge)
        $cess = $taxWithSurcharge * self::HEALTH_EDUCATION_CESS;
        $totalTax = $taxWithSurcharge + $cess;

        return [
            'regime' => 'old',
            'taxable_income' => $taxableIncome,
            'tax_before_cess' => round($taxWithSurcharge, 2),
            'rebate_87a' => round($rebate, 2),
            'surcharge' => round($surcharge, 2),
            'cess' => round($cess, 2),
            'total_tax' => round($totalTax, 2),
            'effective_rate' => $annualIncome > 0 ? round($totalTax / $annualIncome * 100, 2) : 0,
            'deductions_claimed' => [
                'standard_deduction' => $standardDeduction,
                '80c' => $section80c,
                '80d' => $section80d,
                '80dd' => $section80dd,
                '80ddb' => $section80ddb,
                '80e' => $section80e,
                '80g' => $section80g,
                '80gg' => $section80gg,
                '80tta' => $section80tta,
                '24b' => $section24b,
                '80ccd_nps' => $npsDeduction,
                'hra_exemption' => $hraExemption,
            ],
        ];
    }

    /**
     * Calculate HRA Exemption u/s 10(13A) for the OLD regime.
     *
     * HRA exemption is the minimum of:
     *  a) Actual HRA received
     *  b) 50% of basic (metro) or 40% of basic (non-metro) of salary
     *  c) Rent paid - 10% of basic salary
     *
     * @param float $hraReceived     Annual HRA received
     * @param float $basicAnnual     Annual basic salary
     * @param float $rentPaid        Annual rent paid
     * @param bool  $isMetroCity     True if metro (Mumbai/Delhi/Kolkata/Chennai)
     * @return float Annual HRA exemption
     */
    public function calculateHraExemption(
        float $hraReceived,
        float $basicAnnual,
        float $rentPaid,
        bool $isMetroCity = false
    ): float {
        $percent = $isMetroCity ? 0.50 : 0.40;
        $a = $hraReceived;
        $b = $basicAnnual * $percent;
        $c = max(0, $rentPaid - (0.10 * $basicAnnual));
        return min($a, $b, $c);
    }

    public function getFinancialYear(): string
    {
        return $this->getCurrentFinancialYear();
    }

    public function resolveSalaryFormula(int $templateId, array $context = []): array
    {
        return [];
    }
}
