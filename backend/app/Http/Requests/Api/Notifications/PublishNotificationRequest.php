<?php

namespace App\Http\Requests\Api\Notifications;

use App\Http\Requests\Api\ApiFormRequest;

class PublishNotificationRequest extends ApiFormRequest
{
    public function rules(): array
    {
        $rules = [
            'type' => 'required|in:announcement,news,poll',
            'title' => 'required|string|max:150',
            'message' => 'required|string|max:3000',
            'priority' => 'nullable|in:low,medium,high,urgent',
            'recipient_user_ids' => 'nullable|array',
            'recipient_user_ids.*' => 'integer',
        ];

        // Poll-specific validation
        if ($this->input('type') === 'poll') {
            $rules['title'] = 'sometimes|nullable|string|max:150';
            $rules['message'] = 'sometimes|nullable|string';
            $rules['question'] = 'required|string|max:255';
            $rules['options'] = 'required|array|min:2';
            $rules['options.*'] = 'required|string|max:255';
            $rules['is_multiple_choice'] = 'sometimes|boolean';
            $rules['expires_at'] = 'nullable|date|after:now';
        }

        return $rules;
    }

    public function messages(): array
    {
        return [
            'options.min' => 'Polls must have at least 2 options.',
            'question.required' => 'Question is required for polls.',
        ];
    }
}
