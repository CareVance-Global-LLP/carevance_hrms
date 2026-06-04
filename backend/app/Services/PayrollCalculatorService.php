<?php

namespace App\Services;

use App\Models\EmployeeTaxDeclaration;
use App\Models\EmployeeTaxDeclarationItem;

/**
 * Payroll Calculator Service
 * 
 * Handles all Indian payroll calculations including:
 * - Salary component breakdown (CTC → Gross → Net)
 * - Employee PF contribution (12% of basic, capped)
 * - Employer PF contribution (12% of basic)
 * - ESI calculations (0.75% employee, 3.25% employer)
 * - Professional Tax (state-wise)
 * - TDS/Income Tax (New Tax Regime default)
 * - Gratuity provision
 * - Tax declaration exemptions (80C, 80D, etc.)
 */
class PayrollCalculatorService
{
    /**
     * PF Constants
     */
    const PF_WAGE_CAP = 15000;
    const EMPLOYEE_PF_RATE = 0.12;
    const EMPLOYER_PF_RATE = 0.12;
    const EPS_RATE = 0.0833;
    const EPF_RATE = 0.0367;

    /**
     * ESI Constants
     */
    const ESI_GROSS_THRESHOLD = 21000;
    const ESI_EMPLOYEE_RATE = 0.0075;
    const ESI_EMPLOYER_RATE = 0.0325;

    /**
     * Gratuity Constants
     */
    const GRATUITY_RATE = 0.0481;

    /**
     * Tax Constants (New Tax Regime FY 2025-26)
     */
    const STANDARD_DEDUCTION_NEW = 75000;
    const REBATE_LIMIT_NEW = 1200000;

    /**
     * Section 80C combined cap (80C + 80CCC + 80CCD1)
     */
    const SECTION_80C_CAP = 150000;
    const SECTION_80CCD1B_CAP = 50000;

    /**
     * Calculate complete payroll breakdown.
     * 
     * @param float $annualCtc Annual CTC
     * @param string $stateCode State code for PT calculation
     * @param bool $isMetroCity Is metro city (for HRA calculation)
     * @param string $taxRegime 'new' or 'old' (default: 'new')
     * @param array $customConfig Custom configuration (basic_percentage, hra_percentage, etc.)
     * @param float $annualTaxExemptions Total approved tax exemptions from Form 12BB declarations
     * @return array Complete payroll breakdown
     */
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

        // Step 3: Calculate Employer Contributions
        $employerContributions = $this->calculateEmployerContributions(
            $salaryComponents['basic'],
            $salaryComponents['gross']
        );

        // Step 4: Calculate Net Pay
        $totalDeductions = array_sum($employeeDeductions);
        $netPay = $salaryComponents['gross'] - $totalDeductions;

        // Step 5: Calculate Annual Values
        $annualGross = $salaryComponents['gross'] * 12;
        $annualNet = $netPay * 12;

