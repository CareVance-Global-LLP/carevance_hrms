<?php

namespace App\Http\Controllers\Api\WorkingTime;

use App\Models\EmployeeShiftAllowancePolicy;
use App\Models\Shift;
use App\Models\ShiftAllowancePolicy;

/**
 * The night and weekend premium.
 *
 * The two window columns are SQL TIME — wall-clock readings with no date,
 * because the window crosses midnight by definition. They are accepted as H:i
 * or H:i:s and normalised on the way in exactly as the shift's times are, so a
 * "22:00" typed in a form and a "22:00:00" sent by an integration store
 * identically.
 *
 * night_allowance_type carries "none" rather than being nullable, so
 * "configured to pay nothing" and "never configured" stay distinguishable from
 * the row alone. ShiftAllowanceEngine reads that distinction to decide whether
 * to fall through to the shift's own differential columns.
 */
class ShiftAllowancePolicyController extends WorkingTimePolicyController
{
    protected function policyClass(): string
    {
        return ShiftAllowancePolicy::class;
    }

    protected function assignmentClass(): string
    {
        return EmployeeShiftAllowancePolicy::class;
    }

    protected function policyForeignKey(): string
    {
        return 'shift_allowance_policy_id';
    }

    protected function auditKey(): string
    {
        return 'working_time.shift_allowance_policy';
    }

    protected function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],

            'night_allowance_type' => ['sometimes', 'in:none,percentage,fixed'],
            'night_percentage' => ['sometimes', 'numeric', 'min:0', 'max:999.99'],
            'night_fixed' => ['sometimes', 'numeric', 'min:0', 'max:99999999.99'],
            'night_window_start' => ['sometimes', 'nullable', 'date_format:H:i,H:i:s'],
            'night_window_end' => ['sometimes', 'nullable', 'date_format:H:i,H:i:s'],
            // 0 means any overlap qualifies; the engine still requires at least
            // one minute inside the window.
            'night_minimum_minutes_in_window' => ['sometimes', 'integer', 'min:0', 'max:1440'],

            'weekend_allowance_type' => ['sometimes', 'in:none,percentage,fixed'],
            'weekend_percentage' => ['sometimes', 'numeric', 'min:0', 'max:999.99'],
            'weekend_fixed' => ['sometimes', 'numeric', 'min:0', 'max:99999999.99'],

            'is_default' => ['sometimes', 'boolean'],
            'is_active' => ['sometimes', 'boolean'],
        ];
    }

    /**
     * @param array<string, mixed> $data
     * @return array<string, mixed>
     */
    protected function afterValidation(array $data): array
    {
        foreach (['night_window_start', 'night_window_end'] as $key) {
            if (array_key_exists($key, $data)) {
                $data[$key] = Shift::normalizeTime($data[$key]);
            }
        }

        return $data;
    }
}
