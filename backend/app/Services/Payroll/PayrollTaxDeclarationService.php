<?php

namespace App\Services\Payroll;

use App\Models\PayrollProfile;
use App\Models\PayrollTaxDeclaration;
use Carbon\Carbon;

class PayrollTaxDeclarationService
{
    public function financialYearForMonth(string $payrollMonth): string
    {
        $month = Carbon::createFromFormat('Y-m', $payrollMonth)->startOfMonth();
        $startYear = $month->month >= 4 ? $month->year : $month->year - 1;

        return sprintf('%d-%d', $startYear, $startYear + 1);
    }

    public function findForMonth(int $organizationId, int $userId, string $payrollMonth): ?PayrollTaxDeclaration
    {
        return PayrollTaxDeclaration::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('financial_year', $this->financialYearForMonth($payrollMonth))
            ->first();
    }

    public function declarationSummary(?PayrollTaxDeclaration $declaration, ?PayrollProfile $profile = null): array
    {
        $status = (string) ($declaration?->status ?? $profile?->declaration_status ?? 'not_started');
        $taxRegime = (string) ($declaration?->tax_regime ?: $profile?->tax_regime ?: 'new');
        $sections = $declaration?->sections ?: [];

        return [
            'financial_year' => $declaration?->financial_year ?: null,
            'status' => $status,
            'tax_regime' => $taxRegime,
            'investments_total' => round((float) data_get($sections, 'investments.total', 0), 2),
            'exemptions_total' => round((float) data_get($sections, 'exemptions.total', 0), 2),
            'other_income_total' => round((float) data_get($sections, 'other_income.total', 0), 2),
            'is_complete' => in_array($status, ['submitted', 'approved'], true),
            'approved_snapshot' => $declaration?->approved_snapshot,
        ];
    }

    public function estimateMonthlyTds(
        float $annualTaxableIncome,
        string $taxRegime,
        ?PayrollTaxDeclaration $declaration = null,
        array $taxSettings = []
    ): array {
        $normalizedRegime = in_array($taxRegime, ['old', 'new'], true) ? $taxRegime : 'new';
        $sections = $declaration?->approved_snapshot ?: $declaration?->sections ?: [];
        $declaredInvestments = (float) data_get($sections, 'investments.total', 0);
        $declaredExemptions = (float) data_get($sections, 'exemptions.total', 0);
        $otherIncome = (float) data_get($sections, 'other_income.total', 0);
        $effectiveIncome = max(
            0,
            $annualTaxableIncome + $otherIncome - ($normalizedRegime === 'old' ? ($declaredInvestments + $declaredExemptions) : 0)
        );

        $slabs = $this->slabs($normalizedRegime, $taxSettings);
        $annualTax = 0.0;
        $remaining = $effectiveIncome;
        $previousLimit = 0.0;

        foreach ($slabs as $slab) {
            $limit = (float) ($slab['upto'] ?? 0);
            $rate = (float) ($slab['rate'] ?? 0);

            if ($remaining <= 0) {
                break;
            }

            $taxableForSlab = $limit <= 0
                ? $remaining
                : max(0, min($remaining, $limit - $previousLimit));

            $annualTax += $taxableForSlab * ($rate / 100);
            $remaining -= $taxableForSlab;
            $previousLimit = $limit > 0 ? $limit : $previousLimit;
        }

        $rebateLimit = (float) data_get($taxSettings, "rebate_limits.{$normalizedRegime}", $normalizedRegime === 'new' ? 1200000 : 500000);
        if ($effectiveIncome <= $rebateLimit) {
            $annualTax = 0.0;
        }

        return [
            'tax_regime' => $normalizedRegime,
            'annual_taxable_income' => round($annualTaxableIncome, 2),
            'effective_taxable_income' => round($effectiveIncome, 2),
            'annual_tax' => round($annualTax, 2),
            'monthly_tds' => round($annualTax / 12, 2),
            'declaration_status' => $declaration?->status ?? 'missing',
            'declaration_id' => $declaration?->id,
        ];
    }

    private function slabs(string $taxRegime, array $taxSettings): array
    {
        $configured = data_get($taxSettings, "slabs.{$taxRegime}");
        if (is_array($configured) && count($configured) > 0) {
            return $configured;
        }

        if ($taxRegime === 'old') {
            return [
                ['upto' => 250000, 'rate' => 0],
                ['upto' => 500000, 'rate' => 5],
                ['upto' => 1000000, 'rate' => 20],
                ['upto' => 0, 'rate' => 30],
            ];
        }

        return [
            ['upto' => 400000, 'rate' => 0],
            ['upto' => 800000, 'rate' => 5],
            ['upto' => 1200000, 'rate' => 10],
            ['upto' => 1600000, 'rate' => 15],
            ['upto' => 2000000, 'rate' => 20],
            ['upto' => 2400000, 'rate' => 25],
            ['upto' => 0, 'rate' => 30],
        ];
    }
}
