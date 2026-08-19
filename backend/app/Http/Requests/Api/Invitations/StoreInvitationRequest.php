<?php

namespace App\Http\Requests\Api\Invitations;

use App\Http\Requests\Api\ApiFormRequest;
use App\Rules\ValidTimezone;
use App\Services\Monitoring\MonitoringSettingsResolver;
use Illuminate\Validation\Rule;

class StoreInvitationRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $hasGroupIds = $this->exists('group_ids');
        $hasDepartmentIds = $this->exists('department_ids');

        if (! $hasDepartmentIds) {
            return;
        }

        if (! $hasGroupIds) {
            $this->merge([
                'group_ids' => $this->input('department_ids'),
            ]);

            return;
        }

        $groupIds = $this->input('group_ids');
        $departmentIds = $this->input('department_ids');

        if (is_array($groupIds) && is_array($departmentIds)) {
            $this->merge([
                'group_ids' => array_values(array_unique(array_merge($groupIds, $departmentIds))),
            ]);
        }
    }

    public function rules(): array
    {
        return [
            'email' => 'nullable|string|email|max:255',
            'emails' => 'nullable|array|min:1|max:50',
            'emails.*' => 'required|string|email|max:255|distinct:ignore_case',
            'role' => ['required', 'string', Rule::in(['admin', 'manager', 'employee', 'client'])],
            'delivery' => ['nullable', 'string', Rule::in(['email', 'link'])],
            'expires_in_hours' => 'nullable|integer|min:1|max:720',
            // No lower bound: entering a joiner late and backdating their start
            // is legitimate. The upper bound matches the Create User wizard, so
            // both paths agree on what a plausible start date looks like.
            'joining_date' => 'nullable|date|before_or_equal:'.now()->addYears(2)->format('Y-m-d'),
            'job_title' => 'nullable|string|max:255',
            // The organisation's own employee code. Scalar form is for a
            // single recipient; `employee_codes` maps email => code so a batch
            // can carry one per person. Length matches employee_work_infos.
            // An admin-defined role for this organisation. Ownership and the
            // matching base role are resolved server-side, not trusted here.
            'role_id' => 'nullable|integer',
            'employee_code' => 'nullable|string|max:80',
            'employee_codes' => 'nullable|array',
            'employee_codes.*' => 'nullable|string|max:80',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
            'project_ids' => 'nullable|array',
            'project_ids.*' => 'integer',
            'settings' => 'nullable|array',
            'settings.monitoring_interval_minutes' => ['nullable', 'integer', Rule::in(app(MonitoringSettingsResolver::class)->allowedIntervals())],
            'settings.can_edit_time' => 'nullable|boolean',
            'settings.attendance_monitoring' => 'nullable|boolean',
            'settings.payroll_visibility' => 'nullable|boolean',
            'settings.task_assignment_access' => 'nullable|boolean',
            'settings.timezone' => ['nullable', 'string', 'max:255', new ValidTimezone],
        ];
    }

    public function withValidator($validator): void
    {
        $validator->after(function ($validator) {
            if (!filled($this->input('email')) && empty($this->input('emails', []))) {
                $validator->errors()->add('emails', 'At least one email address is required.');
            }

            if (($this->input('delivery') ?? 'email') === 'link') {
                $emails = collect($this->input('emails', []))
                    ->push($this->input('email'))
                    ->filter(fn ($value) => filled($value));

                if ($emails->count() !== 1) {
                    $validator->errors()->add('email', 'Single-use invite links require exactly one email address.');
                }
            }
        });
    }
}
