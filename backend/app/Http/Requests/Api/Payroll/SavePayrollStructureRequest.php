<?php

namespace App\Http\Requests\Api\Payroll;

use App\Http\Requests\Api\ApiFormRequest;

class SavePayrollStructureRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'user_id' => 'required|integer',
            'basic_salary' => 'required|numeric|min:0',
            'currency' => 'nullable|in:INR,USD',
            'effective_from' => 'required|date',
            'allowances' => 'nullable|array',
            'allowances.*.name' => 'required_with:allowances|string|max:100',
            'allowances.*.calculation_type' => 'required_with:allowances|in:fixed,percentage',
            'allowances.*.amount' => 'required_with:allowances|numeric|min:0',
            'deductions' => 'nullable|array',
            'deductions.*.name' => 'required_with:deductions|string|max:100',
            'deductions.*.calculation_type' => 'required_with:deductions|in:fixed,percentage',
            'deductions.*.amount' => 'required_with:deductions|numeric|min:0',
        ];
    }
}
