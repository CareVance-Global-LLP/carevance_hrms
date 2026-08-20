<?php

namespace App\Http\Controllers\Api\WorkingTime;

use App\Models\EmployeeOvertimePolicy;
use App\Models\OvertimePolicy;
use App\Models\OvertimePolicyScope;
use Illuminate\Database\Eloquent\Model;

/**
 * How overtime accrues and what it is worth.
 *
 * The three scopes — working day, weekly off, holiday — arrive as `scopes` and
 * are written REPLACE-ALL for the same reason the half-day ladder is: a stale
 * holiday rate left alongside a new one is two answers to one question, and a
 * resolver would pick between them by accident. Omitting the key leaves the
 * existing set alone.
 *
 * The relation is exposed as `scopes` in the response even though it is called
 * rateScopes() on the model — that name exists only to stay clear of Eloquent's
 * scope machinery, and the API should not inherit a workaround as vocabulary.
 */
class OvertimePolicyController extends WorkingTimePolicyController
{
    protected function policyClass(): string
    {
        return OvertimePolicy::class;
    }

    protected function assignmentClass(): string
    {
        return EmployeeOvertimePolicy::class;
    }

    protected function policyForeignKey(): string
    {
        return 'overtime_policy_id';
    }

    protected function auditKey(): string
    {
        return 'working_time.overtime_policy';
    }

    protected function childKeys(): array
    {
        return ['scopes'];
    }

    protected function eagerLoads(): array
    {
        return ['rateScopes'];
    }

    protected function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],
            'hours_basis' => ['sometimes', 'in:gross,effective'],
            'minimum_minutes_before_accrual' => ['sometimes', 'integer', 'min:0', 'max:1440'],
            'rounding' => ['sometimes', 'in:up,down,nearest'],
            'rounding_increment_minutes' => ['sometimes', 'integer', 'min:1', 'max:240'],
            // "Only approved hours will be considered."
            'requires_approval' => ['sometimes', 'boolean'],
            'pay_code' => ['sometimes', 'nullable', 'string', 'max:255'],
            'is_default' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],

            'scopes' => ['sometimes', 'array', 'max:30'],
            'scopes.*.scope' => ['required', 'in:working_day,weekly_off,holiday'],
            'scopes.*.treatment' => ['sometimes', 'in:pay,comp_off'],
            'scopes.*.multiplier' => ['sometimes', 'numeric', 'min:0', 'max:999.99'],
            // Extended OT: this row's rate applies only past this much overtime.
            'scopes.*.applies_after_minutes' => ['sometimes', 'integer', 'min:0', 'max:1440'],
            // A seasonal rate's validity window. Null on both ends is always.
            'scopes.*.effective_from' => ['sometimes', 'nullable', 'date'],
            'scopes.*.effective_to' => ['sometimes', 'nullable', 'date', 'after_or_equal:scopes.*.effective_from'],
        ];
    }

    /** @param array<string, mixed> $data */
    protected function saveChildren(Model $policy, array $data): void
    {
        if (! array_key_exists('scopes', $data)) {
            return;
        }

        OvertimePolicyScope::forOrganization((int) $policy->organization_id)
            ->where('overtime_policy_id', $policy->id)
            ->delete();

        foreach ((array) $data['scopes'] as $scope) {
            OvertimePolicyScope::create([
                'organization_id' => $policy->organization_id,
                'overtime_policy_id' => $policy->id,
                'scope' => $scope['scope'],
                'treatment' => $scope['treatment'] ?? OvertimePolicyScope::TREATMENT_PAY,
                'multiplier' => $scope['multiplier'] ?? '1.00',
                'applies_after_minutes' => (int) ($scope['applies_after_minutes'] ?? 0),
                'effective_from' => $scope['effective_from'] ?? null,
                'effective_to' => $scope['effective_to'] ?? null,
            ]);
        }
    }

    /** @return array<string, mixed> */
    protected function presentLoaded(Model $policy): array
    {
        $body = parent::presentLoaded($policy);
        $body['scopes'] = array_values($body['rate_scopes'] ?? []);
        unset($body['rate_scopes']);

        return $body;
    }
}
