<?php

namespace App\Services;

use App\Models\EmployeePayrollTemplate;
use App\Models\SalaryTemplate;
use App\Models\User;

/**
 * What an employee's annual CTC actually pays them, component by component.
 *
 * Two breakdown engines already existed and never met:
 *
 *  - SalaryTemplate::calculateBreakdown() knows the named components a salary
 *    structure defines (CCA, meal, internet, uniform, other_earnings…) but
 *    computes no PF/ESI/PT/TDS at all, and builds gross *additively* so it does
 *    not balance to CTC.
 *  - PayrollCalculatorService::calculatePayroll() computes statutory correctly
 *    but ignores salary_template_id entirely, so every named allowance
 *    collapses into a single "special allowance" line.
 *
 * Neither alone answers "show me the breakdown for this employee's structure".
 * This service composes them. It invents no tax logic of its own — every
 * statutory figure comes from PayrollCalculatorService or PTStateService.
 */
class SalaryBreakdownService
{
    public function __construct(private PayrollCalculatorService $calculator)
    {
    }

    /** Labels for the fixed component columns a SalaryTemplate carries. */
    private const EARNING_LABELS = [
        'basic' => 'Basic',
        'hra' => 'HRA',
        'conveyance' => 'Conveyance',
        'da' => 'Dearness Allowance',
        'cca' => 'City Compensatory Allowance',
        'education' => 'Education Allowance',
        'internet' => 'Internet Allowance',
        'meal' => 'Meal Allowance',
        'transport' => 'Transport Allowance',
        'uniform' => 'Uniform Allowance',
        'books_periodicals' => 'Books & Periodicals',
        'fuel_maintenance' => 'Fuel & Maintenance',
    ];

