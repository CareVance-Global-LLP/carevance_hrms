<?php

namespace App\Services\Payroll;

use App\Models\Payroll;

interface PayrollPayoutService
{
    /**
     * @return array{provider:string,transaction_id:?string,status:string,raw_response:array,checkout_url?:?string}
     */
    public function payout(Payroll $payroll, ?string $simulateStatus = null): array;
}
