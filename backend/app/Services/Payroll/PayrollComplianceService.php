<?php

namespace App\Services\Payroll;

use App\Models\PayrollProfile;
use App\Models\PayrollTaxDeclaration;

class PayrollComplianceService
{
    public function __construct(
        private readonly PayrollTaxDeclarationService $taxDeclarationService,
    ) {
    }

    public function defaultSettings(string $currency = 'INR'): array
    {
        return [
            'currency' => $currency,
            'pf' => [
                'enabled' => true,
                'employee_rate' => 12,
                'employer_rate' => 12,
                'wage_ceiling' => 15000,
            ],
            'esi' => [
                'enabled' => true,
                'employee_rate' => 0.75,
                'employer_rate' => 3.25,
                'monthly_gross_threshold' => 21000,
            ],
            'professional_tax' => [
                'enabled' => false,
                'default_monthly_amount' => 200,
                'states' => [],
            ],
            'tds' => [
                'enabled' => true,
                'fallback_to_profile_tax_amount' => true,
            ],
        ];
    }

    public function readiness(PayrollProfile $profile, array $settings, ?PayrollTaxDeclaration $declaration = null): array
    {
        $warnings = [];
        $overrides = $profile->compliance_overrides ?: [];

        if (data_get($settings, 'pf.enabled', true) && !data_get($overrides, 'pf.exempt', false) && empty($profile->pf_account_number) && empty($profile->uan)) {
            $warnings[] = 'PF details missing';
        }

        if (data_get($settings, 'esi.enabled', true) && !data_get($overrides, 'esi.exempt', false) && empty($profile->esi_number)) {
            $warnings[] = 'ESI details missing';
        }

        if (data_get($settings, 'professional_tax.enabled', false) && empty($profile->professional_tax_state)) {
            $warnings[] = 'Professional tax state missing';
        }

        if (data_get($settings, 'tds.enabled', true) && !$declaration && empty($profile->tax_identifier) && empty($profile->pan_or_tax_id)) {
            $warnings[] = 'Tax declaration or PAN/TAX ID missing';
        }

        return [
            'status' => count($warnings) === 0 ? 'ready' : 'blocked',
            'warnings' => $warnings,
        ];
    }

    public function calculate(
        float $basicSalary,
        float $grossSalary,
        PayrollProfile $profile,
        array $settings,
        ?PayrollTaxDeclaration $declaration,
        float $fallbackProfileTaxAmount = 0
    ): array {
        $settings = array_replace_recursive($this->defaultSettings($profile->currency ?: 'INR'), $settings);
        $overrides = $profile->compliance_overrides ?: [];

        $pfEmployee = 0.0;
        $pfEmployer = 0.0;
        if (data_get($settings, 'pf.enabled', true) && !data_get($overrides, 'pf.exempt', false)) {
            $pfBase = min($basicSalary, (float) data_get($settings, 'pf.wage_ceiling', 15000));
            $pfEmployee = round($pfBase * ((float) data_get($settings, 'pf.employee_rate', 12) / 100), 2);
            $pfEmployer = round($pfBase * ((float) data_get($settings, 'pf.employer_rate', 12) / 100), 2);
        }

        $esiEmployee = 0.0;
        $esiEmployer = 0.0;
        $esiThreshold = (float) data_get($settings, 'esi.monthly_gross_threshold', 21000);
        if (data_get($settings, 'esi.enabled', true) && !data_get($overrides, 'esi.exempt', false) && $grossSalary <= $esiThreshold) {
            $esiEmployee = round($grossSalary * ((float) data_get($settings, 'esi.employee_rate', 0.75) / 100), 2);
            $esiEmployer = round($grossSalary * ((float) data_get($settings, 'esi.employer_rate', 3.25) / 100), 2);
        }

        $ptEmployee = 0.0;
        if (data_get($settings, 'professional_tax.enabled', false) && !data_get($overrides, 'professional_tax.exempt', false)) {
            $stateRates = data_get($settings, 'professional_tax.states.'.strtoupper((string) $profile->professional_tax_state), []);
            $ptEmployee = round((float) ($stateRates['monthly_amount'] ?? data_get($settings, 'professional_tax.default_monthly_amount', 200)), 2);
        }

        $annualIncome = $grossSalary * 12;
        $taxEstimate = $this->taxDeclarationService->estimateMonthlyTds(
            $annualIncome,
            (string) ($declaration?->tax_regime ?: $profile->tax_regime ?: 'new'),
            $declaration,
            data_get($settings, 'tds', [])
        );
        $tds = data_get($settings, 'tds.enabled', true)
            ? round(
                $declaration
                    ? (float) ($taxEstimate['monthly_tds'] ?? 0)
                    : ((bool) data_get($settings, 'tds.fallback_to_profile_tax_amount', true) ? $fallbackProfileTaxAmount : 0),
                2
            )
            : 0.0;

        return [
            'employee' => [
                ['code' => 'PF_EMPLOYEE', 'label' => 'PF Employee', 'amount' => $pfEmployee, 'category' => 'deduction'],
                ['code' => 'ESI_EMPLOYEE', 'label' => 'ESI Employee', 'amount' => $esiEmployee, 'category' => 'deduction'],
                ['code' => 'PROFESSIONAL_TAX', 'label' => 'Professional Tax', 'amount' => $ptEmployee, 'category' => 'deduction'],
                ['code' => 'TDS', 'label' => 'TDS', 'amount' => $tds, 'category' => 'tax', 'meta' => $taxEstimate],
            ],
            'employer' => [
                ['code' => 'PF_EMPLOYER', 'label' => 'PF Employer', 'amount' => $pfEmployer, 'category' => 'employer_contribution'],
                ['code' => 'ESI_EMPLOYER', 'label' => 'ESI Employer', 'amount' => $esiEmployer, 'category' => 'employer_contribution'],
            ],
            'totals' => [
                'employee_deductions' => round($pfEmployee + $esiEmployee + $ptEmployee, 2),
                'tds' => round($tds, 2),
                'employer_contributions' => round($pfEmployer + $esiEmployer, 2),
            ],
            'tax_estimate' => $taxEstimate,
        ];
    }
}
