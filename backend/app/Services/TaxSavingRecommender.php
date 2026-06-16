<?php

namespace App\Services;

use App\Models\EmployeeTaxDeclaration;
use App\Models\Employee;
use Carbon\Carbon;

/**
 * Tax Saving Recommender
 *
 * Given an employee's current declarations and projected gross income,
 * recommend additional investments to reduce tax liability.
 *
 * Uses the marginal tax rate to compute the "saving per rupee invested"
 * for each eligible section.
 */
class TaxSavingRecommender
{
    public function recommend(int $userId): array
    {
        $decl = EmployeeTaxDeclaration::with('items')
            ->where('user_id', $userId)
            ->where('financial_year', $this->currentFY())
            ->where('status', 'approved')
            ->first();
        $annualGross = (float) ($decl->projected_annual_gross ?? 0);
        if ($annualGross === 0) {
            $emp = Employee::where('user_id', $userId)->first();
            $annualGross = (float) ($emp->current_ctc ?? 0);
        }
        $calc = app(PayrollCalculatorService::class);
        $currentTax = $calc->calculateMonthlyTDS($annualGross, 'old', $this->flattenDeclarations($decl))['annual_tax']['total_tax'];
        $marginalRate = $this->marginalRateOldRegime($annualGross);

        $recommendations = [
            ['section' => '80C', 'cap' => 150000, 'remaining' => 150000 - (float) $decl?->section_80c_total,
             'advice' => 'PPF, ELSS, LIC, Home Loan Principal, Tuition Fees', 'potential_saving' => min(150000 - (float) $decl?->section_80c_total, 150000) * $marginalRate],
            ['section' => '80CCD1B', 'cap' => 50000, 'remaining' => 50000 - (float) $decl?->section_80ccd1b,
             'advice' => 'NPS Tier-1 additional contribution (over and above 80C)', 'potential_saving' => max(0, 50000 - (float) $decl?->section_80ccd1b) * $marginalRate],
            ['section' => '80D', 'cap' => 25000, 'remaining' => 25000 - (float) $decl?->section_80d,
             'advice' => 'Health insurance premium (self + family); ₹50,000 cap if parents are senior citizens', 'potential_saving' => max(0, 25000 - (float) $decl?->section_80d) * $marginalRate],
            ['section' => '24B', 'cap' => 200000, 'remaining' => 200000 - (float) $decl?->section_24b,
             'advice' => 'Home loan interest (let-out property)', 'potential_saving' => max(0, 200000 - (float) $decl?->section_24b) * $marginalRate],
        ];
        $totalPotential = array_sum(array_column($recommendations, 'potential_saving'));
        return [
            'financial_year' => $this->currentFY(),
            'annual_gross' => $annualGross,
            'current_tax_old_regime' => $currentTax,
            'marginal_rate_pct' => $marginalRate * 100,
            'recommendations' => $recommendations,
            'total_potential_saving' => round($totalPotential, 2),
        ];
    }

    protected function flattenDeclarations(?EmployeeTaxDeclaration $decl): array
    {
        if (!$decl) return [];
        $items = $decl->items ?? collect();
        $result = ['section_80c' => 0];
        foreach ($items as $item) {
            $key = match ($item->section) {
                '80C' => 'section_80c',
                '80D' => 'section_80d',
                '80CCD1B' => 'section_80ccd',
                '24B' => 'section_24b',
                default => null,
            };
            if ($key) $result[$key] = ($result[$key] ?? 0) + (float) $item->approved_amount;
        }
        return $result;
    }

    protected function marginalRateOldRegime(float $income): float
    {
        if ($income <= 250000) return 0.0;
        if ($income <= 500000) return 0.05;
        if ($income <= 1000000) return 0.20;
        return 0.30;
    }

    protected function currentFY(): string
    {
        $y = Carbon::now()->year;
        $m = Carbon::now()->month;
        if ($m < 4) return ($y - 1) . '-' . substr($y, -2);
        return $y . '-' . substr($y + 1, -2);
    }
}
