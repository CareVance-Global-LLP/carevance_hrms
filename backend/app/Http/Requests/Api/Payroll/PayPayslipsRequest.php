<?php

namespace App\Http\Requests\Api\Payroll;

use App\Http\Requests\Api\ApiFormRequest;

class PayPayslipsRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'payslip_ids' => 'required|array|min:1',
            'payslip_ids.*' => 'integer',
        ];
    }
}
