<?php

namespace App\Services\Payroll;

use App\Models\BankTransferBatch;
use App\Models\BankTransferItem;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Employees\SalaryAccountResolver;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;

/**
 * Turns an approved payroll run into an instruction a bank will accept, and
 * records what was instructed.
 *
 * Before this existed a run could reach `disbursed` with no batch, no line
 * items and a locally invented payment reference — the status was a label,
 * not a record that money had moved. A batch is now the artefact that makes
 * disbursement true: it names every beneficiary, the amount, and the file that
 * was handed to the bank, and it is what a later reconciliation matches
 * against when the UTRs come back.
 *
 * Employees without usable bank details are never silently dropped. They are
 * returned as exclusions so payroll can decide, because a missing person is
 * the one failure mode that must not be quiet.
 */
class PayrollDisbursementService
{
    /** Formats the file writer understands. */
    public const FORMAT_NEFT_CSV = 'neft_csv';
    public const FORMAT_GENERIC_CSV = 'generic_csv';

    /**
     * Above this amount NEFT is not appropriate and RTGS applies. Written per
     * line so the bank routes each payment correctly rather than the whole
     * batch being forced to one rail.
     */
    private const RTGS_THRESHOLD = 200000.00;

    public function __construct(
        private readonly SalaryAccountResolver $accounts,
    ) {
    }

    /**
     * Build a transfer batch for a run.
     *
     * @return array{batch: BankTransferBatch, excluded: array<int, array<string, mixed>>}
     */
    public function prepareBatch(
        PayrollMonthlyRun $run,
        int $actorId,
        string $format = self::FORMAT_NEFT_CSV,
        ?string $bankName = null,
    ): array {
        $items = PayrollItem::where('payroll_run_id', $run->id)
            ->with(['user.employeeBankAccounts', 'user.employeeProfile'])
            ->get();

        $payable = [];
        $excluded = [];

        foreach ($items as $item) {
            $reason = $this->cannotPay($item);

            if ($reason !== null) {
                $excluded[] = [
                    'user_id' => $item->user_id,
                    'name' => $item->user?->name,
                    'net_pay' => (float) $item->net_pay,
                    'reason' => $reason,
                ];

                continue;
            }

            $payable[] = $item;
        }

        if ($payable === []) {
            throw new \RuntimeException(
                'No payable lines in this run. '.count($excluded).' employee(s) were excluded — resolve those first.'
            );
        }

        return DB::transaction(function () use ($run, $actorId, $format, $bankName, $payable, $excluded) {
            $reference = $this->batchReference($run);
            $total = array_sum(array_map(fn (PayrollItem $i) => (float) $i->net_pay, $payable));

            $batch = BankTransferBatch::create([
                'organization_id' => $run->organization_id,
                'payroll_run_id' => $run->id,
                'batch_reference' => $reference,
                // bank_name is NOT NULL on the table, and the caller does not
                // always know which bank the file will be uploaded to at the
                // point it is generated.
                'bank_name' => $bankName ?: 'Unspecified',
                'total_amount' => round($total, 2),
                'total_transactions' => count($payable),
                'success_count' => 0,
                'failure_count' => 0,
                'status' => BankTransferBatch::STATUS_PENDING,
                'file_format' => $format,
                'created_by' => $actorId,
            ]);

            foreach ($payable as $item) {
                $account = $this->beneficiaryAccount($item->user);

                BankTransferItem::create([
                    'organization_id' => $run->organization_id,
                    'bank_transfer_batch_id' => $batch->id,
                    'user_id' => $item->user_id,
                    'payroll_item_id' => $item->id,
                    'beneficiary_name' => $this->accounts->beneficiaryName($account, $item->user),
                    'beneficiary_account' => $account->account_number,
                    'beneficiary_ifsc' => $account->ifsc_swift,
                    'amount' => round((float) $item->net_pay, 2),
                    'status' => 'pending',
                ]);
            }

            $path = $this->writeFile($batch->fresh(['items']), $format, $run);
            $batch->update(['file_path' => $path]);

            return ['batch' => $batch->fresh(['items']), 'excluded' => $excluded];
        });
    }

