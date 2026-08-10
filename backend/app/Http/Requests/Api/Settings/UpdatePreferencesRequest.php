<?php

namespace App\Http\Requests\Api\Settings;

use App\Http\Requests\Api\ApiFormRequest;
use App\Rules\ValidTimezone;

class UpdatePreferencesRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'timezone' => ['nullable', 'string', 'max:64', new ValidTimezone],
            // 'system' defers to the device setting; the client still stores the
            // choice locally so it can apply before this response arrives.
            'theme' => ['nullable', 'string', 'in:light,dark,system'],
            'notifications' => 'nullable|array',
            'notifications.email' => 'nullable|boolean',
            'notifications.in_app' => 'nullable|boolean',
            'notifications.desktop_push' => 'nullable|boolean',
            'notifications.chat_messages' => 'nullable|boolean',
            'notifications.weekly_summary' => 'nullable|boolean',
            'notifications.project_updates' => 'nullable|boolean',
            'notifications.task_assignments' => 'nullable|boolean',
        ];
    }
}
