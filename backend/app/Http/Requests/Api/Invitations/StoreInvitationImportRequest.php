<?php

namespace App\Http\Requests\Api\Invitations;

use App\Http\Requests\Api\ApiFormRequest;
use Illuminate\Validation\Rule;

class StoreInvitationImportRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'rows' => 'required|array|min:1|max:1000',
            'rows.*.email' => 'required|string|email|max:255',
            'rows.*.role' => ['required', 'string', Rule::in(['admin', 'manager', 'employee', 'client'])],
            'rows.*.group_ids' => 'nullable|array',
            'rows.*.group_ids.*' => 'integer',
            'rows.*.project_ids' => 'nullable|array',
            'rows.*.project_ids.*' => 'integer',
            'rows.*.job_title' => 'nullable|string|max:255',
            'rows.*.settings' => 'nullable|array',
            'rows.*.settings.monitoring_interval_minutes' => ['nullable', 'integer', Rule::in([1, 3, 5, 10, 15, 30])],
            'rows.*.settings.can_edit_time' => 'nullable|boolean',
            'rows.*.settings.attendance_monitoring' => 'nullable|boolean',
            'rows.*.settings.payroll_visibility' => 'nullable|boolean',
            'rows.*.settings.task_assignment_access' => 'nullable|boolean',
            'default_group_ids' => 'nullable|array',
            'default_group_ids.*' => 'integer',
            'default_project_ids' => 'nullable|array',
            'default_project_ids.*' => 'integer',
            'settings' => 'nullable|array',
            'settings.monitoring_interval_minutes' => ['nullable', 'integer', Rule::in([1, 3, 5, 10, 15, 30])],
            'settings.can_edit_time' => 'nullable|boolean',
            'settings.attendance_monitoring' => 'nullable|boolean',
            'settings.payroll_visibility' => 'nullable|boolean',
            'settings.task_assignment_access' => 'nullable|boolean',
            'expires_in_hours' => 'nullable|integer|min:1|max:720',
        ];
    }
}
