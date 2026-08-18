<?php

namespace App\Services\Payroll;

use App\Models\PayrollOverride;
use App\Models\SalaryComponent;
use App\Services\PayrollCalculatorService;
use Illuminate\Support\Facades\Log;

/**
 * Applies approved overrides to a month's computed components.
 *
 * This is the layer D6 chose over the two alternatives. Keka's model — a
 * standing per-employee property that shadows the structure value — survives a
 * reprocess by construction but cannot express "this month only", carries no
 * per-occurrence reason, and leaves nothing to report on per run. An
 * adjustment-line model is naturally auditable but loses "what would it have
 * been", which is the half that explains the payslip.
 *
 * So overrides are evaluated at compute time and BOTH values are written back:
 * `value` as applied, `computed_value` as the engine would have produced. The
 * pair is what makes the override register meaningful and a reversal trivially
 * computable.
 *
 * Timing follows Keka deliberately: saving an override does not move a payslip.
 * It applies when payroll is processed — "Perform Process Payroll to update the
 * override information in the system." An override that silently restated last
 * month's payslip the moment it was saved would defeat the immutability work
 * this all sits on.
 *
 * The cascade is the part no product surfaces. Overriding basic moves HRA,
 * employer PF and the gratuity provision with it, because HRA is derived from
 * basic and both employer amounts sit inside the CTC envelope. Recording what
 * moved and by how much is what lets the differences report say HRA changed
 * *because* basic was overridden, rather than merely that it changed.
 */
class OverrideApplicationService
{
    /**
     * salary_components code → the key the engine computes under.
     *
     * The two vocabularies are genuinely different: an organisation names and
     * codes its components ('SPL', 'Special Allowance'), while the calculator
     * works in fixed keys because HRA, employer PF and the gratuity provision
     * are derived from basic in code rather than from configuration. The map is
     * the seam, and it lives here — beside the only consumer of an engine key —
     * rather than being re-derived at each call site.
     *
     * Unlisted codes resolve to null and are simply not overridable, which is
     * the correct answer for a formula-driven custom head: the engine has no
     * slot to pin it to.
     */
    private const ENGINE_KEY_BY_CODE = [
        'BASIC' => 'basic',
        'HRA' => 'hra',
        'CONV' => 'conveyance',
        'CONVEYANCE' => 'conveyance',
        'SPL' => 'special_allowance',
        'SPECIAL' => 'special_allowance',
        'SPECIAL_ALLOWANCE' => 'special_allowance',
    ];

    public function __construct(
        private readonly PayrollCalculatorService $calculator,
        private readonly OverrideBalancingService $balancer,
        private readonly OverrideAuditTrail $audit,
    ) {
    }

    /**
     * Which engine component this salary component stands for, if any.
     *
     * Matches on the code first, then on the name reduced to the same form, so
     * an organisation that coded its residual 'SPECIAL_ALLOWANCE' and one that
     * coded it 'SPL' both resolve.
     */
    public static function engineKeyFor(SalaryComponent $component): ?string
    {
        $code = strtoupper(trim((string) $component->code));

        if (isset(self::ENGINE_KEY_BY_CODE[$code])) {
            return self::ENGINE_KEY_BY_CODE[$code];
        }

        $fromName = strtoupper(str_replace([' ', '-'], '_', trim((string) $component->name)));

        return self::ENGINE_KEY_BY_CODE[$fromName] ?? null;
    }

    /**
     * Statutory overrides in force, as target => stated amount.
     *
     * TERMINAL, and that is the whole distinction from a component override.
     * When an officer states the PF figure for a month — a correction, a
     * transfer-in adjustment, an inspector's direction — the stated figure is
     * the answer. Recomputing anything downstream from it would re-derive the
     * number they just corrected, which is how a correction becomes a loop.
     *
     * @return array<string, float>
     */
    public function statutoryOverridesFor(int $userId, string $monthYear): array
    {
        return PayrollOverride::query()
            ->where('user_id', $userId)
            ->where('scope', 'statutory')
            ->inForceFor($monthYear)
            ->orderBy('effective_from')
            ->get()
            ->mapWithKeys(fn (PayrollOverride $override) => [$override->target => (float) $override->value])
            ->all();
    }

    /**
     * Substitute stated statutory figures for the engine's own.
     *
     * Separate from apply() because statutory amounts are resolved by each
     * engine at its own point in the calculation — after loss of pay, on
     * payable wages — so there is no shared component map to hand back. What is
     * shared is the rule: the stated figure is the answer, and nothing is
     * re-derived from it.
     *
     * A target the engine does not produce is ignored rather than invented.
     * Adding a 'pf' line to an employee whose template has PF disabled would be
     * a statutory decision made by a typo.
     *
     * @param  array<string, float>  $engineFigures  e.g. ['pf' => 1800.0, 'pt' => 200.0]
     * @return array<string, float>  The same map, with in-force overrides substituted.
     */
    public function applyStatutory(array $engineFigures, int $userId, string $monthYear): array
    {
        $overrides = PayrollOverride::query()
            ->where('user_id', $userId)
            ->where('scope', 'statutory')
            ->inForceFor($monthYear)
            ->orderBy('effective_from')
            ->get();

        foreach ($overrides as $override) {
            $target = $override->target;

            if (! array_key_exists($target, $engineFigures)) {
                Log::warning('Statutory override targets a head this engine does not produce', [
                    'override_id' => $override->id,
                    'target' => $target,
                    'month_year' => $monthYear,
                ]);

                continue;
            }

            $engineValue = round((float) $engineFigures[$target], 2);
            $engineFigures[$target] = round((float) $override->value, 2);

            $override->forceFill([
                'computed_value' => $engineValue,
                // No cascade, and that is the distinction being recorded: a
                // statutory override is terminal, so nothing moved because of
                // it. An empty snapshot says that; a null one would only say
                // the override has not run yet.
                'cascade_snapshot' => [],
            ])->save();

            $this->audit->applied($override, $monthYear, [
                'target' => $target,
                'value' => (float) $override->value,
                'computed_value' => $engineValue,
                'terminal' => true,
            ]);
        }

        return $engineFigures;
    }

