<?php

namespace App\Services;

use App\Models\BankApiConfig;
use App\Models\BankTransferBatch;
use App\Models\BankTransferItem;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

class BankIntegrationService
{
    public function validateBeneficiary(BankApiConfig $config, string $accountNumber, string $ifsc): array
    {
        $endpoint = $config->beneficiary_validation_endpoint ?? $config->api_endpoint . '/validate';

        $response = Http::withHeaders([
            'Authorization' => 'Bearer ' . $config->api_token,
            'X-API-Key' => $config->api_key,
        ])->post($endpoint, [
            'account_number' => $accountNumber,
            'ifsc' => $ifsc,
        ]);

        if ($response->successful()) {
            $data = $response->json();
            return [
                'valid' => $data['valid'] ?? false,
                'beneficiary_name' => $data['beneficiary_name'] ?? '',
                'bank_name' => $data['bank_name'] ?? '',
                'message' => $data['message'] ?? '',
            ];
        }

        return ['valid' => false, 'beneficiary_name' => '', 'bank_name' => '', 'message' => $response->body()];
    }

    public function createTransferBatch(PayrollMonthlyRun $run, int $orgId, int $createdBy, string $bankName = null): BankTransferBatch
    {
        $items = $run->items()->with('user.employeeBankAccounts')->where('net_pay', '>', 0)->get();
        $config = BankApiConfig::where('organization_id', $orgId)
            ->when($bankName, fn($q, $b) => $q->where('bank_name', $b))
            ->where('is_active', true)
            ->first();

        $batch = BankTransferBatch::create([
            'organization_id' => $orgId,
            'payroll_run_id' => $run->id,
            'batch_reference' => 'BATCH-' . strtoupper(Str::random(8)) . '-' . time(),
            'bank_name' => $config->bank_name ?? $bankName ?? 'GENERAL',
            'total_amount' => $items->sum('net_pay'),
            'total_transactions' => $items->count(),
            'status' => 'pending',
            'file_format' => 'csv',
            'created_by' => $createdBy,
        ]);

        foreach ($items as $item) {
            $bankAccount = $item->user->employeeBankAccounts->first();
            BankTransferItem::create([
                'organization_id' => $orgId,
                'bank_transfer_batch_id' => $batch->id,
                'user_id' => $item->user_id,
                'payroll_item_id' => $item->id,
                'beneficiary_name' => $bankAccount->account_holder_name ?? $item->user->name,
                'beneficiary_account' => $bankAccount->account_number ?? '',
                'beneficiary_ifsc' => $bankAccount->ifsc_code ?? '',
                'amount' => $item->net_pay,
                'status' => 'pending',
            ]);
        }

        return $batch;
    }

