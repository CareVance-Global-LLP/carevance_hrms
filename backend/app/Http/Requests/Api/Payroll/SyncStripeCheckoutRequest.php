<?php

namespace App\Http\Requests\Api\Payroll;

use App\Http\Requests\Api\ApiFormRequest;

class SyncStripeCheckoutRequest extends ApiFormRequest
{
    public function rules(): array
    {
        return [
            'checkout_session_id' => 'required|string',
        ];
    }
}
