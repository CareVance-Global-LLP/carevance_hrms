<?php

namespace App\Http\Controllers\Api\WorkingTime;

use App\Models\EmployeeWeeklyOffPolicy;
use App\Models\WeeklyOffPolicy;
use Illuminate\Validation\ValidationException;

/**
 * Which days of the week are off.
 *
 * The only interesting validation here is day_rules, and it is interesting for
 * one reason: a rule the model cannot read is not a loud error, it is a day
 * that is silently never marked off. "2nd and 4th Saturday" typed as
 * "alternate saturdays" would store cleanly, resolve to nothing, and mark a
 * whole workforce present on their rest day. So every key and every rule is put
 * through the model's own normaliser before it is allowed near the table, and
 * anything it cannot read is a 422 naming the day.
 */
class WeeklyOffPolicyController extends WorkingTimePolicyController
{
    protected function policyClass(): string
    {
        return WeeklyOffPolicy::class;
    }

    protected function assignmentClass(): string
    {
        return EmployeeWeeklyOffPolicy::class;
    }

    protected function policyForeignKey(): string
    {
        return 'weekly_off_policy_id';
    }

    protected function auditKey(): string
    {
        return 'working_time.weekly_off_policy';
    }

    protected function rules(bool $creating): array
    {
        $required = $creating ? 'required' : 'sometimes';

        return [
            'name' => [$required, 'string', 'max:255'],
            'description' => ['nullable', 'string', 'max:2000'],
            'day_rules' => ['sometimes', 'nullable', 'array'],
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
        if (! array_key_exists('day_rules', $data) || ! is_array($data['day_rules'])) {
            return $data;
        }

        $errors = [];

        foreach ($data['day_rules'] as $key => $rule) {
            if (WeeklyOffPolicy::isoDayFrom($key) === null) {
                $errors['day_rules.'.$key] = "\"{$key}\" is not a weekday this policy can read.";

                continue;
            }

            if (WeeklyOffPolicy::normalizeRule($rule) === null) {
                $errors['day_rules.'.$key] = 'Use "every", a list of ordinals such as [2, 4] or ["last"], or {"mode":"alternate","interval_weeks":2,"anchor_date":"YYYY-MM-DD"}.';
            }
        }

        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $data;
    }
}
