<?php

namespace App\Http\Requests\Api\Payroll;

use App\Http\Requests\Api\ApiFormRequest;

class PayrollRecordsIndexRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'user_id' => 'nullable|integer',
            'payroll_month' => ['nullable', 'regex:/^\d{4}\-\d{2}$/'],
            'payroll_status' => 'nullable|in:draft,processed,paid',
            'payout_status' => 'nullable|in:pending,success,failed',
            'payout_method' => 'nullable|in:mock,stripe',
        ];
    }
}
