<?php

namespace App\Services;

use App\Models\SalaryFormula;
use App\Models\TaxDeclaration;
use App\Models\TaxDeductionProof;
use App\Models\EmployeePayrollTemplate;
use Carbon\Carbon;

class PayrollCalculatorService
{
    public function calculatePayroll(
        float $annualCtc,
        string $stateCode = 'maharashtra',
        bool $isMetroCity = true,
        string $taxRegime = 'new',
        array $customConfig = [],
        array $annualTaxExemptions = []
    ): array {
        $monthlyCtc = $annualCtc / 12;

        // Default config
        $basicPercentage = $customConfig['basic_percentage'] ?? 0.40;
        $hraPercentageOfBasic = $customConfig['hra_percentage_of_basic'] ?? 0.50;
        $conveyanceAllowance = $customConfig['conveyance_allowance'] ?? 1600;

        $pfEnabled = $customConfig['pf_enabled'] ?? true;
        $esiEnabled = $customConfig['esi_enabled'] ?? true;
        $ptEnabled = $customConfig['pt_enabled'] ?? true;
        $tdsEnabled = $customConfig['tds_enabled'] ?? true;

        // Build earnings
        $basic = round($monthlyCtc * $basicPercentage, 2);
        $hra = round($basic * $hraPercentageOfBasic, 2);
        $conveyance = (float) $conveyanceAllowance;
        $specialAllowance = round($monthlyCtc - $basic - $hra - $conveyance, 2);
        $gross = $basic + $hra + $conveyance + $specialAllowance;

        // Deductions
        $pfEmployee = $pfEnabled ? $this->calculateEmployeePF($basic) : 0;
        $esiEmployee = $esiEnabled && $gross <= 21000 ? round($gross * 0.0075, 2) : 0;
        $pt = $ptEnabled ? $this->calculatePT($gross, $stateCode) : 0;

        // TDS
        $annualGross = $gross * 12;
        if ($taxRegime === 'old') {
            $taxResult = $this->calculateOldRegimeTax($annualGross, $annualTaxExemptions);
        } else {
            $taxResult = $this->calculateNewRegimeTax($annualGross, $annualTaxExemptions);
        }
        $monthlyTds = $tdsEnabled ? round($taxResult['total_tax'] / 12, 2) : 0;

        $totalDeductions = round($pfEmployee + $esiEmployee + $pt + $monthlyTds, 2);
        $netPay = round($gross - $totalDeductions, 2);

        // Employer contributions
        $pfEmployer = $pfEnabled ? $this->calculateEmployerPF($basic) : 0;
        $eps = $pfEnabled ? round(min($basic, 15000) * 0.0833, 2) : 0;
        $epf = round($pfEmployer - $eps, 2);
        $esiEmployer = $esiEnabled && $gross <= 21000 ? round($gross * 0.0325, 2) : 0;
        $gratuity = round($basic * 0.0481, 2);

        $pfWages = min($basic, 15000);
        $pfCapApplied = $basic > 15000;

        return [
            'monthly' => [
                'ctc' => $monthlyCtc,
                'gross' => $gross,
                'net' => $netPay,
                'total_deductions' => $totalDeductions,
            ],
            'annual' => [
                'ctc' => $annualCtc,
                'gross' => round($gross * 12, 2),
                'net' => round($netPay * 12, 2),
            ],
            'components' => [
                'earnings' => [
                    'basic' => $basic,
                    'hra' => $hra,
                    'conveyance' => $conveyance,
                    'special_allowance' => $specialAllowance,
                ],
                'deductions' => [
                    'pf_employee' => $pfEmployee,
                    'esi_employee' => $esiEmployee,
                    'pt' => $pt,
                    'tds' => $monthlyTds,
                ],
                'employer_contributions' => [
                    'pf_employer' => $pfEmployer,
                    'eps' => $eps,
                    'epf' => $epf,
                    'esi_employer' => $esiEmployer,
                    'gratuity' => $gratuity,
                ],
            ],
            'breakdown' => [
                'pf_wages' => $pfWages,
                'pf_cap_applied' => $pfCapApplied,
                'esi_applicable' => $gross <= 21000,
                'tax_regime' => $taxRegime,
                'state_code' => $stateCode,
                'is_metro_city' => $isMetroCity,
            ],
        ];
    }

