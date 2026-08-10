<?php

namespace App\Services\Payroll;

use App\Models\Payroll;
use Illuminate\Support\Str;

/**
 * A payout provider that settles nothing.
 *
 * Used to exercise the payout workflow — success, failure and pending branches —
 * without contacting a real payment gateway. The caller chooses the outcome, so
 * the failure and pending paths can be tested deterministically rather than
 * only when a real provider happens to misbehave.
 *
 * This must never be wired up in production; it reports success without moving
 * money.
 */
class MockPayrollPayoutService
{
    public const MODE_SUCCESS = 'success';
    public const MODE_FAILED = 'failed';
    public const MODE_PENDING = 'pending';

    /**
     * @return array{provider:string,status:string,transaction_id:string,amount:float,payroll_id:int|null,message:string}
     */
    public function payout(Payroll $payroll, string $mode = self::MODE_SUCCESS): array
    {
        $status = in_array($mode, [self::MODE_SUCCESS, self::MODE_FAILED, self::MODE_PENDING], true)
            ? $mode
            : self::MODE_FAILED;

        return [
            'provider' => 'mock',
            'status' => $status,
            // Always issued, including on failure, so a failed attempt can still
            // be correlated with its log entry.
            'transaction_id' => 'MOCK-'.Str::upper(Str::random(16)),
            'amount' => (float) ($payroll->net_salary ?? 0),
            'payroll_id' => $payroll->id ? (int) $payroll->id : null,
            'message' => match ($status) {
                self::MODE_SUCCESS => 'Mock payout completed.',
                self::MODE_PENDING => 'Mock payout accepted and pending settlement.',
                default => 'Mock payout failed.',
            },
        ];
    }
}
