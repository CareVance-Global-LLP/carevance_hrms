<?php

namespace App\Http\Requests\Api\Invitations;

use App\Http\Requests\Api\ApiFormRequest;
use Illuminate\Validation\Rule;

class StoreInvitationRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'email' => 'nullable|string|email|max:255',
            'emails' => 'nullable|array|min:1|max:50',
            'emails.*' => 'required|string|email|max:255|distinct:ignore_case',
            'role' => ['required', 'string', Rule::in(['admin', 'manager', 'employee', 'client'])],
            'delivery' => ['nullable', 'string', Rule::in(['email', 'link'])],
            'expires_in_hours' => 'nullable|integer|min:1|max:720',
            'group_ids' => 'nullable|array',
            'group_ids.*' => 'integer',
            'project_ids' => 'nullable|array',
            'project_ids.*' => 'integer',
            'settings' => 'nullable|array',
            'settings.monitoring_interval_minutes' => ['nullable', 'integer', Rule::in([1, 3, 5, 10, 15, 30])],
            'settings.can_edit_time' => 'nullable|boolean',
            'settings.attendance_monitoring' => 'nullable|boolean',
            'settings.payroll_visibility' => 'nullable|boolean',
            'settings.task_assignment_access' => 'nullable|boolean',
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