    public function calculateEmployeePF(float $basicWages): float
    {
        $wageBase = min($basicWages, 15000);
        return round($wageBase * 0.12, 2);
    }

    public function calculateEmployerPF(float $basicWages): float
    {
        $wageBase = min($basicWages, 15000);
        return round($wageBase * 0.12, 2);
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

    public function getApprovedTaxDeductions(int $userId): array
    {
        $declarations = TaxDeclaration::where('user_id', $userId)
            ->where('status', 'approved')
            ->where('financial_year', $this->getFinancialYear())
            ->get();

        $totalDeclared = 0;
        foreach ($declarations as $dec) {
            $amount = $dec->declared_amount;
            $proofs = TaxDeductionProof::where('tax_declaration_id', $dec->id)
                ->where('status', 'approved')
                ->sum('amount');
            $totalDeclared += min($amount, $proofs ?: $amount);
        }

        return [
            'section_80c' => $this->getDeductionBySection($declarations, '80c'),
            'section_80d' => $this->getDeductionBySection($declarations, '80d'),
            'section_80g' => $this->getDeductionBySection($declarations, '80g'),
            'section_24b' => $this->getDeductionBySection($declarations, '24b'),
            'section_80e' => $this->getDeductionBySection($declarations, '80e'),
            'section_80tta' => $this->getDeductionBySection($declarations, '80tta'),
            'section_80ccd' => $this->getDeductionBySection($declarations, '80ccd'),
            'total_declared' => $totalDeclared,
        ];
    }

    private function getDeductionBySection($declarations, string $section): float
    {
        return (float) $declarations->where('section', $section)->sum('approved_amount');
    }

    public function calculateNewRegimeTax(float $annualIncome, array $exemptions): array
    {
        $slabs = [
            ['min' => 0, 'max' => 400000, 'rate' => 0],
            ['min' => 400001, 'max' => 800000, 'rate' => 0.05],
            ['min' => 800001, 'max' => 1200000, 'rate' => 0.10],
            ['min' => 1200001, 'max' => 1600000, 'rate' => 0.15],
            ['min' => 1600001, 'max' => 2000000, 'rate' => 0.20],
            ['min' => 2000001, 'max' => 2400000, 'rate' => 0.25],
            ['min' => 2400001, 'max' => PHP_FLOAT_MAX, 'rate' => 0.30],
        ];

        $tax = 0;
        foreach ($slabs as $slab) {
            if ($annualIncome > $slab['min']) {
                $taxableInSlab = min($annualIncome, $slab['max']) - $slab['min'];
                if ($taxableInSlab > 0) {
                    $tax += $taxableInSlab * $slab['rate'];
                }
            }
        }

        $standardDeduction = 50000;
        $cess = $tax * 0.04;
        $totalTax = max(0, $tax - $standardDeduction) + $cess;

        return [
            'taxable_income' => max(0, $annualIncome - $standardDeduction),
            'tax_before_cess' => max(0, $tax - $standardDeduction),
            'cess' => $cess,
            'total_tax' => $totalTax,
            'effective_rate' => $annualIncome > 0 ? round($totalTax / $annualIncome * 100, 2) : 0,
        ];
    }

    public function calculateOldRegimeTax(float $annualIncome, array $exemptions): array
    {
        $section80c = min($exemptions['section_80c'] ?? 0, 150000);
        $section80d = min($exemptions['section_80d'] ?? 0, 25000);
        $section80g = $exemptions['section_80g'] ?? 0;
        $section24b = min($exemptions['section_24b'] ?? 0, 200000);
        $section80e = $exemptions['section_80e'] ?? 0;
        $npsDeduction = min($exemptions['section_80ccd'] ?? 0, 50000);

        $standardDeduction = 50000;
        $totalDeductions = $standardDeduction + $section80c + $section80d + $section80g + $section24b + $section80e + $npsDeduction;
        $taxableIncome = max(0, $annualIncome - $totalDeductions);

        $slabs = [
            ['min' => 0, 'max' => 250000, 'rate' => 0],
            ['min' => 250001, 'max' => 500000, 'rate' => 0.05],
            ['min' => 500001, 'max' => 1000000, 'rate' => 0.20],
            ['min' => 1000001, 'max' => PHP_FLOAT_MAX, 'rate' => 0.30],
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

        $rebate = ($taxableIncome <= 500000) ? min($tax, 12500) : 0;
        $taxAfterRebate = max(0, $tax - $rebate);
        $cess = $taxAfterRebate * 0.04;
        $totalTax = $taxAfterRebate + $cess;

        return [
            'taxable_income' => $taxableIncome,
            'tax_before_cess' => $taxAfterRebate,
            'rebate_87a' => $rebate,
            'cess' => $cess,
            'total_tax' => $totalTax,
            'effective_rate' => $annualIncome > 0 ? round($totalTax / $annualIncome * 100, 2) : 0,
            'deductions_claimed' => [
                '80c' => $section80c,
                '80d' => $section80d,
                '80g' => $section80g,
                '24b' => $section24b,
                '80e' => $section80e,
                '80ccd_nps' => $npsDeduction,
            ],
        ];
    }

    public function getFinancialYear(): string
    {
        $now = Carbon::now();
        $year = $now->year;
        $month = $now->month;
        return $month >= 4 ? "$year-" . ($year + 1) : ($year - 1) . "-$year";
    }

    public function calculateLeaveEncashment(int $leaveBalance, float $monthlyGross): float
    {
        $daysInMonth = 30;
        $dailyRate = $monthlyGross / $daysInMonth;
        return round($dailyRate * $leaveBalance, 2);
    }

    public function calculateGratuityForSettlement(float $basicSalary, float $yearsOfService): float
    {
        $gratuityPerYear = ($basicSalary * 15) / 26;
        return round($gratuityPerYear * $yearsOfService, 2);
    }

    public function resolveSalaryFormula(int $templateId, array $context = []): array
    {
        $formulas = SalaryFormula::where('is_active', true)->get();
        $resolved = [];

        foreach ($formulas as $formula) {
            $result = $this->evaluateFormula($formula->formula_expression, $context);
            $resolved[$formula->component_code] = $result;
        }

        return $resolved;
    }

    private function evaluateFormula(string $expression, array $context): float
    {
        $replacements = [
            '[Basic]' => $context['basic'] ?? 0,
            '[HRA]' => $context['hra'] ?? 0,
            '[Conveyance]' => $context['conveyance'] ?? 0,
            '[Medical]' => $context['medical'] ?? 0,
            '[Gross]' => $context['gross'] ?? 0,
            '[CTC]' => $context['ctc'] ?? 0,
            '[DA]' => $context['da'] ?? 0,
            '[PF_Wages]' => $context['pf_wages'] ?? 0,
        ];

        $evaluable = str_replace(array_keys($replacements), array_values($replacements), $expression);

        if (preg_match('/^[0-9+\-*\/.()\s]+$/', $evaluable)) {
            try {
                $result = eval("return $evaluable;");
                return round((float) $result, 2);
            } catch (\Throwable $e) {
                return 0;
            }
        }

        if (preg_match('/IF\s*\(([^,]+),([^,]+),([^)]+)\)/', $evaluable, $matches)) {
            $condition = trim($matches[1]);
            $trueVal = (float) trim($matches[2]);
            $falseVal = (float) trim($matches[3]);
            return $this->evaluateCondition($condition, $context) ? $trueVal : $falseVal;
        }

        return (float) $evaluable;
    }

    private function evaluateCondition(string $condition, array $context): bool
    {
        $operators = ['>=', '<=', '!=', '>', '<', '=='];
        $matchOp = null;
        foreach ($operators as $op) {
            if (str_contains($condition, $op)) {
                $matchOp = $op;
                break;
            }
        }

        if (!$matchOp) return (bool) $condition;

        $parts = explode($matchOp, $condition, 2);
        $left = trim($parts[0]);
        $right = trim($parts[1]);

        $leftVal = $context[$left] ?? (is_numeric($left) ? (float) $left : 0);
        $rightVal = $context[$right] ?? (is_numeric($right) ? (float) $right : 0);

        return match ($matchOp) {
            '>=' => $leftVal >= $rightVal,
            '<=' => $leftVal <= $rightVal,
            '!=' => $leftVal != $rightVal,
            '>' => $leftVal > $rightVal,
            '<' => $leftVal < $rightVal,
            '==' => $leftVal == $rightVal,
            default => true,
        };
    }
}
