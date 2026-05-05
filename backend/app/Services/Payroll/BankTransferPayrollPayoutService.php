<?php

namespace App\Services\Payroll;

use App\Models\Payroll;
use Illuminate\Support\Str;

class BankTransferPayrollPayoutService implements PayrollPayoutService
{
    public function payout(Payroll $payroll, ?string $simulateStatus = null): array
    {
        $status = in_array($simulateStatus, ['success', 'failed', 'pending'], true)
            ? $simulateStatus
            : 'pending';

        return [
            'provider' => 'bank_transfer',
            'transaction_id' => 'bank_'.Str::uuid()->toString(),
            'status' => $status,
            'checkout_url' => null,
            'raw_response' => [
                'mode' => 'bank_transfer',
                'simulated_status' => $status,
                'payroll_id' => $payroll->id,
                'payment_reference' => sprintf('BANK-%s-%s', $payroll->payroll_month, $payroll->id),
            ],
        ];
    }
}
