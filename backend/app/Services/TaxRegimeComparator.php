<?php

namespace App\Services;

use App\Models\EmployeeTaxDeclaration;

/**
 * Tax Regime Comparator
 *
 * Side-by-side comparison of Old vs New tax regime for an employee.
 * Determines which regime yields a lower tax liability given the
 * employee's actual declarations (HRA, 80C, 80D, etc.).
 *
 * Output drives an in-app "Regime Recommendation" widget.
 */
class TaxRegimeComparator
{
    public function compare(
        float $annualGross,
        array $declarations = [],
        float $hraReceived = 0,
        float $basicAnnual = 0,
        float $rentPaid = 0,
        bool $isMetro = false
    ): array {
        $calc = app(PayrollCalculatorService::class);

        // NEW regime: only standard deduction of 75K
        $newRegime = $calc->calculateMonthlyTDS($annualGross, 'new', [])['annual_tax'];

        // OLD regime: use full declarations
        $oldRegime = $calc->calculateMonthlyTDS(
            $annualGross,
            'old',
            array_merge($declarations, [
                'hra_exemption' => $calc->calculateHraExemption($hraReceived, $basicAnnual, $rentPaid, $isMetro),
            ])
        )['annual_tax'];

        $savings = (float) $oldRegime['total_tax'] - (float) $newRegime['total_tax'];
        $recommended = $savings > 0 ? 'new' : 'old';
        $savingPct = $oldRegime['total_tax'] > 0
            ? round(abs($savings) / $oldRegime['total_tax'] * 100, 1)
            : 0;

        return [
            'new_regime' => $newRegime,
            'old_regime' => $oldRegime,
            'recommended' => $recommended,
            'savings' => round(abs($savings), 2),
            'savings_pct' => $savingPct,
            'difference' => round($savings, 2),
            'insight' => $this->generateInsight($newRegime, $oldRegime, $recommended, $savings, $declarations),
        ];
    }

    protected function generateInsight(array $new, array $old, string $rec, float $savings, array $decl): string
    {
        $totalDecl = array_sum(array_intersect_key($decl, array_flip([
            'section_80c', 'section_80d', 'section_80ccd', 'section_24b', 'hra_exemption'
        ])));
        if ($totalDecl < 250000 && $rec === 'new') {
            return "Your current declarations (₹" . number_format($totalDecl) . ") are below the ₹2.5L threshold. The new regime is optimal because exemptions don't add value here.";
        }
        if ($rec === 'old') {
            return "Old regime saves you ₹" . number_format(abs($savings)) . " annually. Submit proofs for " . implode(', ', array_keys($decl)) . " to claim this benefit.";
        }
        return "Both regimes give similar tax outcomes. New regime has simpler compliance (no proof submission required).";
    }
}
