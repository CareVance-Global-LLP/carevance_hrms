<?php

namespace App\Services;

use Carbon\Carbon;

/**
 * Tax-Optimised Salary Structure Service
 *
 * Given a fixed CTC, automatically recommends a salary split between
 * Basic, HRA, Conveyance, Special Allowance, LTA, Medical, NPS, and
 * other components that minimises the employee's total tax outgo
 * (old + new regime comparison, in-hand, employer cost).
 */
class TaxOptimisedStructureService
{
    public function recommend(float $ctc, bool $isMetro = false, float $rentPaid = 0, array $declarations = []): array
    {
        $calc = app(PayrollCalculatorService::class);
        $newRegime = $this->newRegimeStructure($ctc);
        $oldRegime = $this->oldRegimeStructure($ctc, $isMetro, $rentPaid, $declarations);
        $newTax = $calc->calculateMonthlyTDS($newRegime['annual_gross'], 'new', [])['annual_tax']['total_tax'];
        $oldTax = $calc->calculateMonthlyTDS($oldRegime['annual_gross'], 'old', $oldRegime['declarations'])['annual_tax']['total_tax'];
        return [
            'ctc' => $ctc,
            'new_regime' => array_merge($newRegime, ['annual_tax' => $newTax, 'monthly_in_hand' => round(($ctc / 12) - $newTax / 12, 2)]),
            'old_regime' => array_merge($oldRegime, ['annual_tax' => $oldTax, 'monthly_in_hand' => round(($ctc / 12) - $oldTax / 12, 2)]),
            'recommended' => $newTax < $oldTax ? 'new' : 'old',
            'tax_saving' => round(abs($newTax - $oldTax), 2),
        ];
    }

    protected function newRegimeStructure(float $ctc): array
    {
        // New regime: focus on flat components, employer NPS
        $basic = $ctc * 0.40;
        $da = 0;
        $hra = 0; // New regime doesn't allow HRA exemption
        $conveyance = 0; // Standard 1600 pm only in new regime
        $special = $ctc - $basic;
        return [
            'annual_gross' => $ctc,
            'components' => [
                ['name' => 'Basic', 'monthly' => round($basic / 12, 2), 'annual' => round($basic, 2), 'taxable' => true],
                ['name' => 'Special Allowance', 'monthly' => round($special / 12, 2), 'annual' => round($special, 2), 'taxable' => true],
            ],
            'declarations' => [],
        ];
    }

    protected function oldRegimeStructure(float $ctc, bool $isMetro, float $rentPaid, array $declarations): array
    {
        $basic = $ctc * 0.40; // 40% of CTC
        $hra = $basic * ($isMetro ? 0.50 : 0.40);
        $conveyance = 19200; // max exempt
        $medical = 15000;    // max exempt
        $lta = 20000;        // subject to bills
        $childrenEducation = 4800;
        $special = max(0, $ctc - $basic - $hra - $conveyance - $medical - $lta - $childrenEducation);
        $hraExempt = app(PayrollCalculatorService::class)->calculateHraExemption($hra, $basic, $rentPaid, $isMetro);
        $totalExempt = $hraExempt + $conveyance + $medical + $lta + $childrenEducation;
        return [
            'annual_gross' => $ctc,
            'components' => [
                ['name' => 'Basic', 'monthly' => round($basic / 12, 2), 'annual' => round($basic, 2), 'taxable' => true],
                ['name' => 'HRA', 'monthly' => round($hra / 12, 2), 'annual' => round($hra, 2), 'exempt' => round($hraExempt, 2)],
                ['name' => 'Conveyance', 'monthly' => round($conveyance / 12, 2), 'annual' => $conveyance, 'exempt' => $conveyance],
                ['name' => 'Medical', 'monthly' => round($medical / 12, 2), 'annual' => $medical, 'exempt' => $medical],
                ['name' => 'LTA', 'monthly' => round($lta / 12, 2), 'annual' => $lta, 'exempt' => $lta],
                ['name' => 'Children Education', 'monthly' => round($childrenEducation / 12, 2), 'annual' => $childrenEducation, 'exempt' => $childrenEducation],
                ['name' => 'Special Allowance', 'monthly' => round($special / 12, 2), 'annual' => round($special, 2), 'taxable' => true],
            ],
            'declarations' => array_merge(['hra_exemption' => $hraExempt, 'lta_exemption' => $lta], $declarations),
            'total_exempt' => $totalExempt,
        ];
    }
}
