<?php

namespace App\Http\Requests\Api\Auth;

use App\Http\Requests\Api\ApiFormRequest;
use Illuminate\Validation\Rules\Password;

class ResetPasswordRequest extends ApiFormRequest
{
    protected function prepareForValidation(): void
    {
        $this->merge([
            'email' => mb_strtolower(trim((string) $this->input('email', ''))),
            'token' => trim((string) $this->input('token', '')),
        ]);
    }

    public function rules(): array
    {
        return [
            'email' => 'required|email|max:255',
            'token' => 'required|string',
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
        ];
    }
}