    public function processBatchTransfer(BankTransferBatch $batch): BankTransferBatch
    {
        $config = BankApiConfig::where('organization_id', $batch->organization_id)
            ->where('bank_name', $batch->bank_name)
            ->where('is_active', true)
            ->first();

        if (!$config || !$config->bulk_transfer_endpoint) {
            $batch->update(['status' => 'failed', 'error_message' => 'No active bank API config']);
            return $batch;
        }

        $batch->update(['status' => 'processing']);

        $items = $batch->items()->where('status', 'pending')->get();
        $payload = [
            'batch_reference' => $batch->batch_reference,
            'debit_account' => $config->account_number,
            'transactions' => $items->map(fn($i) => [
                'transaction_id' => 'TXN-' . $i->id,
                'beneficiary_name' => $i->beneficiary_name,
                'beneficiary_account' => $i->beneficiary_account,
                'beneficiary_ifsc' => $i->beneficiary_ifsc,
                'amount' => $i->amount,
                'remarks' => 'Salary-' . $batch->payrollRun?->month_year,
            ])->toArray(),
        ];

        try {
            $response = Http::withHeaders([
                'Authorization' => 'Bearer ' . $config->api_token,
                'X-API-Key' => $config->api_key,
                'Content-Type' => 'application/json',
            ])->timeout(60)->post($config->bulk_transfer_endpoint, $payload);

            $responseData = $response->json();
            $batch->update([
                'api_response' => $responseData,
                'status' => $response->successful() ? 'completed' : 'failed',
                'error_message' => $response->successful() ? null : ($responseData['message'] ?? 'API Error'),
                'completed_at' => $response->successful() ? now() : null,
            ]);

            foreach ($items as $item) {
                $status = 'pending';
                $txnRef = null;
                $failureReason = null;

                if ($response->successful()) {
                    $txnData = collect($responseData['transactions'] ?? [])
                        ->firstWhere('transaction_id', 'TXN-' . $item->id);
                    $status = ($txnData['status'] ?? '') === 'success' ? 'success' : 'failed';
                    $txnRef = $txnData['reference'] ?? null;
                    $failureReason = $txnData['failure_reason'] ?? null;
                }

                $item->update([
                    'status' => $status,
                    'transaction_reference' => $txnRef,
                    'failure_reason' => $failureReason,
                    'api_response' => $responseData,
                    'processed_at' => now(),
                ]);
            }

            $successCount = $batch->items()->where('status', 'success')->count();
            $failureCount = $batch->items()->where('status', 'failed')->count();
            $batch->update([
                'success_count' => $successCount,
                'failure_count' => $failureCount,
                'status' => $failureCount > 0 && $successCount > 0 ? 'partially_completed' : ($failureCount === 0 ? 'completed' : 'failed'),
            ]);
        } catch (\Throwable $e) {
            $batch->update([
                'status' => 'failed',
                'error_message' => $e->getMessage(),
            ]);
        }

        return $batch;
    }

    public function generateBankFile(BankTransferBatch $batch, string $format = 'csv'): string
    {
        $items = $batch->items()->get();
        $content = '';

        if ($format === 'xml') {
            $xml = new \SimpleXMLElement('<?xml version="1.0" encoding="UTF-8"?><Payments></Payments>');
            foreach ($items as $item) {
                $txn = $xml->addChild('Transaction');
                $txn->addChild('BeneficiaryName', htmlspecialchars($item->beneficiary_name));
                $txn->addChild('AccountNumber', $item->beneficiary_account);
                $txn->addChild('IFSC', $item->beneficiary_ifsc);
                $txn->addChild('Amount', number_format($item->amount, 2, '.', ''));
                $txn->addChild('Remarks', 'Salary Payment');
            }
            $content = $xml->asXML();
        } else {
            $lines = [];
            $lines[] = 'BeneficiaryName,AccountNumber,IFSC,Amount,Remarks';
            foreach ($items as $item) {
                $lines[] = sprintf(
                    '"%s","%s","%s",%.2f,"Salary-%s"',
                    $item->beneficiary_name,
                    $item->beneficiary_account,
                    $item->beneficiary_ifsc,
                    $item->amount,
                    $batch->payrollRun?->month_year ?? '',
                );
            }
            $content = implode("\n", $lines);
        }

        $filename = sprintf('bank_file_%s_%s.%s', $batch->bank_name, $batch->batch_reference, $format);
        $path = "bank_files/{$batch->organization_id}/{$filename}";
        Storage::disk('local')->put($path, $content);

        $batch->update([
            'file_path' => $path,
            'file_format' => $format,
        ]);

        return $path;
    }

    public function initiatePaymentReversal(int $payrollItemId, string $reason, int $requestedBy): \App\Models\PaymentReversal
    {
        $item = PayrollItem::findOrFail($payrollItemId);
        $transferItem = BankTransferItem::where('payroll_item_id', $payrollItemId)
            ->where('status', 'success')
            ->first();

        return \App\Models\PaymentReversal::create([
            'organization_id' => $item->organization_id,
            'user_id' => $item->user_id,
            'payroll_item_id' => $payrollItemId,
            'bank_transfer_item_id' => $transferItem?->id,
            'amount' => $item->net_pay,
            'reason' => $reason,
            'status' => 'pending',
            'requested_by' => $requestedBy,
        ]);
    }
}
