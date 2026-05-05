<?php

namespace App\Services\Payroll;

class PayrollPayoutManager
{
    public function __construct(
        private readonly BankTransferPayrollPayoutService $bankTransferPayoutService,
        private readonly MockPayrollPayoutService $mockPayoutService,
        private readonly StripePayrollPayoutService $stripePayoutService,
    ) {
    }

    public function resolveForCurrentMode(): PayrollPayoutService
    {
        return $this->resolveForPayoutMethod($this->normalizePayoutMethod());
    }

    public function resolveForPayoutMethod(?string $payoutMethod = null): PayrollPayoutService
    {
        return match ($this->normalizePayoutMethod($payoutMethod)) {
            'stripe' => $this->stripePayoutService,
            'bank_transfer' => $this->bankTransferPayoutService,
            default => $this->mockPayoutService,
        };
    }

    public function normalizePayoutMethod(?string $payoutMethod = null): string
    {
        if ($payoutMethod === 'stripe') {
            return 'stripe';
        }

        if ($payoutMethod === 'bank_transfer') {
            return 'bank_transfer';
        }

        if ($payoutMethod === 'mock') {
            return 'mock';
        }

        return in_array($this->mode(), ['stripe_test', 'stripe_live'], true)
            ? 'stripe'
            : 'mock';
    }

    public function mode(): string
    {
        return (string) config('payroll.mode', 'mock');
    }
}
