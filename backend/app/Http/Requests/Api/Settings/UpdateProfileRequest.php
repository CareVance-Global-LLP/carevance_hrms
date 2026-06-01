<?php

namespace App\Http\Requests\Api\Settings;

use App\Http\Requests\Api\ApiFormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class UpdateProfileRequest extends ApiFormRequest
{
    public function rules(): array
    {
        $user = $this->user();
        $userId = $user?->id;
        $emailRules = ['sometimes', 'required', 'email', 'max:255'];

        if ($user?->getHierarchyLevel() <= 10) {
            $emailRules[] = Rule::unique('users', 'email')->ignore($userId);
        }

        return [
            'name' => 'required|string|max:255',
            'email' => $emailRules,
            'avatar' => 'nullable|string|max:500',
            'avatar_file' => 'nullable|file|image|max:2048',
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            $user = $this->user();

            if (! $user || $user->getHierarchyLevel() <= 10 || ! $this->has('email')) {
                return;
            }

            $requestedEmail = mb_strtolower(trim((string) $this->input('email')));
            $currentEmail = mb_strtolower(trim((string) $user->email));

            if ($requestedEmail !== '' && $requestedEmail !== $currentEmail) {
                $validator->errors()->add('email', 'Only admins can change their own email from settings.');
            }
        });
    }
}
