<?php

namespace App\Services;

use App\Models\EmployeeTaxDeclaration;
use App\Models\SalaryComponent;
use App\Models\SalaryFormula;
use Carbon\Carbon;

class PayrollCalculatorService
{
    private ?SalaryFormulaEngine $formulaEngine = null;

    public function setFormulaEngine(SalaryFormulaEngine $engine): void
    {
        $this->formulaEngine = $engine;
    }

    private function getFormulaEngine(): SalaryFormulaEngine
    {
        if (!$this->formulaEngine) {
            $this->formulaEngine = new SalaryFormulaEngine();
        }
        return $this->formulaEngine;
    }
    const PF_WAGE_CAP = 15000;
    const EMPLOYEE_PF_RATE = 0.12;
    const EMPLOYER_PF_RATE = 0.12;
    const EPS_RATE = 0.0833;
    const EPF_RATE = 0.0367;
    const ESI_GROSS_THRESHOLD = 21000;
    const ESI_EMPLOYEE_RATE = 0.0075;
    const ESI_EMPLOYER_RATE = 0.0325;
    const GRATUITY_RATE = 0.0481;
    /** Payment of Gratuity Act: nothing payable below five years of continuous service. */
    const GRATUITY_MIN_YEARS = 5;
    /** Statutory ceiling on a gratuity payout. */
    const GRATUITY_MAX_PAYOUT = 2000000;
    /*
     * FY 2025-26 figures. These were commented as FY 2024-25 while carrying
     * 2025-26 values — the ₹4L exemption, the ₹12L rebate limit and the 25%
     * band are all 2025-26. A label that disagrees with the numbers under it
     * is worse than none: the next person to apply a Finance Act trusts it and
     * edits the wrong year. Slabs are keyed by FY in TAX_SLABS_BY_FY below.
     */
    const STANDARD_DEDUCTION_NEW = 75000;
    const STANDARD_DEDUCTION_OLD = 50000;
    const REBATE_LIMIT_NEW = 1200000;
    const REBATE_LIMIT_OLD = 500000;
    const REBATE_MAX_OLD = 12500;
    const SECTION_80C_CAP = 150000;
    const SECTION_80CCD1B_CAP = 50000;
    const HEALTH_EDUCATION_CESS = 0.04;
    // Surcharge slabs (FY 2024-25).
    //
    // Boundaries are contiguous and half-open (min, max]. The previous table
    // used min values of 10000001 / 20000001 / 50000001, which left gaps: an
    // income of ₹1,00,00,000.50 matched no slab at all and attracted zero
    // surcharge instead of 15%.
    //
    // 'new_rate' is the Sec 115BAC cap — the new regime tops out at 25%,
    // whereas the old regime goes to 37% above ₹5Cr.
    const SURCHARGE_SLABS = [
        ['min' => 5000000,  'max' => 10000000,      'rate' => 0.10, 'new_rate' => 0.10],
        ['min' => 10000000, 'max' => 20000000,      'rate' => 0.15, 'new_rate' => 0.15],
        ['min' => 20000000, 'max' => 50000000,      'rate' => 0.25, 'new_rate' => 0.25],
        ['min' => 50000000, 'max' => PHP_FLOAT_MAX, 'rate' => 0.37, 'new_rate' => 0.25],
    ];

