<?php

namespace App\Services\Payroll;

use App\Models\Payroll;
use Illuminate\Support\Str;

class MockPayrollPayoutService implements PayrollPayoutService
{
    public function payout(Payroll $payroll, ?string $simulateStatus = null): array
    {
        $status = in_array($simulateStatus, ['success', 'failed', 'pending'], true)
            ? $simulateStatus
            : 'success';

        return [
            'provider' => 'mock',
            'transaction_id' => 'mock_'.Str::uuid()->toString(),
            'status' => $status,
            'checkout_url' => null,
            'raw_response' => [
                'mode' => 'mock',
                'simulated_status' => $status,
                'payroll_id' => $payroll->id,
            ],
        ];
    }
}
