<?php

namespace App\Http\Controllers\Api\WorkingTime;

use App\Models\EmployeePenalisationPolicy;
use App\Models\PenalisationHalfDayRule;
use App\Models\PenalisationPolicy;
use Illuminate\Database\Eloquent\Model;

/**
 * Grace, late rules, no-show and LOP.
 *
 * The half-day ladder is a child collection, not a field. It arrives as
 * `half_day_rules` and is written REPLACE-ALL: the ladder is an ordered whole,
 * and appending to it would leave yesterday's bands live alongside today's with
 * a resolver free to match either. Omitting the key entirely leaves the
 * existing ladder alone, so a PATCH that only renames the policy does not wipe
 * it.
 *
 * sort_order defaults to the position the caller sent, because the ladder is
 * read lowest band first and a UI that lets someone drag the rungs into order
 * should not have to invent numbers to say so.
 */
class PenalisationPolicyController extends WorkingTimePolicyController
{
    protected function policyClass(): string
    {
        return PenalisationPolicy::class;
    }

    protected function assignmentClass(): string
    {
        return EmployeePenalisationPolicy::class;
    }

    protected function policyForeignKey(): string
    {
        return 'penalisation_policy_id';
    }

    protected function auditKey(): string
    {
        return 'working_time.penalisation_policy';
    }

    protected function childKeys(): array
    {
        return ['half_day_rules'];
    }

    protected function eagerLoads(): array
    {
        return ['halfDayRules'];
    }

    protected function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],

            // "Minutes before penalisation starts."
            'grace_period_minutes' => ['sometimes', 'integer', 'min:0', 'max:1440'],

            'late_rule_type' => ['sometimes', 'in:incident,hours'],
            // Incidents when the rule is incident-based, hours when it is not —
            // one column, two readings, which is why it is not an integer.
            'late_threshold' => ['sometimes', 'numeric', 'min:0', 'max:9999.99'],
            'exemptions_per_cycle' => ['sometimes', 'integer', 'min:0', 'max:999'],
            'cycle' => ['sometimes', 'in:weekly,monthly'],
            'ignore_late_when_hours_met' => ['sometimes', 'boolean'],
            'hours_basis' => ['sometimes', 'in:gross,effective'],
            // Null means the organization runs no no-show rule at all, which is
            // a different fact from a threshold of zero.
            'no_show_below_hours' => ['sometimes', 'nullable', 'numeric', 'min:0', 'max:24'],
            'treat_penalties_as_lop' => ['sometimes', 'boolean'],
            'is_default' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],

            'half_day_rules' => ['sometimes', 'array', 'max:20'],
            'half_day_rules.*.percent_of_shift_hours' => ['required', 'numeric', 'min:0', 'max:100'],
            'half_day_rules.*.leaves_deducted' => ['required', 'numeric', 'min:0', 'max:99.99'],
            'half_day_rules.*.sort_order' => ['sometimes', 'integer', 'min:0', 'max:999'],
        ];
    }

    /** @param array<string, mixed> $data */
    protected function saveChildren(Model $policy, array $data): void
    {
        if (! array_key_exists('half_day_rules', $data)) {
            return;
        }

        PenalisationHalfDayRule::forOrganization((int) $policy->organization_id)
            ->where('penalisation_policy_id', $policy->id)
            ->delete();

        foreach (array_values((array) $data['half_day_rules']) as $position => $rung) {
            PenalisationHalfDayRule::create([
                'organization_id' => $policy->organization_id,
                'penalisation_policy_id' => $policy->id,
                'sort_order' => (int) ($rung['sort_order'] ?? $position),
                'percent_of_shift_hours' => $rung['percent_of_shift_hours'],
                'leaves_deducted' => $rung['leaves_deducted'],
            ]);
        }
    }
}
