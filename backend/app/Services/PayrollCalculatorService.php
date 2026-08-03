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

    /** New regime slabs (Sec 115BAC), FY 2024-25 — contiguous boundaries. */
    protected static function newRegimeSlabs(): array
    {
        return [
            ['min' => 0,       'max' => 400000,        'rate' => 0],
            ['min' => 400000,  'max' => 800000,        'rate' => 0.05],
            ['min' => 800000,  'max' => 1200000,       'rate' => 0.10],
            ['min' => 1200000, 'max' => 1600000,       'rate' => 0.15],
            ['min' => 1600000, 'max' => 2000000,       'rate' => 0.20],
            ['min' => 2000000, 'max' => 2400000,       'rate' => 0.25],
            ['min' => 2400000, 'max' => PHP_FLOAT_MAX, 'rate' => 0.30],
        ];
    }

    /** Old regime slabs, FY 2024-25 — contiguous boundaries. */
    protected static function oldRegimeSlabs(): array
    {
        return [
            ['min' => 0,       'max' => 250000,        'rate' => 0],
            ['min' => 250000,  'max' => 500000,        'rate' => 0.05],
            ['min' => 500000,  'max' => 1000000,       'rate' => 0.20],
            ['min' => 1000000, 'max' => PHP_FLOAT_MAX, 'rate' => 0.30],
        ];
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
