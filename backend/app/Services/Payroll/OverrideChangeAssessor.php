<?php

namespace App\Services\Payroll;

use App\Models\EmployeePayrollTemplate;
use App\Services\PayrollCalculatorService;

/**
 * Can this change be applied, and what does it cost the residual?
 *
 * One place, because two callers ask the same question — the CSV importer for
 * every row of a file, and the grid's Update for every edited cell. They differ
 * entirely in plumbing and not at all in arithmetic, and money computed twice
 * eventually disagrees with itself. The error prose stays with each caller,
 * since a spreadsheet row and a grid cell need different wording; the numbers
 * come from here.
 *
 * Everything crossing this boundary is ANNUAL, matching the grid and the CSV.
 * The engine underneath is monthly.
 */
class OverrideChangeAssessor
{
    public function __construct(
        private readonly PayrollCalculatorService $calculator,
        private readonly OverrideGridService $grid,
    ) {
    }

    /**
     * @param  array{basic?: int, hra?: int}  $valuesAnnual  Only the targets being changed.
     * @return array{
     *   permitted: bool, residual_before: int, residual_after: int,
     *   amplification: float, hra_moves_to: int, max_basic_annual: int,
     *   basic_annual: int, hra_pinned: bool
     * }
     */
    public function assess(
        EmployeePayrollTemplate $template,
        array $valuesAnnual,
        string $balanceMode = OverrideBalancingService::MODE_PRESERVE_CTC
    ): array {
        $config = $this->grid->configFor($template);
        $monthlyCtc = (float) $template->annual_ctc / 12;
        $computed = $this->calculator->calculateSalaryComponents($monthlyCtc, $config);

        /*
         * When HRA is pinned it stops following basic, so it drops out of the
         * amplification: a rupee of basic then costs 1 + p + g rather than
         * 1 + h + p + g. Passing hra_percentage_of_basic => 0 is how the
         * balancer is told that, and it is the whole reason assess() takes a
         * config rather than reading one.
         */
        $hraPinned = array_key_exists('hra', $valuesAnnual);
        $assessConfig = $config;
        if ($hraPinned) {
            $assessConfig['hra_percentage_of_basic'] = 0.0;
        }

        $basicMonthly = array_key_exists('basic', $valuesAnnual)
            ? $valuesAnnual['basic'] / 12
            : (float) ($computed['basic'] ?? 0);

        $residualAfter = $this->residualAfter($monthlyCtc, $config, $basicMonthly, $valuesAnnual, $computed);
        $maxBasic = $this->calculator->maxBasicWithinCtc($monthlyCtc, $assessConfig);

        // Raising gross funds the change by enlarging the envelope, so the
        // residual is untouched and there is no ceiling to breach.
        $permitted = $balanceMode === OverrideBalancingService::MODE_INCREASE_GROSS
            || $residualAfter >= -0.01;

        return [
            'permitted' => $permitted,
            'residual_before' => (int) round((float) ($computed['special_allowance'] ?? 0) * 12),
            'residual_after' => (int) round($residualAfter * 12),
            'amplification' => round($this->calculator->residualAbsorptionFactor($basicMonthly, $assessConfig), 4),
            'hra_moves_to' => $hraPinned
                ? (int) $valuesAnnual['hra']
                : (int) round($basicMonthly * (float) $config['hra_percentage_of_basic'] * 12),
            'max_basic_annual' => (int) (floor($maxBasic) * 12),
            'basic_annual' => (int) round($basicMonthly * 12),
            'hra_pinned' => $hraPinned,
        ];
    }

    /**
     * The residual once every value on this change has been applied.
     *
     * Applied together, deliberately. A change that raises basic and lowers HRA
     * in the same act must be judged on its net effect — judging basic alone
     * would refuse something that balances perfectly well.
     *
     * @param  array{basic?: int, hra?: int}  $valuesAnnual
     * @param  array<string, float>  $computed
     */
    public function residualAfter(
        float $monthlyCtc,
        array $config,
        float $basicMonthly,
        array $valuesAnnual,
        array $computed
    ): float {
        $hraMonthly = array_key_exists('hra', $valuesAnnual)
            ? $valuesAnnual['hra'] / 12
            : $basicMonthly * (float) ($config['hra_percentage_of_basic'] ?? 0);

        $gross = $monthlyCtc
            - $this->calculator->calculateEmployerPF($basicMonthly)
            - $this->calculator->calculateGratuityProvision($basicMonthly);

        return $gross - $basicMonthly - $hraMonthly - (float) ($computed['conveyance'] ?? 0);
    }

    /** The engine's own figure for a target, annual — what it would have paid. */
    public function computedAnnual(EmployeePayrollTemplate $template, string $target): int
    {
        $config = $this->grid->configFor($template);
        $computed = $this->calculator->calculateSalaryComponents((float) $template->annual_ctc / 12, $config);

        return (int) round((float) ($computed[$target] ?? 0) * 12);
    }
}