    /**
     * @param  float|array<string,float>  $annualTaxExemptions
     *         Prefer the per-section map from getApprovedTaxDeductionMap().
     *         A bare float is treated as 80C only and will be capped at 1.5L.
     */
    public function calculatePayroll(
        float $annualCtc,
        string $stateCode = 'maharashtra',
        bool $isMetroCity = false,
        string $taxRegime = 'new',
        array $customConfig = [],
        float|array $annualTaxExemptions = 0
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

    /**
     * Split a monthly cost-to-company into the employee's own earnings lines.
     *
     * Gross is CTC less the employer-side amounts, because employer PF and the
     * gratuity provision are the employer's cost, not the employee's wages —
     * Code on Wages s.2(y) excludes both from "wages". Treating gross as equal
     * to CTC pays those amounts to the employee as special allowance, so the
     * employer spends its whole CTC on wages and then funds PF and gratuity on
     * top of it.
     *
     * Public so every engine shares one definition. Three coexisted, and for a
     * ₹6,00,000 CTC they produced ₹50,000, ₹47,238 and ₹50,000 for the same
     * person in the same month.
     */
    public function calculateSalaryComponents(float $monthlyCtc, array $config): array
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

    /**
     * @param  float|array<string,float>  $annualTaxExemptions
     *         Either a per-section map (preferred, from
     *         getApprovedTaxDeductionMap()) or a bare float, which is treated
     *         as an 80C-only figure.
     */
    protected function calculateEmployeeDeductions(
        float $basic,
        float $gross,
        string $stateCode,
        float $annualCtc,
        string $taxRegime,
        float|array $annualTaxExemptions = 0
    ): array {
        // TDS must be calculated on GROSS SALARY (CTC - employer PF - gratuity)
        // not on CTC, because employer-side contributions are not the employee's
        // taxable income. Both regimes use the same gross definition.
        $annualGross = max(0, $gross * 12);

        // Exemptions only used for OLD regime. For NEW regime, only standard
        // deduction applies.
        //
        // A bare float lands entirely in section_80c, which calculateOldRegimeTax
        // then caps at 1.5L. Callers that pass the SUM of every section that way
        // silently lose everything above the 80C cap — an employee with 1.5L of
        // 80C plus 2L of home-loan interest got 1.5L of relief instead of 3.5L,
        // roughly 60,000/yr of excess TDS. Pass the per-section map instead.
        $exemptions = [];
        if ($taxRegime === 'old') {
            $exemptions = is_array($annualTaxExemptions)
                ? $annualTaxExemptions
                : ['section_80c' => $annualTaxExemptions];
        }

        $tds = $this->calculateMonthlyTDS($annualGross, $taxRegime, $exemptions);

        return [
            'pf' => $this->calculateEmployeePF($basic),
            'esi' => $this->calculateEmployeeESI($gross),
            'pt' => PTStateService::calculate($stateCode, $gross),
            'tds' => $tds['monthly_tds'],
        ];
    }

    public function calculateEmployerContributions(float $basic, float $gross): array
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

    /**
     * PF wages = basic + DA, capped at the statutory wage ceiling unless the
     * employer has opted in to contributing above it.
     *
     * Callers must pass $aboveCap explicitly. They previously signalled
     * "above the cap" by passing PHP_FLOAT_MAX as $basic, which the min()
     * below then clamped straight back to the ceiling — so opting in produced
     * a flat 1,800/month for everyone, and over-deducted from anyone whose
     * basic was under 15,000.
     */
    public function pfWages(float $basic, float $dearnessAllowance = 0, bool $aboveCap = false): float
    {
        $wages = max(0, $basic + $dearnessAllowance);

        return $aboveCap ? $wages : min($wages, self::PF_WAGE_CAP);
    }

    public function calculateEmployeePF(float $basic, float $dearnessAllowance = 0, bool $aboveCap = false): float
    {
        return $this->pfWages($basic, $dearnessAllowance, $aboveCap) * self::EMPLOYEE_PF_RATE;
    }

    public function calculateEmployerPF(float $basic, float $dearnessAllowance = 0, bool $aboveCap = false): float
    {
        return $this->pfWages($basic, $dearnessAllowance, $aboveCap) * self::EMPLOYER_PF_RATE;
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
     * Gratuity payable in a full-and-final settlement.
     *
     * Differs from calculateGratuityOnExit in the two ways the Payment of
     * Gratuity Act requires and a raw formula does not express: nothing is
     * payable below five years of continuous service, and the statutory ceiling
     * caps the payout.
     */
    public function calculateGratuityForSettlement(
        float $lastBasic,
        float $yearsOfService,
        float $dearnessAllowance = 0,
    ): float {
        if ($yearsOfService < self::GRATUITY_MIN_YEARS) {
            return 0.0;
        }

        return min(
            $this->calculateGratuityOnExit($lastBasic, $yearsOfService, $dearnessAllowance),
            self::GRATUITY_MAX_PAYOUT,
        );
    }

    /** Dearness Allowance: a percentage of basic. */
    public function calculateDA(float $basic, float $daPercentage): float
    {
        return round(($basic * $daPercentage) / 100, 2);
    }

    /**
     * City Compensatory Allowance. Rates step down by city tier because the
     * allowance exists to offset cost of living.
     */
    public function calculateCCA(float $basic, float $dearnessAllowance = 0, string $cityTier = 'other'): float
    {
        $rate = match ($cityTier) {
            'metro_a', 'metro', 'x' => 0.06,
            'metro_b', 'y' => 0.04,
            default => 0.02,
        };

        return round(($basic + $dearnessAllowance) * $rate, 2);
    }

    /** Encashment of an unused leave balance at the daily rate. */
    public function calculateLeaveEncashment(float $leaveBalanceDays, float $monthlyGross, int $workingDays = 26): float
    {
        if ($leaveBalanceDays <= 0 || $monthlyGross <= 0) {
            return 0.0;
        }

        $workingDays = max(1, $workingDays);

        return round(($monthlyGross / $workingDays) * $leaveBalanceDays, 2);
    }

    /** Back-pay owed after a retrospective salary revision. */
    public function calculateArrears(float $originalSalary, float $revisedSalary, int $months): float
    {
        if ($months <= 0) {
            return 0.0;
        }

        return round(($revisedSalary - $originalSalary) * $months, 2);
    }

    /** National Pension System contribution. */
    public function calculateNPS(float $basic, float $dearnessAllowance = 0, float $percentage = 10): float
    {
        if ($percentage <= 0) {
            return 0.0;
        }

        return round((($basic + $dearnessAllowance) * $percentage) / 100, 2);
    }

    /**
     * Recovery for notice the employee did not serve. Only the unserved portion
     * is recoverable — charging the full notice period regardless of days served
     * is a common and expensive error.
     */
    public function calculateNoticePayRecovery(float $monthlyGross, int $noticePeriodDays, int $servedDays): float
    {
        $unservedDays = max(0, $noticePeriodDays - max(0, $servedDays));

        if ($unservedDays <= 0 || $noticePeriodDays <= 0) {
            return 0.0;
        }

        return round(($monthlyGross / $noticePeriodDays) * $unservedDays, 2);
    }

    /** Premium paid on night and weekend hours, on top of the base hourly rate. */
    public function calculateShiftDifferential(
        float $hourlyRate,
        float $nightHours = 0,
        float $weekendHours = 0,
        float $nightDifferentialPercentage = 10,
        float $weekendDifferentialPercentage = 25,
    ): float {
        $night = $hourlyRate * ($nightDifferentialPercentage / 100) * max(0, $nightHours);
        $weekend = $hourlyRate * ($weekendDifferentialPercentage / 100) * max(0, $weekendHours);

        return round($night + $weekend, 2);
    }

    /**
     * Voluntary Provident Fund: an employee-chosen percentage of basic, over and
     * above the statutory 12%. Unlike the statutory contribution it is not
     * subject to the wage ceiling.
     */
    public function calculateVPF(float $basic, float $vpfPercentage): float
    {
        if ($vpfPercentage <= 0 || $basic <= 0) {
            return 0.0;
        }

        return round(($basic * $vpfPercentage) / 100, 2);
    }

    /**
     * Net pay from its components.
     */
    public function calculateNetSalary(
        float $basicSalary,
        float $allowances = 0,
        float $bonus = 0,
        float $deductions = 0,
        float $tax = 0,
    ): float {
        return (float) ($basicSalary + $allowances + $bonus - $deductions - $tax);
    }

    /**
     * The non-formula payroll path: fixed monthly, hourly, or hybrid.
     *
     * Loss of pay is reported both ways on purpose. `base_pay` is what the
     * employee actually earned (already reduced by LOP), because that is the
     * number a payslip shows; `lop_deduction` is carried in `deductions` so the
     * gross-to-net breakdown reconciles. Reporting only one of the two is what
     * makes payslips and payroll registers disagree.
     *
     * @param array<string, mixed> $config Salary configuration for the employee
     * @param array<string, mixed> $inputs Period inputs (attendance, adjustments)
     * @return array<string, mixed>
     */
    public function calculateSimplePayroll(array $config, array $inputs = []): array
    {
        $salaryType = (string) ($config['salary_type'] ?? 'fixed_monthly');
        $monthlySalary = (float) ($config['monthly_salary'] ?? 0);
        $workingDays = max(1, (int) ($config['working_days'] ?? 30));

        $unpaidLeaveDays = max(0.0, (float) ($inputs['unpaid_leave_days'] ?? 0));
        $warnings = [];

        if ($salaryType === 'hourly') {
            $hourlyRate = (float) ($config['hourly_rate'] ?? 0);
            $workedHours = max(0.0, (float) ($inputs['approved_worked_hours'] ?? 0));

            $basePay = $hourlyRate * $workedHours;
            $lopDeduction = 0.0;
            $grossBase = $basePay;
        } else {
            $perDay = $monthlySalary / $workingDays;
            $lopDeduction = round($perDay * $unpaidLeaveDays, 2);
            $basePay = round($monthlySalary - $lopDeduction, 2);
            // Gross is built from the FULL monthly salary and LOP is taken as a
            // deduction, so gross - deductions == net.
            $grossBase = $monthlySalary;
        }

        $overtime = $salaryType === 'hourly'
            ? 0.0
            : round((float) ($config['overtime_hourly_rate'] ?? 0) * (float) ($inputs['overtime_hours'] ?? 0), 2);

        $productivityBonus = 0.0;
        if (! empty($config['productivity_bonus_enabled'])) {
            $productivityBonus = round(
                (float) ($config['productivity_bonus_rate'] ?? 0) * (float) ($inputs['approved_productive_hours'] ?? 0),
                2,
            );
        }

        $bonus = (float) ($inputs['bonus'] ?? 0);
        $reimbursement = (float) ($inputs['reimbursement'] ?? 0);

        $grossPay = round($grossBase + $overtime + $productivityBonus + $bonus + $reimbursement, 2);

        $deductions = round(
            (float) ($inputs['manual_deduction'] ?? 0)
            + (float) ($inputs['other_deduction'] ?? 0)
            + $lopDeduction,
            2,
        );

        $netPay = round($grossPay - $deductions, 2);

        if ($netPay < 0) {
            $warnings[] = 'Negative calculated pay';
        }

        return [
            'salary_type' => $salaryType,
            'base_pay' => (float) $basePay,
            'lop_deduction' => (float) $lopDeduction,
            'overtime' => (float) $overtime,
            'productivity_bonus' => (float) $productivityBonus,
            'bonus' => (float) $bonus,
            'reimbursement' => (float) $reimbursement,
            'gross_pay' => (float) $grossPay,
            'deductions' => (float) $deductions,
            'net_pay' => (float) $netPay,
            'warnings' => $warnings,
            'status' => $warnings === [] ? 'ok' : 'exception',
        ];
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
    /**
     * Surcharge on tax for high-income individuals (FY 2024-25).
     *
     * $totalIncome must be TOTAL income — i.e. income after Chapter VI-A
     * deductions and the standard deduction — not gross salary. Passing gross
     * here overstates surcharge for anyone with meaningful deductions.
     *
     * Marginal relief is applied: the surcharge is capped so that the increase
     * in total tax never exceeds the income in excess of the threshold. Without
     * it there is a cliff at each boundary where earning ₹1 more costs lakhs.
     */
    protected function calculateSurcharge(float $taxBeforeSurcharge, float $totalIncome, string $regime): float
    {
        if ($totalIncome <= 5000000) {
            return 0.0;
        }

        $surchargeRate = 0.0;
        $threshold = 0.0;
        foreach (self::SURCHARGE_SLABS as $slab) {
            if ($totalIncome > $slab['min'] && $totalIncome <= $slab['max']) {
                $surchargeRate = $regime === 'new' ? $slab['new_rate'] : $slab['rate'];
                $threshold = (float) $slab['min'];
                break;
            }
        }

        if ($surchargeRate <= 0.0) {
            return 0.0;
        }

        $surcharge = $taxBeforeSurcharge * $surchargeRate;

        // Marginal relief: total tax may not rise by more than the excess
        // income over the slab threshold.
        $taxAtThreshold = $this->taxOnIncome($threshold, $regime);
        $excessIncome = $totalIncome - $threshold;
        $maxPayable = $taxAtThreshold + $excessIncome;

        if (($taxBeforeSurcharge + $surcharge) > $maxPayable) {
            $surcharge = max(0.0, $maxPayable - $taxBeforeSurcharge);
        }

        return $surcharge;
    }

    /**
     * Slab tax on a given TAXABLE income, before rebate/surcharge/cess.
     * Used by the marginal-relief calculation above.
     */
    protected function taxOnIncome(float $taxableIncome, string $regime): float
    {
        $slabs = $regime === 'new' ? self::newRegimeSlabs() : self::oldRegimeSlabs();

        return $this->applySlabs($taxableIncome, $slabs);
    }

    /**
     * Walk a contiguous slab table and total the tax.
     *
     * @param  array<int,array{min:float|int,max:float|int,rate:float}>  $slabs
     */
    protected function applySlabs(float $taxableIncome, array $slabs): float
    {
        $tax = 0.0;
        foreach ($slabs as $slab) {
            if ($taxableIncome > $slab['min']) {
                $taxableInSlab = min($taxableIncome, $slab['max']) - $slab['min'];
                if ($taxableInSlab > 0) {
                    $tax += $taxableInSlab * $slab['rate'];
                }
            }
        }

        return $tax;
    }

    /**
     * Financial year (start year) covering a calendar date.
     *
     * The Indian FY runs 1 April to 31 March, so January to March belong to
     * the year before: March 2026 is FY 2025-26.
     */
    public static function financialYearFor(?\DateTimeInterface $date = null): int
    {
        $date = $date ? \Carbon\Carbon::parse($date) : now();

        return (int) ($date->month >= 4 ? $date->year : $date->year - 1);
    }

    /**
     * Slabs by financial year, keyed by FY start year: 2025 is FY 2025-26.
     *
     * Adding next year's rates is a new entry here. Boundaries are contiguous
     * and half-open (min, max] — the earlier table used min values of
     * 400001 / 800001 and so on, which left an income landing exactly on a
     * boundary matching no slab at all.
     */
    private const TAX_SLABS_BY_FY = [
        2025 => [
            // Sec 115BAC. ₹4,00,000 exemption and the 25% band are FY 2025-26.
            'new' => [
                ['min' => 0,       'max' => 400000,        'rate' => 0],
                ['min' => 400000,  'max' => 800000,        'rate' => 0.05],
                ['min' => 800000,  'max' => 1200000,       'rate' => 0.10],
                ['min' => 1200000, 'max' => 1600000,       'rate' => 0.15],
                ['min' => 1600000, 'max' => 2000000,       'rate' => 0.20],
                ['min' => 2000000, 'max' => 2400000,       'rate' => 0.25],
                ['min' => 2400000, 'max' => PHP_FLOAT_MAX, 'rate' => 0.30],
            ],
            'old' => [
                ['min' => 0,       'max' => 250000,        'rate' => 0],
                ['min' => 250000,  'max' => 500000,        'rate' => 0.05],
                ['min' => 500000,  'max' => 1000000,       'rate' => 0.20],
                ['min' => 1000000, 'max' => PHP_FLOAT_MAX, 'rate' => 0.30],
            ],
        ],
    ];

    /** The most recent year we hold rates for. */
    private static function latestKnownFinancialYear(): int
    {
        return max(array_keys(self::TAX_SLABS_BY_FY));
    }

    /**
     * Slabs for a regime and financial year.
     *
     * An unknown year falls back to the latest rates we hold rather than
     * returning nothing, so a run in a future FY still taxes at plausible
     * rates instead of silently deducting zero. Update TAX_SLABS_BY_FY each
     * Finance Act.
     */
    protected static function slabsFor(string $regime, ?int $financialYear = null): array
    {
        $year = $financialYear ?? self::financialYearFor();
        $table = self::TAX_SLABS_BY_FY[$year] ?? self::TAX_SLABS_BY_FY[self::latestKnownFinancialYear()];

        return $table[$regime];
    }

    /** New regime slabs (Sec 115BAC) — contiguous boundaries. */
    protected static function newRegimeSlabs(?int $financialYear = null): array
    {
        return self::slabsFor('new', $financialYear);
    }

    /** Old regime slabs — contiguous boundaries. */
    protected static function oldRegimeSlabs(?int $financialYear = null): array
    {
        return self::slabsFor('old', $financialYear);
    }

    /**
     * Loss-of-pay deduction. Guards the divisor — callers pass working-day
     * counts derived from calendars and a zero there used to surface as an
     * uncaught DivisionByZeroError (HTTP 500) mid pay run.
     */
    public function calculateLOP(float $monthlyGross, int $lopDays, int $workingDays = 26): float
    {
        if ($workingDays <= 0 || $lopDays <= 0) {
            return 0.0;
        }

        // Never withhold more than the full month's gross.
        return min($monthlyGross, ($monthlyGross / $workingDays) * $lopDays);
    }

    public function calculateProRatedSalary(float $monthlyGross, int $daysWorked, int $totalDays = 30): float
    {
        if ($totalDays <= 0 || $daysWorked <= 0) {
            return 0.0;
        }

        return min($monthlyGross, ($monthlyGross / $totalDays) * $daysWorked);
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
                    // 80G is 50% or 100% deductible depending on the donee.
                    // `min($amount, $amount * 0.50)` was always just half, and
                    // the min() made the intent look like a cap when it wasn't.
                    // Default to the conservative 50% band; a 100% band needs
                    // the donee category, which the declaration item does not
                    // currently carry.
                    $totalDeductions += $amount * 0.50;
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

    /**
     * Per-section approved tax deductions, keyed by section code.
     * Used by the auto-process engine when calling the tax calculators
     * (which expect a map, not a flat float total).
     */
    public function getApprovedTaxDeductionMap(int $userId, ?string $financialYear = null): array
    {
        $financialYear = $financialYear ?? $this->getCurrentFinancialYear();

        $declaration = EmployeeTaxDeclaration::where('user_id', $userId)
            ->where('financial_year', $financialYear)
            ->where('status', 'approved')
            ->first();

        if (!$declaration) return [];

        $items = $declaration->items()->where('status', 'approved')->get();

        // Keys MUST match what calculateOldRegimeTax() reads, i.e. the
        // 'section_80c' form. This previously emitted bare '80c' keys while
        // the calculator looked up 'section_80c', so every approved
        // declaration silently evaluated to zero and employees were taxed as
        // though they had declared nothing.
        $bySection = [];
        foreach ($items as $item) {
            $amount = (float) $item->approved_amount;
            if ($amount <= 0) continue;

            $key = self::exemptionKey((string) $item->section);
            $bySection[$key] = ($bySection[$key] ?? 0) + $amount;
        }

        return $bySection;
    }

    /**
     * Normalise a declaration section code ('80C', '80c', '24B', 'section_80c')
     * to the single canonical key the tax calculators read: 'section_80c'.
     */
    public static function exemptionKey(string $section): string
    {
        $normalized = strtolower(trim($section));
        $normalized = preg_replace('/^section[_\s-]*/', '', $normalized) ?? $normalized;

        return 'section_' . $normalized;
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

    /**
     * Compute Professional Tax for a given monthly gross and state.
     *
     * DEPRECATED wrapper — kept only because PayrollAutoProcessService
     * still calls it. New code should call PTStateService::calculate()
     * directly; this method now just delegates to keep the public
     * surface stable. The previously-hardcoded slabs for 3 states were
     * removed because they had drifted from the official rates.
     */
    public function calculatePT(float $gross, string $state = 'maharashtra', ?int $month = null): float
    {
        // $month must be threaded through for states with a special-month
        // instalment (Maharashtra's higher February PT). Omitting it silently
        // under-collects: 12 x 200 = 2,400 against the 2,500 statutory annual
        // figure, leaving a shortfall plus interest on the PT return.
        return PTStateService::calculate($state, $gross, $month);
    }

    public function calculateNewRegimeTax(float $annualIncome, array $exemptions = []): array
    {
        // New regime (Sec 115BAC): ONLY standard deduction of ₹75,000 is allowed.
        // No HRA, LTA, 80C, 80D, 24(b) etc. exemptions.
        $taxableIncome = max(0, $annualIncome - self::STANDARD_DEDUCTION_NEW);

        $tax = $this->applySlabs($taxableIncome, self::newRegimeSlabs());

        // 87A rebate: full rebate when TOTAL income <= ₹12L.
        //
        // "Total income" in Sec 87A is the income chargeable to tax — i.e.
        // income AFTER the standard deduction — not gross salary. This
        // previously compared against gross, so an employee on ₹12.5L gross
        // (₹11.75L taxable, legally nil tax) was charged roughly ₹70,000.
        //
        // Marginal relief also applies just above the threshold: tax may not
        // exceed the amount by which taxable income overshoots ₹12L.
        if ($taxableIncome <= self::REBATE_LIMIT_NEW) {
            $rebate = $tax;
        } else {
            $excess = $taxableIncome - self::REBATE_LIMIT_NEW;
            $rebate = $tax > $excess ? $tax - $excess : 0.0;
        }
        $taxAfterRebate = max(0, $tax - $rebate);

        // Surcharge for income > ₹50L, assessed on total (taxable) income.
        $surcharge = $this->calculateSurcharge($taxAfterRebate, $taxableIncome, 'new');
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
        $section80ttb = min($exemptions['section_80ttb'] ?? 0, 50000);
        $section24b = min($exemptions['section_24b'] ?? 0, 200000);
        // Declarations may arrive under either the 80CCD(1B) code or the
        // shorter 80CCD form; both mean the additional NPS deduction.
        $npsDeduction = min(
            ($exemptions['section_80ccd1b'] ?? 0) ?: ($exemptions['section_80ccd'] ?? 0),
            self::SECTION_80CCD1B_CAP
        );
        $hraExemption = min($exemptions['hra_exemption'] ?? 0, $annualIncome); // computed externally

        $standardDeduction = self::STANDARD_DEDUCTION_OLD;
        $totalDeductions = $standardDeduction
            + $section80c + $section80d + $section80dd + $section80ddb
            + $section80e + $section80g + $section80gg + $section80tta + $section80ttb
            + $section24b + $npsDeduction + $hraExemption;
        $taxableIncome = max(0, $annualIncome - $totalDeductions);

        $tax = $this->applySlabs($taxableIncome, self::oldRegimeSlabs());

        // 87A rebate: up to ₹12,500 when TOTAL income <= ₹5L. As in the new
        // regime, "total income" means income after deductions, not gross.
        $rebate = ($taxableIncome <= self::REBATE_LIMIT_OLD)
            ? min($tax, self::REBATE_MAX_OLD)
            : 0;
        $taxAfterRebate = max(0, $tax - $rebate);

        // Surcharge (up to 37% above ₹5Cr in the old regime), assessed on
        // total (taxable) income with marginal relief.
        $surcharge = $this->calculateSurcharge($taxAfterRebate, $taxableIncome, 'old');
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
                '80ttb' => $section80ttb,
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

    /**
     * Resolve formula-based salary components for an organization.
     *
     * Fetches active SalaryComponent records that have an associated
     * SalaryFormula, evaluates each formula against the provided context
     * (basic, hra, gross, etc.), and returns an array of resolved values
     * keyed by component code.
     *
     * @param int   $organizationId
     * @param array $context  ['basic' => x, 'hra' => y, 'gross' => z, ...]
     * @return array ['BASIC' => 50000, 'HRA' => 25000, ...]
     */
    public function resolveSalaryFormula(int $organizationId, array $context = []): array
    {
        $engine = $this->getFormulaEngine();

        // Load active components that have formulas
        $components = SalaryComponent::where('organization_id', $organizationId)
            ->where('is_active', true)
            ->whereHas('formulas', function ($q) {
                $q->where('is_active', true);
            })
            ->with(['formulas' => function ($q) {
                $q->where('is_active', true)->orderBy('id');
            }])
            ->get();

        if ($components->isEmpty()) {
            return [];
        }

        // Build variable context for the formula engine
        $variables = [
            'CTC'         => $context['ctc'] ?? 0,
            'MonthlyCTC'  => ($context['ctc'] ?? 0) / 12,
            'Basic'       => $context['basic'] ?? 0,
            'HRA'         => $context['hra'] ?? 0,
            'Conveyance'  => $context['conveyance'] ?? 0,
            'Medical'     => $context['medical'] ?? 0,
            'Special'     => $context['special_allowance'] ?? 0,
            'Gross'       => $context['gross'] ?? 0,
            'BasicPct'    => $context['basic_percentage'] ?? 40,
            'HRAPct'      => $context['hra_percentage'] ?? 50,
            'PF'          => $context['pf'] ?? 0,
            'ESI'         => $context['esi'] ?? 0,
            'PT'          => $context['pt'] ?? 0,
            'TDS'         => $context['tds'] ?? 0,
            'NetPay'      => $context['net_pay'] ?? 0,
            'LOP'         => $context['lop_days'] ?? 0,
            'WorkingDays' => $context['working_days'] ?? 26,
            'PresentDays' => $context['days_present'] ?? 0,
        ];

        $engine->setVariables($variables);

        $resolved = [];
        foreach ($components as $component) {
            $formula = $component->formulas->first();
            if (!$formula) {
                continue;
            }

            try {
                $value = $engine->evaluate($formula->formula_expression);
                $resolved[$component->code] = [
                    'id'       => $component->id,
                    'name'     => $component->name,
                    'code'     => $component->code,
                    'category' => $component->category,
                    'value'    => round($value, 2),
                ];
            } catch (\Throwable $e) {
                // A component that fails to evaluate must not be silently
                // dropped — that yields a payslip missing a salary line with
                // nobody aware of it. Surface it so the run stops and the
                // formula gets fixed.
                throw new \RuntimeException(
                    "Salary formula for component {$component->code} could not be evaluated: "
                    . $e->getMessage(),
                    0,
                    $e
                );
            }
        }

        return $resolved;
    }
}
