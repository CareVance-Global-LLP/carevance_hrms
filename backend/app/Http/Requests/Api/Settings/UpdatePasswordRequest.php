<?php

namespace App\Http\Requests\Api\Settings;

use App\Http\Requests\Api\ApiFormRequest;
use Illuminate\Validation\Rules\Password;

class UpdatePasswordRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'current_password' => 'required|string',
            'new_password' => ['required', 'string', 'confirmed', Password::defaults()],
        ];
    }
}