    /**
     * @return array<string,mixed> The shape documented on the
     *                             employee-salary-breakdown endpoint.
     */
    public function forEmployee(
        User $employee,
        ?SalaryTemplate $structure,
        float $annualCtc,
        EmployeePayrollTemplate $config,
        ?string $ptStateOverride = null,
    ): array {
        $monthlyCtc = $annualCtc > 0 ? $annualCtc / 12 : 0.0;
        $warnings = [];

        /*
         * Basic and HRA drive PF, gratuity and therefore gross, so they come
         * from the structure when there is one.
         *
         * SalaryTemplate stores percentages as 0-100; calculateSalaryComponents
         * expects fractions. Getting this wrong inflates basic 100x.
         */
        $isMetro = (bool) ($config->is_metro_city ?? true);
        $basicFraction = $structure
            ? (float) $structure->basic_percentage / 100
            : 0.40;
        $hraFractionOfBasic = $structure
            ? (float) $structure->hra_percentage / 100
            : ($isMetro ? 0.50 : 0.40);
        $conveyance = $structure ? (float) $structure->conveyance_amount : 1600.0;

        /*
         * Gross is authoritative: CTC less the employer-side amounts, per
         * calculateSalaryComponents. The structure's own `gross` is a sum of
         * its components and does not balance to CTC, so it is not used.
         *
         * Deliberately not calculatePayroll(): that forces HRA to 40% of basic
         * for a non-metro employee, which would silently discard the
         * structure's own HRA percentage.
         */
        $components = $this->calculator->calculateSalaryComponents($monthlyCtc, [
            'basic_percentage' => $basicFraction,
            'hra_percentage_of_basic' => $hraFractionOfBasic,
            'conveyance_allowance' => $conveyance,
            'medical_allowance' => 0,
        ]);

        /*
         * Approved overrides apply here too, not only in the payroll engines.
         *
         * This screen and the payslip are separate code paths, and an override
         * honoured by one and ignored by the other is the worst available
         * outcome: the breakdown an employee is shown would disagree with what
         * they are paid, and nothing on either screen would say why. The
         * figures below — gross, PF, ESI, PT, TDS and the residual — all derive
         * from basic, so the substitution has to happen before any of them.
         */
        $overrideResult = app(\App\Services\Payroll\OverrideApplicationService::class)->apply(
            $components,
            (int) $employee->id,
            (int) $employee->organization_id,
            now()->format('Y-m'),
            $monthlyCtc,
            [
                'basic_percentage' => $basicFraction,
                'hra_percentage_of_basic' => $hraFractionOfBasic,
                'conveyance_allowance' => $conveyance,
                'medical_allowance' => 0,
            ],
        );

        $components = $overrideResult['components'];

        $basic = $components['basic'];
        $gross = $components['gross'];

        /*
         * Computed once and reused for the deduction side too. The structure
         * may be a transient, unsaved model carrying an admin's custom
         * percentages — calculateBreakdown() does not care, which is why custom
         * mode reuses the template math rather than reimplementing it.
         */
        $monthly = $structure ? $structure->calculateBreakdown($annualCtc)['monthly'] : null;

        /*
         * The named lines come from the structure, not from $components — so
         * without this an overridden basic would move gross, PF and the
         * residual while the Basic row itself still showed the structure's
         * figure. The breakdown would fail to add up on screen.
         */
        if ($monthly !== null && $overrideResult['applied'] !== []) {
            foreach ($overrideResult['applied'] as $applied) {
                if (array_key_exists($applied['target'], $monthly)) {
                    $monthly[$applied['target']] = $components[$applied['target']];
                }
            }

            // HRA is derived from basic, so it moves even when it was not the
            // component overridden.
            if (array_key_exists('hra', $monthly)) {
                $monthly['hra'] = $components['hra'];
            }
        }

        foreach ($this->overrideWarnings($overrideResult['applied']) as $warning) {
            $warnings[] = $warning;
        }

        $earnings = [];
        $namedTotal = 0.0;

        if ($monthly) {
            foreach (self::EARNING_LABELS as $key => $label) {
                $amount = (float) ($monthly[$key] ?? 0);
                if ($amount <= 0) {
                    continue;
                }
                $earnings[] = $this->line($key, $label, $amount, 'structure');
                $namedTotal += $amount;
            }

            foreach ($monthly['other_earnings'] ?? [] as $index => $item) {
                $amount = (float) ($item['amount'] ?? 0);
                if ($amount <= 0) {
                    continue;
                }
                $earnings[] = $this->line(
                    'other_earning_' . $index,
                    (string) ($item['name'] ?? 'Other earning'),
                    $amount,
                    'structure',
                );
                $namedTotal += $amount;
            }
        } else {
            $warnings[] = 'No salary structure assigned — showing the engine defaults (Basic 40% of CTC, HRA by metro status, conveyance ₹1,600).';

            foreach (['basic' => $basic, 'hra' => $components['hra'], 'conveyance' => $components['conveyance']] as $key => $amount) {
                if ($amount <= 0) {
                    continue;
                }
                $earnings[] = $this->line($key, self::EARNING_LABELS[$key], $amount, 'default');
                $namedTotal += $amount;
            }
        }

        /*
         * The residual is what makes the breakdown add up to CTC. A structure
         * whose named components exceed gross is over-allocated — report it
         * rather than rendering a negative earnings row.
         */
        $specialAllowance = round($gross - $namedTotal, 2);
        if ($specialAllowance > 0.005) {
            $earnings[] = $this->line('special_allowance', 'Special Allowance', $specialAllowance, 'residual');
        } elseif ($specialAllowance < -0.005) {
            $warnings[] = sprintf(
                'This structure allocates ₹%s more per month than the gross this CTC supports. Reduce a component or raise the CTC.',
                number_format(abs($specialAllowance), 2),
            );
        }

        $deductions = [];

        if ($config->pf_enabled ?? true) {
            $pf = $this->calculator->calculateEmployeePF($basic, 0, (bool) ($config->pf_above_cap ?? false));
            $deductions[] = $this->line('pf_employee', 'Provident Fund (employee)', $pf, 'statutory');
        }

        if ($config->esi_enabled ?? true) {
            $esi = $this->calculator->calculateEmployeeESI($gross);
            $deductions[] = $this->line('esi_employee', 'ESI (employee)', $esi, 'statutory');
        }

        /*
         * Professional tax is state-levied and several states levy none. An
         * unset state must yield ₹0 — never fall back to a real state.
         */
        $ptState = $ptStateOverride ?? $config->pt_state ?? '';
        if ($config->pt_enabled ?? true) {
            $pt = $ptState === '' ? 0.0 : PTStateService::calculate($ptState, $gross);
            $deductions[] = $this->line('pt', 'Professional Tax', $pt, 'statutory');

            if ($ptState === '') {
                $warnings[] = 'No professional-tax state set for this employee, so PT shows ₹0. Set the PT State to have it calculated.';
            }
        }

        $taxRegime = $config->tax_regime ?? 'new';
        if ($config->tds_enabled ?? true) {
            $tds = $this->calculator->calculateMonthlyTDS(
                max(0, $gross * 12),
                $taxRegime,
                $taxRegime === 'old'
                    ? $this->calculator->getApprovedTaxDeductionMap($employee->id)
                    : [],
            );
            $deductions[] = $this->line('tds', 'TDS (income tax)', $tds['monthly_tds'], 'statutory');
        }

        if ($monthly) {
            foreach (['nps' => 'NPS (employee)', 'vpf' => 'Voluntary PF'] as $key => $label) {
                $amount = (float) ($monthly[$key] ?? 0);
                if ($amount > 0) {
                    $deductions[] = $this->line($key, $label, $amount, 'structure');
                }
            }

            foreach ($monthly['other_deductions'] ?? [] as $index => $item) {
                $amount = (float) ($item['amount'] ?? 0);
                if ($amount > 0) {
                    $deductions[] = $this->line(
                        'other_deduction_' . $index,
                        (string) ($item['name'] ?? 'Other deduction'),
                        $amount,
                        'structure',
                    );
                }
            }
        }

        $employerContributions = [];
        $employer = $this->calculator->calculateEmployerContributions($basic, $gross);
        $employerLabels = [
            'pf' => 'Provident Fund (employer)',
            'eps' => 'Pension Scheme (EPS)',
            'epf' => 'EPF',
            'esi' => 'ESI (employer)',
            'gratuity' => 'Gratuity provision',
        ];
        foreach ($employerLabels as $key => $label) {
            $amount = (float) ($employer[$key] ?? 0);
            if ($amount > 0) {
                $employerContributions[] = $this->line($key, $label, $amount, 'statutory');
            }
        }

        $totalDeductions = array_sum(array_column($deductions, 'monthly'));
        $net = round($gross - $totalDeductions, 2);

        return [
            'monthly' => [
                'ctc' => round($monthlyCtc, 2),
                'gross' => round($gross, 2),
                'total_deductions' => round($totalDeductions, 2),
                'net' => $net,
            ],
            'annual' => [
                'ctc' => round($annualCtc, 2),
                'gross' => round($gross * 12, 2),
                'total_deductions' => round($totalDeductions * 12, 2),
                'net' => round($net * 12, 2),
            ],
            'earnings' => $earnings,
            'deductions' => $deductions,
            'employer_contributions' => $employerContributions,
            'notes' => [
                'pf_wages' => round(min($basic, 15000), 2),
                'pf_cap_applied' => $basic > 15000,
                'esi_applicable' => $gross <= 21000,
                'tax_regime' => $taxRegime,
                'pt_state' => $ptState,
                'is_metro_city' => $isMetro,
                'tds_is_estimate' => true,
            ],
            'warnings' => $warnings,
        ];
    }

