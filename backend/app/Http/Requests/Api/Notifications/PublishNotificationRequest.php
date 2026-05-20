<?php

namespace App\Http\Requests\Api\Notifications;

use App\Http\Requests\Api\ApiFormRequest;

class PublishNotificationRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'type' => 'required|in:announcement,news',
            'title' => 'required|string|max:150',
            'message' => 'required|string|max:3000',
            'priority' => 'nullable|in:low,medium,high,urgent',
            'recipient_user_ids' => 'nullable|array',
            'recipient_user_ids.*' => 'integer',
        ];
    }
}