    /**
     * Record what the bank actually did, line by line.
     *
     * @param  array<int, array{reference?: string, status?: string, failure_reason?: string}>  $results
     *         Keyed by bank_transfer_item id.
     */
    public function recordResults(BankTransferBatch $batch, array $results): BankTransferBatch
    {
        return DB::transaction(function () use ($batch, $results) {
            $success = 0;
            $failed = 0;

            foreach ($batch->items as $item) {
                $result = $results[$item->id] ?? null;

                if ($result === null) {
                    continue;
                }

                $status = $result['status'] ?? 'completed';
                $isSuccess = $status === 'completed';

                $item->update([
                    'status' => $status,
                    // The bank's UTR. This is the only reference a statement can
                    // be reconciled against — a locally generated string cannot.
                    'transaction_reference' => $result['reference'] ?? $item->transaction_reference,
                    'failure_reason' => $result['failure_reason'] ?? null,
                    'processed_at' => now(),
                ]);

                if ($isSuccess) {
                    $success++;

                    // Mirror onto the payroll item so a payslip and the bank
                    // record cannot disagree about whether it was paid.
                    $item->payrollItem?->update([
                        'payment_status' => 'paid',
                        'payment_reference' => $result['reference'] ?? null,
                        'paid_at' => now(),
                    ]);
                } else {
                    $failed++;
                }
            }

            $batch->update([
                'success_count' => $success,
                'failure_count' => $failed,
                'status' => $failed === 0
                    ? BankTransferBatch::STATUS_COMPLETED
                    : ($success > 0 ? BankTransferBatch::STATUS_PROCESSING : BankTransferBatch::STATUS_FAILED),
                'processed_at' => now(),
                'completed_at' => $failed === 0 ? now() : null,
            ]);

            return $batch->fresh(['items']);
        });
    }

    /**
     * Why this line cannot be paid, or null when it can.
     *
     * Public so the disburse endpoint applies exactly the same test the bank
     * file does. It previously marked every pending item paid regardless, so
     * people with no bank account — or with a zero or negative net that should
     * have stopped the run — were recorded as having been paid money that no
     * bank instruction ever covered.
     */
    public function cannotPay(PayrollItem $item): ?string
    {
        // Already settled. Re-instructing a paid line is how somebody gets paid
        // twice, so it is excluded before anything else is considered.
        if ($item->payment_status === 'paid') {
            return 'Already paid.';
        }

        if ($item->is_payout_held) {
            return 'Payout is on hold for this employee.';
        }

        $net = (float) $item->net_pay;

        if ($net <= 0) {
            // Both cases are worth naming separately: zero is usually a full
            // month of unpaid leave, negative means deductions overran gross
            // and the run should not have reached this point at all.
            return $net < 0
                ? 'Net pay is negative — deductions exceed gross pay.'
                : 'Net pay is zero.';
        }

        $account = $this->beneficiaryAccount($item->user);

        /*
         * Delegated, so the readiness screen and the bank file cannot disagree.
         *
         * This used to ask only whether the two columns were non-empty, while
         * SalaryAccountResolver — which the readiness report and the onboarding
         * checklist both use — checked the RBI format. So a present-but-
         * malformed IFSC passed here, went into the CSV and was rejected by the
         * bank AFTER the batch had gone out, with the run reading 'disbursed'
         * and the money not moved. The readiness screen is advisory; this is
         * the gate that decides, so this is where the rules have to hold.
         */
        if (($problem = $this->accounts->problemWith($account)) !== null) {
            return $problem;
        }

        // The file has a Beneficiary Name column and a bank matches on it. A
        // blank one is a line nobody can reconcile and some formats reject
        // outright, so it is an exclusion rather than an empty field.
        if ($this->accounts->beneficiaryName($account, $item->user) === null) {
            return 'No beneficiary name on the bank account or the employee record.';
        }

        return null;
    }

    private function beneficiaryAccount(?User $user): mixed
    {
        if (! $user) {
            return null;
        }

        $accounts = $user->employeeBankAccounts;

        // A default account wins; otherwise the first on file.
        return $accounts->firstWhere('is_default', true) ?? $accounts->first();
    }

    private function batchReference(PayrollMonthlyRun $run): string
    {
        return sprintf(
            'BATCH-%s-%s',
            str_replace('-', '', $run->month_year),
            strtoupper(Str::random(6))
        );
    }

    /**
     * Write the instruction file.
     *
     * Column set follows the layout Indian banks commonly accept for bulk
     * salary upload. Amounts are plain decimals with no thousands separators,
     * which is what every parser at the other end expects.
     */
    private function writeFile(BankTransferBatch $batch, string $format, PayrollMonthlyRun $run): string
    {
        $header = [
            'Beneficiary Name',
            'Beneficiary Account Number',
            'IFSC',
            'Amount',
            'Payment Mode',
            'Remarks',
        ];

        $rows = [implode(',', $header)];

        foreach ($batch->items as $item) {
            $amount = (float) $item->amount;

            $rows[] = implode(',', [
                $this->csv($item->beneficiary_name),
                $this->csv($item->beneficiary_account),
                $this->csv($item->beneficiary_ifsc),
                number_format($amount, 2, '.', ''),
                $amount >= self::RTGS_THRESHOLD ? 'RTGS' : 'NEFT',
                $this->csv('Salary '.$run->month_year),
            ]);
        }

        $filename = sprintf('%s_%s.csv', $batch->batch_reference, $format);
        $path = "payroll/bank-files/{$run->organization_id}/{$filename}";

        Storage::disk('local')->put($path, implode("\r\n", $rows)."\r\n");

        return $path;
    }

    /** Quote a CSV field, and strip the commas banks' parsers choke on. */
    private function csv(?string $value): string
    {
        $clean = str_replace(['"', ',', "\r", "\n"], ['', ' ', '', ''], (string) $value);

        return trim($clean);
    }
}