    /**
     * Apply every approved override in force for this employee and month.
     *
     * @param  array<string, float>  $components  As produced by calculateSalaryComponents()
     * @return array{components: array<string, float>, applied: list<array<string, mixed>>}
     */
    public function apply(
        array $components,
        int $userId,
        int $organizationId,
        string $monthYear,
        float $monthlyCtc,
        array $config
    ): array {
        $overrides = PayrollOverride::query()
            ->where('user_id', $userId)
            ->where('scope', 'component')
            ->inForceFor($monthYear)
            ->orderBy('effective_from')
            ->get();

        if ($overrides->isEmpty()) {
            return ['components' => $components, 'applied' => []];
        }

        $applied = [];

        foreach ($overrides as $override) {
            $target = $override->target;

            // An override naming a component this structure does not produce is
            // a configuration error, not a reason to fail the run. Record it
            // and pay the employee correctly.
            if (! array_key_exists($target, $components)) {
                Log::warning('Payroll override targets an unknown component', [
                    'override_id' => $override->id,
                    'target' => $target,
                    'month_year' => $monthYear,
                ]);

                continue;
            }

            $before = $components;
            $computedValue = (float) $components[$target];
            $requestedValue = (float) $override->value;

            $assessment = $this->balancer->assess(
                $monthlyCtc,
                $config,
                $requestedValue,
                $override->balance_mode ?: OverrideBalancingService::MODE_PRESERVE_CTC,
            );

            // Refused at entry is the design; refused again here means the
            // structure moved underneath a previously valid override — a CTC
            // cut, say. Skipping is right: the alternative is paying a residual
            // the employee does not have.
            if (! $assessment['permitted']) {
                Log::warning('Payroll override no longer fits the structure and was skipped', [
                    'override_id' => $override->id,
                    'month_year' => $monthYear,
                    'max_permitted' => $assessment['max_permitted'],
                ]);

                continue;
            }

            $components = $this->recomputeWith($target, $requestedValue, $monthlyCtc, $config, $components);

            $cascade = $this->cascadeBetween($before, $components, $target);

            // Written back so the register can explain itself without
            // recomputing, and so D2's differences report can attribute a
            // moved component to the override that moved it.
            $override->forceFill([
                'computed_value' => $computedValue,
                'cascade_snapshot' => $cascade,
            ])->save();

            // Idempotent per override per month. Reprocessing an open run is
            // routine — corrected attendance, a late arrear — and applies the
            // same override for the same month again; a second audit row would
            // read as a second act of interference rather than the same one.
            $this->audit->applied($override, $monthYear, [
                'target' => $target,
                'value' => $requestedValue,
                'computed_value' => $computedValue,
                'cascade' => $cascade,
            ]);

            $applied[] = [
                'override_id' => $override->id,
                'target' => $target,
                'value' => $requestedValue,
                'computed_value' => $computedValue,
                'cascade' => $cascade,
            ];
        }

        return ['components' => $components, 'applied' => $applied];
    }

    /**
     * Re-derive the structure with one component pinned.
     *
     * Only basic is a true base today — HRA, employer PF and the gratuity
     * provision are all functions of it — so pinning basic means re-deriving
     * from a basic percentage rather than substituting a number and leaving the
     * derived components stale. Any other component is a leaf and can be set
     * directly, with the residual absorbing the difference.
     *
     * @param  array<string, float>  $components
     * @return array<string, float>
     */
    private function recomputeWith(
        string $target,
        float $value,
        float $monthlyCtc,
        array $config,
        array $components
    ): array {
        if ($target === 'basic' && $monthlyCtc > 0) {
            return $this->calculator->calculateSalaryComponents($monthlyCtc, array_merge($config, [
                'basic_percentage' => $value / $monthlyCtc,
            ]));
        }

        $delta = $value - (float) ($components[$target] ?? 0);
        $components[$target] = $value;

        // The residual absorbs it, holding the identity that the components
        // sum to gross.
        if (array_key_exists('special_allowance', $components)) {
            $components['special_allowance'] -= $delta;
        }

        return $components;
    }

    /**
     * Every component that moved, other than the one that was overridden.
     *
     * @param  array<string, float>  $before
     * @param  array<string, float>  $after
     * @return array<string, array{from: float, to: float, delta: float}>
     */
    private function cascadeBetween(array $before, array $after, string $target): array
    {
        $cascade = [];

        foreach ($after as $component => $value) {
            if ($component === $target) {
                continue;
            }

            $wasValue = (float) ($before[$component] ?? 0);
            $delta = (float) $value - $wasValue;

            if (abs($delta) < 0.01) {
                continue;
            }

            $cascade[$component] = [
                'from' => round($wasValue, 2),
                'to' => round((float) $value, 2),
                'delta' => round($delta, 2),
            ];
        }

        return $cascade;
    }
}
