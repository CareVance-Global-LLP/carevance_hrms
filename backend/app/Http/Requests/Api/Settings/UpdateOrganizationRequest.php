<?php

namespace App\Http\Requests\Api\Settings;

use App\Http\Requests\Api\ApiFormRequest;
use App\Rules\ValidTimezone;

class UpdateOrganizationRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'name' => 'required|string|max:255',
            'slug' => 'required|string|max:255',
            'office_start_time' => ['nullable', 'string', 'regex:/^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$/'],
            'late_after_time' => ['nullable', 'string', 'regex:/^([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?$/'],
            'logo_file' => 'nullable|file|image|max:2048',
            'leave_categories' => 'nullable|array|max:15',
            'leave_categories.*.code' => 'required_with:leave_categories|string|max:50',
            'leave_categories.*.name' => 'required_with:leave_categories|string|max:120',
            'leave_categories.*.annual_quota' => 'required_with:leave_categories|numeric|min:0|max:366',
            'leave_categories_json' => 'nullable|string',
            'timezone' => ['nullable', 'string', 'max:255', new ValidTimezone],
        ];
    }
}