        return [
            'monthly' => [
                'ctc' => round($monthlyCtc, 2),
                'gross' => round($salaryComponents['gross'], 2),
                'net' => round($netPay, 2),
                'total_deductions' => round($totalDeductions, 2),
            ],
            'annual' => [
                'ctc' => round($annualCtc, 2),
                'gross' => round($annualGross, 2),
                'net' => round($annualNet, 2),
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

    /**
     * Calculate salary components from CTC.
     * 
     * @param float $monthlyCtc Monthly CTC
     * @param array $config Configuration
     * @return array Salary components
     */
    protected function calculateSalaryComponents(float $monthlyCtc, array $config): array
    {
        // Basic = percentage of CTC (typically 40%)
        $basic = $monthlyCtc * $config['basic_percentage'];

        // HRA = percentage of Basic (50% metro, 40% non-metro)
        $hra = $basic * $config['hra_percentage_of_basic'];

        // Conveyance = fixed amount (₹1,600)
        $conveyance = $config['conveyance_allowance'];

        // Special Allowance = Balance
        // Gross = Basic + HRA + Conveyance + Special Allowance
        // Special = Gross - (Basic + HRA + Conveyance)
        // For simplicity, we calculate Special as: Gross - sum of fixed components
        $fixedComponents = $basic + $hra + $conveyance;

        // Calculate gross (without employer contributions for simplicity)
        // CTC = Gross + Employer PF + Gratuity
        // Gross = CTC - Employer PF - Gratuity
        $employerPf = $this->calculateEmployerPF($basic);
        $gratuity = $this->calculateGratuityProvision($basic);
        
        $gross = $monthlyCtc - $employerPf - $gratuity;
        
        $specialAllowance = max(0, $gross - $fixedComponents);

        return [
            'basic' => $basic,
            'hra' => $hra,
            'conveyance' => $conveyance,
            'special_allowance' => $specialAllowance,
            'gross' => $gross,
        ];
    }

    /**
     * Calculate employee deductions.
     * 
     * @param float $basic Monthly basic salary
     * @param float $gross Monthly gross salary
     * @param string $stateCode State code
     * @param float $annualCtc Annual CTC
     * @param string $taxRegime Tax regime
     * @param float $annualTaxExemptions Approved tax declaration exemptions
     * @return array Deductions
     */
    protected function calculateEmployeeDeductions(
        float $basic,
        float $gross,
        string $stateCode,
        float $annualCtc,
        string $taxRegime,
        float $annualTaxExemptions = 0
    ): array {
        $pf = $this->calculateEmployeePF($basic);
        $esi = $this->calculateEmployeeESI($gross);
        $pt = PTStateService::calculate($stateCode, $gross);
        $tds = $this->calculateMonthlyTDS($annualCtc, $taxRegime, $annualTaxExemptions);

        return [
            'pf' => $pf,
            'esi' => $esi,
            'pt' => $pt,
            'tds' => $tds,
        ];
    }

    /**
     * Calculate employer contributions.
     * 
     * @param float $basic Monthly basic
     * @param float $gross Monthly gross
     * @return array Employer contributions
     */
    protected function calculateEmployerContributions(float $basic, float $gross): array
    {
        // PF: 12% of basic (capped)
        $pf = $this->calculateEmployerPF($basic);

        // Split PF: 8.33% EPS, 3.67% EPF
        $pfWages = min($basic, self::PF_WAGE_CAP);
        $eps = $pfWages * self::EPS_RATE;
        $epf = $pfWages * self::EPF_RATE;

        // ESI: 3.25% of gross (if applicable)
        $esi = $this->calculateEmployerESI($gross);

        // Gratuity provision: 4.81% of basic
        $gratuity = $this->calculateGratuityProvision($basic);

        return [
            'pf' => $pf,
            'eps' => $eps,
            'epf' => $epf,
            'esi' => $esi,
            'gratuity' => $gratuity,
        ];
    }

    /**
     * Calculate Employee PF (12% of basic, capped).
     * 
     * @param float $basic Monthly basic
     * @return float PF amount
     */
    public function calculateEmployeePF(float $basic): float
    {
        $pfWages = min($basic, self::PF_WAGE_CAP);
        return $pfWages * self::EMPLOYEE_PF_RATE;
    }

    /**
     * Calculate Employer PF (12% of basic, capped).
     * 
     * @param float $basic Monthly basic
     * @return float PF amount
     */
    public function calculateEmployerPF(float $basic): float
    {
        $pfWages = min($basic, self::PF_WAGE_CAP);
        return $pfWages * self::EMPLOYER_PF_RATE;
    }

    /**
     * Calculate Gratuity provision (4.81% of basic).
     * 
     * @param float $basic Monthly basic
     * @return float Gratuity provision
     */
    public function calculateGratuityProvision(float $basic): float
    {
        return $basic * self::GRATUITY_RATE;
    }

    /**
     * Calculate actual gratuity on exit.
     * Formula: (Last drawn Basic + DA) × 15 × Years of service ÷ 26
     * 
     * @param float $lastBasic Last drawn basic
     * @param float $yearsOfService Years of service
     * @param float $dearnessAllowance DA (if any)
     * @return float Gratuity amount
     */
    public function calculateGratuityOnExit(float $lastBasic, float $yearsOfService, float $dearnessAllowance = 0): float
    {
        return (($lastBasic + $dearnessAllowance) * 15 * $yearsOfService) / 26;
    }

    /**
     * Calculate Employee ESI (0.75% of gross if ≤ ₹21,000).
     * 
     * @param float $gross Monthly gross
     * @return float ESI amount
     */
    public function calculateEmployeeESI(float $gross): float
    {
        if ($gross > self::ESI_GROSS_THRESHOLD) {
            return 0;
        }
        return $gross * self::ESI_EMPLOYEE_RATE;
    }

    /**
     * Calculate Employer ESI (3.25% of gross if ≤ ₹21,000).
     * 
     * @param float $gross Monthly gross
     * @return float ESI amount
     */
    public function calculateEmployerESI(float $gross): float
    {
        if ($gross > self::ESI_GROSS_THRESHOLD) {
            return 0;
        }
        return $gross * self::ESI_EMPLOYER_RATE;
    }

    /**
     * Calculate monthly TDS.
     * 
     * @param float $annualCtc Annual CTC
     * @param string $taxRegime 'new' or 'old'
     * @param float $annualTaxExemptions Approved tax declaration exemptions (80C, 80D, 24b, etc.)
     * @return float Monthly TDS
     */
    public function calculateMonthlyTDS(float $annualCtc, string $taxRegime = 'new', float $annualTaxExemptions = 0): float
    {
        // Estimate taxable income: CTC reduced by standard deduction and approved tax exemptions
        $standardDeduction = $taxRegime === 'new' ? self::STANDARD_DEDUCTION_NEW : 50000;
        $taxableIncome = max(0, $annualCtc - $standardDeduction - $annualTaxExemptions);

        if ($taxRegime === 'new') {
            $annualTax = $this->calculateNewRegimeTax($taxableIncome);
        } else {
            $annualTax = $this->calculateOldRegimeTax($taxableIncome);
        }

        return $annualTax / 12;
    }

    /**
     * Calculate tax under New Tax Regime (FY 2025-26).
     * 
     * @param float $taxableIncome Taxable income
     * @return float Annual tax
     */
    public function calculateNewRegimeTax(float $taxableIncome): float
    {
        // Standard deduction
        $taxableIncome = max(0, $taxableIncome - self::STANDARD_DEDUCTION_NEW);

        // Rebate u/s 87A
        if ($taxableIncome <= self::REBATE_LIMIT_NEW) {
            return 0;
        }

        $tax = 0;
        $remaining = $taxableIncome;

        // Slab rates
        $slabs = [
            ['limit' => 400000, 'rate' => 0],
            ['limit' => 800000, 'rate' => 0.05],
            ['limit' => 1200000, 'rate' => 0.10],
            ['limit' => 1600000, 'rate' => 0.15],
            ['limit' => 2000000, 'rate' => 0.20],
            ['limit' => 2400000, 'rate' => 0.25],
            ['limit' => null, 'rate' => 0.30],
        ];

        $previousLimit = 0;
        foreach ($slabs as $slab) {
            $currentLimit = $slab['limit'] ?? PHP_FLOAT_MAX;
            $slabAmount = min($remaining, $currentLimit - $previousLimit);
            
            if ($slabAmount <= 0) break;
            
            $tax += $slabAmount * $slab['rate'];
            $remaining -= $slabAmount;
            $previousLimit = $currentLimit;
        }

        // Health & Education Cess: 4%
        $tax *= 1.04;

        return $tax;
    }

    /**
     * Calculate tax under Old Tax Regime.
     * 
     * @param float $taxableIncome Taxable income
     * @return float Annual tax
     */
    public function calculateOldRegimeTax(float $taxableIncome): float
    {
        // Standard deduction (old regime): ₹50,000
        $taxableIncome = max(0, $taxableIncome - 50000);

        // Rebate u/s 87A: Zero tax if ≤ ₹5 lakh
        if ($taxableIncome <= 500000) {
            return 0;
        }

        $tax = 0;
        $remaining = $taxableIncome;

        // Slab rates
        $slabs = [
            ['limit' => 250000, 'rate' => 0],
            ['limit' => 500000, 'rate' => 0.05],
            ['limit' => 1000000, 'rate' => 0.20],
            ['limit' => null, 'rate' => 0.30],
        ];

        $previousLimit = 0;
        foreach ($slabs as $slab) {
            $currentLimit = $slab['limit'] ?? PHP_FLOAT_MAX;
            $slabAmount = min($remaining, $currentLimit - $previousLimit);
            
            if ($slabAmount <= 0) break;
            
            $tax += $slabAmount * $slab['rate'];
            $remaining -= $slabAmount;
            $previousLimit = $currentLimit;
        }

        // Health & Education Cess: 4%
        $tax *= 1.04;

        return $tax;
    }

    /**
     * Calculate HRA exemption.
     * (For Old Tax Regime only)
     * 
     * @param float $actualHra Actual HRA received
     * @param float $basic Monthly basic
     * @param float $rentPaid Annual rent paid
     * @param bool $isMetro Is metro city
     * @return float HRA exemption
     */
    public function calculateHRAExemption(
        float $actualHra,
        float $basic,
        float $rentPaid,
        bool $isMetro
    ): float {
        // Exemption = min of:
        // 1. Actual HRA
        // 2. Rent paid - 10% of basic
        // 3. 50% of basic (metro) / 40% of basic (non-metro)

        $hraExempt = min(
            $actualHra * 12, // Annual
            $rentPaid - ($basic * 12 * 0.10),
            $basic * 12 * ($isMetro ? 0.50 : 0.40)
        );

        return max(0, $hraExempt);
    }

    /**
     * Get approved tax declaration deductions for an employee in a financial year.
     * Computes total deductible amount with per-section caps per IT Act.
     * 
     * @param int $userId Employee user ID
     * @param string|null $financialYear Financial year (e.g. '2025-26'), defaults to current
     * @return float Total approved exemption amount
     */
    public function getApprovedTaxDeductions(int $userId, ?string $financialYear = null): float
    {
        $financialYear = $financialYear ?? $this->getCurrentFinancialYear();

        $declaration = EmployeeTaxDeclaration::where('user_id', $userId)
            ->where('financial_year', $financialYear)
            ->where('status', 'approved')
            ->first();

        if (!$declaration) {
            return 0;
        }

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
                    $totalDeductions += min($amount, 0.50 * $amount); // 50% for most
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
                case 'HRA':
                    break;
                case 'LTA':
                    break;
                default:
                    $totalDeductions += $amount;
            }
        }

        $totalDeductions += min($section80Total, self::SECTION_80C_CAP);

        return $totalDeductions;
    }

