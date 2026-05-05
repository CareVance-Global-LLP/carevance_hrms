<?php

namespace App\Http\Requests\Api\Payroll;

use App\Http\Requests\Api\ApiFormRequest;

class UpdatePayrollRecordStatusRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'payroll_status' => 'required|in:draft,validated,manager_approved,finance_approved,processed,paid',
        ];
    }
}
