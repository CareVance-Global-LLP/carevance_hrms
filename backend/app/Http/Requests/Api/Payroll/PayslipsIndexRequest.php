<?php

namespace App\Http\Requests\Api\Payroll;

use App\Http\Requests\Api\ApiFormRequest;

class PayslipsIndexRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'user_id' => 'nullable|integer',
            'period_month' => ['nullable', 'regex:/^\d{4}\-\d{2}$/'],
        ];
    }
}