    /**
     * Get current financial year string (e.g. '2025-26').
     */
    public function getCurrentFinancialYear(): string
    {
        $year = now()->year;
        $month = now()->month;
        if ($month < 4) {
            return ($year - 1) . '-' . substr($year, -2);
        }
        return $year . '-' . substr($year + 1, -2);
    }

    /**
     * Format currency amount.
     * 
     * @param float $amount Amount
     * @return string Formatted amount
     */
    public static function formatCurrency(float $amount): string
    {
        return '₹' . number_format($amount, 2);
    }

    /**
     * Calculate LOP (Loss of Pay) deduction.
     * 
     * @param float $monthlyGross Monthly gross
     * @param int $lopDays Loss of pay days
     * @param int $workingDays Working days in month
     * @return float LOP deduction
     */
    public function calculateLOP(float $monthlyGross, int $lopDays, int $workingDays = 26): float
    {
        return ($monthlyGross / $workingDays) * $lopDays;
    }

    /**
     * Calculate pro-rated salary for new joiners.
     * 
     * @param float $monthlyGross Monthly gross
     * @param int $daysWorked Days worked
     * @param int $totalDays Total days in month
     * @return float Pro-rated salary
     */
    public function calculateProRatedSalary(float $monthlyGross, int $daysWorked, int $totalDays = 30): float
    {
        return ($monthlyGross / $totalDays) * $daysWorked;
    }
}
