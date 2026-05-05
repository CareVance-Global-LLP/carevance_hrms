<?php

namespace App\Http\Requests\Api\Payroll;

use App\Http\Requests\Api\ApiFormRequest;

class GeneratePayslipRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'user_id' => 'required|integer',
            'period_month' => ['required', 'regex:/^\d{4}\-\d{2}$/'],
            'payroll_structure_id' => 'nullable|integer',
        ];
    }
}
