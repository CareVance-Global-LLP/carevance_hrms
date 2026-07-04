<?php

namespace App\Services;

class TaxSimulatorService
{
    protected PayrollCalculatorService $calculator;

    public function __construct(PayrollCalculatorService $calculator)
    {
        $this->calculator = $calculator;
    }

    public function compareRegimes(float $annualCtc, array $exemptions = [], bool $isMetro = true): array
    {
        $newRegime = $this->calculator->calculateNewRegimeTax($annualCtc, $exemptions);
        $oldRegime = $this->calculator->calculateOldRegimeTax($annualCtc, $exemptions);

        $standardDeductionOld = 50000;
        $standardDeductionNew = 75000;

        $taxableOld = max(0, $annualCtc - $standardDeductionOld);
        $taxableNew = max(0, $annualCtc - $standardDeductionNew);

        $oldTax = $oldRegime['total_tax'] ?? 0;
        $newTax = $newRegime['total_tax'] ?? 0;

        return [
            'annual_ctc' => $annualCtc,
            'old_regime' => [
                'gross_income' => $annualCtc,
                'standard_deduction' => $standardDeductionOld,
                'taxable_income' => $taxableOld,
                'tax' => $oldTax,
                'cess' => $oldTax * 0.04,
                'total_tax' => $oldTax * 1.04,
                'take_home' => $annualCtc - ($oldTax * 1.04),
                'effective_rate' => $annualCtc > 0 ? round(($oldTax * 1.04 / $annualCtc) * 100, 2) : 0,
            ],
            'new_regime' => [
                'gross_income' => $annualCtc,
                'standard_deduction' => $standardDeductionNew,
                'taxable_income' => $taxableNew,
                'tax' => $newTax,
                'cess' => $newTax * 0.04,
                'total_tax' => $newTax * 1.04,
                'take_home' => $annualCtc - ($newTax * 1.04),
                'effective_rate' => $annualCtc > 0 ? round(($newTax * 1.04 / $annualCtc) * 100, 2) : 0,
            ],
            'difference' => ($oldTax * 1.04) - ($newTax * 1.04),
            'recommendation' => ($oldTax * 1.04) < ($newTax * 1.04) ? 'old' : 'new',
            'exemptions_applied' => $exemptions,
        ];
    }

    public function whatIfScenario(float $currentCtc, array $scenarios): array
    {
        $results = [];
        $baseline = $this->compareRegimes($currentCtc);

        foreach ($scenarios as $key => $scenario) {
            $newCtc = $scenario['ctc'] ?? $currentCtc;
            $exemptions = $scenario['exemptions'] ?? [];
            $results[$key] = [
                'label' => $scenario['label'] ?? $key,
                'ctc' => $newCtc,
                'comparison' => $this->compareRegimes($newCtc, $exemptions),
                'delta_from_current' => $newCtc - $currentCtc,
            ];
        }

        return [
            'baseline' => $baseline,
            'scenarios' => $results,
        ];
    }

    public function calculateMonthlyTakeHome(float $annualCtc, string $regime = 'new', array $exemptions = []): array
    {
        $comparison = $this->compareRegimes($annualCtc, $exemptions);
        $regimeData = $comparison[$regime === 'old' ? 'old_regime' : 'new_regime'];

        $monthlyGross = $annualCtc / 12;
        $monthlyTax = $regimeData['total_tax'] / 12;

        return [
            'monthly_gross' => round($monthlyGross, 2),
            'monthly_tax' => round($monthlyTax, 2),
            'monthly_take_home' => round($monthlyGross - $monthlyTax, 2),
            'annual_take_home' => round($regimeData['take_home'], 2),
            'effective_tax_rate' => $regimeData['effective_rate'],
        ];
    }

    public function calculateHraOptimization(float $basic, float $hraReceived, float $rentPaid, bool $isMetro): array
    {
        $actualHra = $hraReceived;
        $rentMinus10Basic = max(0, $rentPaid - (0.10 * $basic));
        $fiftyOrFortyPercent = $isMetro ? 0.50 * $basic : 0.40 * $basic;

        $exemption = min($actualHra, $rentMinus10Basic, $fiftyOrFortyPercent);
        $taxableHra = $hraReceived - $exemption;

        return [
            'hra_received' => $hraReceived,
            'actual_rent_paid' => $rentPaid,
            'rent_minus_10pct_basic' => $rentMinus10Basic,
            'fifty_or_forty_pct_basic' => $fiftyOrFortyPercent,
            'max_exemption' => $exemption,
            'taxable_hra' => max(0, $taxableHra),
            'recommended_rent' => $isMetro ? $basic * 0.60 : $basic * 0.50,
        ];
    }
}
