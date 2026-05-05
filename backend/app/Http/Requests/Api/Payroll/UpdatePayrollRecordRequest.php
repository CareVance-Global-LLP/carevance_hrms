<?php

namespace App\Http\Requests\Api\Payroll;

use App\Http\Requests\Api\ApiFormRequest;

class UpdatePayrollRecordRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'basic_salary' => 'nullable|numeric|min:0',
            'allowances' => 'nullable|numeric|min:0',
            'deductions' => 'nullable|numeric|min:0',
            'bonus' => 'nullable|numeric|min:0',
            'tax' => 'nullable|numeric|min:0',
            'payroll_status' => 'nullable|in:draft,validated,manager_approved,finance_approved,processed,paid',
            'payout_method' => 'nullable|in:mock,stripe,bank_transfer',
        ];
    }
}
