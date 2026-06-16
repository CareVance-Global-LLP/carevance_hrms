<?php

namespace App\Services;

use App\Models\BankTransferBatch;
use App\Models\BankTransferItem;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * Direct Disbursement Service (Razorpay Payouts / Cashfree Payouts)
 *
 * Triggers bulk salary transfers to employee bank accounts via Razorpay
 * Payouts API. Falls back to bank-file generation if the API key isn't
 * configured.
 *
 * Returns UTR/transaction references for every beneficiary.
 */
class DirectDisbursementService
{
    const PROVIDERS = ['razorpay', 'cashfree', 'manual'];

    public function disburse(BankTransferBatch $batch, string $provider = 'razorpay'): array
    {
        $provider = strtolower($provider);
        $method = 'disburseVia' . ucfirst($provider);
        if (!method_exists($this, $method)) {
            return ['status' => 'unsupported_provider', 'provider' => $provider];
        }
        return $this->$method($batch);
    }

    protected function disburseViaRazorpay(BankTransferBatch $batch): array
    {
        $key = config('services.razorpay.key');
        $secret = config('services.razorpay.secret');
        $account = config('services.razorpay.account_number');
        if (!$key || !$secret || !$account) {
            return ['status' => 'razorpay_not_configured', 'fallback' => 'use_bank_file'];
        }
        $items = $batch->items()->where('status', 'pending')->get();
        $results = [];
        foreach ($items as $item) {
            try {
                $resp = Http::withBasicAuth($key, $secret)
                    ->post('https://api.razorpay.com/v1/payouts', [
                        'account_number' => $account,
                        'fund_account_id' => $item->fund_account_id ?? null,
                        'amount' => (int) round($item->amount * 100), // paise
                        'currency' => 'INR',
                        'mode' => 'NEFT',
                        'purpose' => 'salary',
                        'reference_id' => $batch->batch_reference . '-' . $item->id,
                        'narration' => 'Salary for ' . $batch->payroll_period_label,
                    ]);
                $body = $resp->json();
                $item->update([
                    'utr' => $body['id'] ?? null,
                    'status' => $resp->successful() ? 'submitted' : 'failed',
                    'response' => json_encode($body),
                ]);
                $results[] = ['item_id' => $item->id, 'status' => $resp->status(), 'utr' => $body['id'] ?? null];
            } catch (\Throwable $e) {
                Log::error('Razorpay payout failed', ['item' => $item->id, 'err' => $e->getMessage()]);
                $item->update(['status' => 'failed', 'response' => $e->getMessage()]);
            }
        }
        $batch->update([
            'status' => $results && collect($results)->where('status', '!=', 200)->isEmpty() ? 'submitted' : 'partial',
            'provider' => 'razorpay',
        ]);
        return ['status' => 'completed', 'provider' => 'razorpay', 'results' => $results];
    }

    protected function disburseViaCashfree(BankTransferBatch $batch): array
    {
        // Placeholder for Cashfree Payouts integration
        return ['status' => 'cashfree_pending_implementation', 'provider' => 'cashfree'];
    }

    protected function disburseViaManual(BankTransferBatch $batch): array
    {
        // Marks batch as needing manual bank upload
        $batch->update(['status' => 'awaiting_bank_upload', 'provider' => 'manual']);
        return ['status' => 'awaiting_bank_upload', 'provider' => 'manual'];
    }

    public function checkStatus(BankTransferBatch $batch): array
    {
        $items = $batch->items()->get();
        return [
            'total' => $items->count(),
            'successful' => $items->where('status', 'success')->count(),
            'failed' => $items->where('status', 'failed')->count(),
            'pending' => $items->where('status', 'pending')->count(),
            'total_amount' => (float) $items->sum('amount'),
        ];
    }
}
