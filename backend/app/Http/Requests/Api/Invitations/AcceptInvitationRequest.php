<?php

namespace App\Http\Requests\Api\Invitations;

use App\Http\Requests\Api\ApiFormRequest;
use App\Rules\ValidTimezone;

class AcceptInvitationRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'name' => 'required|string|max:255',
            'password' => 'required|string|min:8|confirmed',
            'timezone' => ['nullable', 'string', 'max:255', new ValidTimezone],
        ];
    }
}
