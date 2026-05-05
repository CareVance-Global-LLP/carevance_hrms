<?php

namespace App\Http\Requests\Api\Payroll;

use App\Http\Requests\Api\ApiFormRequest;

class GeneratePayrollRecordsRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'payroll_month' => ['required', 'regex:/^\d{4}\-\d{2}$/'],
            'user_id' => 'nullable|integer',
            'allow_overwrite' => 'nullable|boolean',
            'payout_method' => 'nullable|in:mock,stripe,bank_transfer',
        ];
    }
}