    /**
     * One sentence per applied override, naming who released it and what the
     * structure would otherwise have produced.
     *
     * Both halves matter. Without the approver the figure looks like a system
     * glitch; without the structure's own number the reader cannot tell how
     * large the exception is. Stated annually, because that is the unit a
     * revision letter and the override register both use.
     *
     * @param  list<array<string, mixed>>  $applied
     * @return list<string>
     */
    private function overrideWarnings(array $applied): array
    {
        if ($applied === []) {
            return [];
        }

        $overrides = \App\Models\PayrollOverride::query()
            ->with('approvedBy:id,name')
            ->whereIn('id', array_column($applied, 'override_id'))
            ->get()
            ->keyBy('id');

        $labels = self::EARNING_LABELS;

        return array_values(array_map(function (array $entry) use ($overrides, $labels) {
            $override = $overrides->get($entry['override_id']);
            $label = $labels[$entry['target']] ?? ucfirst(str_replace('_', ' ', $entry['target']));

            $approver = $override?->approvedBy?->name;
            $approvedAt = $override?->approved_at?->format('j M Y');

            return sprintf(
                '%s is overridden to ₹%s for this employee%s. The structure would have produced ₹%s.',
                $label,
                number_format((float) $entry['value'] * 12, 0),
                $approver && $approvedAt ? sprintf(' (approved by %s on %s)', $approver, $approvedAt) : '',
                number_format((float) $entry['computed_value'] * 12, 0),
            );
        }, $applied));
    }

    /** @return array<string,mixed> */
    private function line(string $key, string $label, float $monthly, string $origin): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'monthly' => round($monthly, 2),
            'annual' => round($monthly * 12, 2),
            'origin' => $origin,
        ];
    }
}
