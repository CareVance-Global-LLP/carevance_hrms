<?php

namespace App\Services\Payroll;

use App\Models\SalaryComponent;
use App\Services\PayrollCalculatorService;

/**
 * What absorbs the delta when a component is overridden — and what happens when
 * nothing can.
 *
 * "Set basic to 6,00,000" has two possible arithmetic meanings and the engine
 * cannot guess: hold CTC and take it out of the residual, or raise gross. The
 * mode is therefore explicit, defaulting to preserving CTC because that is the
 * number in the employee's offer letter.
 *
 * Two things about this are non-obvious and both cost money if got wrong.
 *
 * 1. THE DELTA IS AMPLIFIED. Raising basic by 1 does not cost the residual 1.
 *    HRA is derived from basic, and employer PF and the gratuity provision sit
 *    inside the CTC envelope, so four quantities move together —
 *    1 + h + p + g, which is 1.668 at the usual rates. An admin who types
 *    "basic 50,000" expecting special allowance to fall by 10,000 sees it fall
 *    by 16,681. No product in this market shows that, which is why an override
 *    screen built on this needs a preview rather than a plain input.
 *
 * 2. THE RESIDUAL IS A ROLE, NOT A COMPONENT. Keka's PF article gives the
 *    design away: "If there is no Special Allowance component, the PF proration
 *    adjustment will be applied to the next available taxable component." The
 *    word taxable is load-bearing — falling back onto HRA or conveyance would
 *    change the employee's tax position while trying to satisfy an arithmetic
 *    identity.
 *
 * On a negative residual this REFUSES, and names the maximum that would work.
 * Neither Keka nor greytHR documents this case. Keka drops components silently
 * — their own troubleshooting article says a CTC that cannot accommodate the
 * structure "divides the CTC amount into the components it can and will not
 * include other components". Razorpay accepts the override and rejects it weeks
 * later at finalisation, as a batch-wide "all employees are showing as skipped"
 * event at the worst point in the payroll calendar. Both are worse than
 * refusing at entry, when the admin is looking at the screen and the fix is
 * cheap.
 */
class OverrideBalancingService
{
    public const MODE_PRESERVE_CTC = 'preserve_ctc';
    public const MODE_INCREASE_GROSS = 'increase_gross';

    public function __construct(private readonly PayrollCalculatorService $calculator)
    {
    }

    /**
     * The component that absorbs a delta, following Keka's chain.
     *
     * Order: the designated residual, then the next available TAXABLE component
     * by residual_order, then nothing — at which point an override has to be
     * refused rather than applied to a component that cannot legally take it.
     *
     * @param  int|null  $excludeComponentId  The component being overridden: it
     *                                        cannot absorb its own delta.
     */
    public function resolveResidual(int $organizationId, ?int $excludeComponentId = null): ?SalaryComponent
    {
        $candidates = SalaryComponent::query()
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->when($excludeComponentId, fn ($q) => $q->where('id', '!=', $excludeComponentId))
            ->orderByDesc('is_residual')
            ->orderBy('residual_order')
            ->orderBy('id')
            ->get();

        $designated = $candidates->firstWhere('is_residual', true);

        if ($designated) {
            return $designated;
        }

        // The fallback, and the reason is_taxable exists on this table.
        return $candidates->firstWhere('is_taxable', true);
    }

    /**
     * More than one component claims the residual role.
     *
     * Zoho enforces singularity structurally. Two residuals is not a preference
     * question — the balancer genuinely cannot know which absorbs the delta, so
     * this is reported as a configuration error rather than resolved by picking
     * the first.
     */
    public function hasAmbiguousResidual(int $organizationId): bool
    {
        return SalaryComponent::query()
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->where('is_residual', true)
            ->count() > 1;
    }

    /**
     * Can this override be applied, and if not, what is the largest value that
     * could be?
     *
     * @return array{
     *   permitted: bool, mode: string, requested: float, current: float,
     *   amplification: float, residual_before: float, residual_after: float,
     *   max_permitted: float, message: string
     * }
     */
    public function assess(
        float $monthlyCtc,
        array $config,
        float $requestedBasic,
        string $mode = self::MODE_PRESERVE_CTC
    ): array {
        $components = $this->calculator->calculateSalaryComponents($monthlyCtc, $config);

        $currentBasic = (float) $components['basic'];
        $residualBefore = (float) $components['special_allowance'];
        $factor = $this->calculator->residualAbsorptionFactor($requestedBasic, $config);

        // Raising gross does not touch the residual: the extra is funded by
        // enlarging the envelope rather than by taking it from somewhere else.
        if ($mode === self::MODE_INCREASE_GROSS) {
            return $this->result(true, $mode, $requestedBasic, $currentBasic, $factor,
                $residualBefore, $residualBefore, INF,
                'CTC increases to fund this override; the residual is untouched.');
        }

        $residualAfter = $residualBefore - ($requestedBasic - $currentBasic) * $factor;
        $maxPermitted = $this->calculator->maxBasicWithinCtc($monthlyCtc, $config);

        if ($residualAfter >= -0.01) {
            return $this->result(true, $mode, $requestedBasic, $currentBasic, $factor,
                $residualBefore, $residualAfter, $maxPermitted,
                'The residual absorbs this override.');
        }

        return $this->result(false, $mode, $requestedBasic, $currentBasic, $factor,
            $residualBefore, $residualAfter, $maxPermitted,
            sprintf(
                'Cannot set basic to %s. The residual would fall to %s. '
                .'Basic can go up to %s while holding CTC at %s — each rupee of basic costs the residual '
                .'%.3f, because HRA is derived from basic and employer PF and gratuity sit inside CTC. '
                .'To go higher, switch to "increase gross" or reduce HRA.',
                number_format($requestedBasic, 2),
                number_format($residualAfter, 2),
                number_format($maxPermitted, 2),
                number_format($monthlyCtc * 12, 2),
                $factor,
            ));
    }

    /** @return array<string, mixed> */
    private function result(
        bool $permitted,
        string $mode,
        float $requested,
        float $current,
        float $factor,
        float $residualBefore,
        float $residualAfter,
        float $maxPermitted,
        string $message
    ): array {
        return [
            'permitted' => $permitted,
            'mode' => $mode,
            'requested' => round($requested, 2),
            'current' => round($current, 2),
            // Surfaced deliberately. It is the number that explains why an
            // override "cost more than I asked for", and the reason a preview
            // is not optional on this screen.
            'amplification' => round($factor, 4),
            'residual_before' => round($residualBefore, 2),
            'residual_after' => is_finite($residualAfter) ? round($residualAfter, 2) : $residualAfter,
            'max_permitted' => is_finite($maxPermitted) ? round($maxPermitted, 2) : $maxPermitted,
            'message' => $message,
        ];
    }
}
