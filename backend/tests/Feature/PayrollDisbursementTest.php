<?php

namespace Tests\Feature;

use App\Models\BankTransferBatch;
use App\Models\EmployeeBankAccount;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Payroll\PayrollDisbursementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Disbursement is the point where payroll stops being a calculation and starts
 * being money, so what it records has to be true.
 *
 * A run could previously reach 'disbursed' with no batch, no line items and a
 * locally invented payment reference — nothing a bank statement could ever be
 * reconciled against. These tests hold the two properties that matter: an
 * instruction is durably recorded, and nobody is paid twice or silently
 * skipped.
 */
class PayrollDisbursementTest extends TestCase
{
    use RefreshDatabase;

    private function scenario(): array
    {
        $org = Organization::factory()->create();

        $actor = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'admin',
        ]);

        $run = PayrollMonthlyRun::create([
            'organization_id' => $org->id,
            'month_year' => '2026-07',
            'status' => 'approved',
            'created_by' => $actor->id,
        ]);

        return [$org, $actor, $run];
    }

    private function payableEmployee(Organization $org, PayrollMonthlyRun $run, float $net): PayrollItem
    {
        $user = User::factory()->create([
            'organization_id' => $org->id,
            'role' => 'employee',
        ]);

        EmployeeBankAccount::withoutOrganizationScope()->create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'account_holder_name' => $user->name,
            'bank_name' => 'Test Bank',
            'account_number' => '1234567890'.$user->id,
            'ifsc_swift' => 'TEST0001',
            'is_default' => true,
        ]);

        return $this->whileRunIsOpen($run, fn () => PayrollItem::create([
            'organization_id' => $org->id,
            'payroll_run_id' => $run->id,
            'user_id' => $user->id,
            'net_pay' => $net,
            'gross_salary' => $net,
            'payment_status' => 'pending',
        ]));
    }

    /**
     * Build a run's contents while the run is still open.
     *
     * scenario() starts the run at 'approved' because that is the state
     * disbursement operates on. Production never writes money into a run in
     * that state -- processing fills a draft run, and the run advances only
     * once its items exist -- and PayrollItemObserver now refuses it, which is
     * exactly what it is for. So the fixture models the real order: open the
     * run, write the item, close it again.
     *
     * @template T
     * @param  callable():T  $build
     * @return T
     */
    private function whileRunIsOpen(PayrollMonthlyRun $run, callable $build): mixed
    {
        $closedStatus = $run->status;
        $run->update(['status' => 'draft']);

        try {
            return $build();
        } finally {
            $run->update(['status' => $closedStatus]);
        }
    }

    public function test_it_records_a_batch_and_writes_a_bank_file(): void
    {
        Storage::fake('local');
        [$org, $actor, $run] = $this->scenario();

        $this->payableEmployee($org, $run, 45000.00);
        $this->payableEmployee($org, $run, 32000.50);

        $this->actingAs($actor);

        $result = app(PayrollDisbursementService::class)
            ->prepareBatch($run, $actor->id, bankName: 'Test Bank');

        $batch = $result['batch'];

        $this->assertSame(2, $batch->total_transactions);
        $this->assertEqualsWithDelta(77000.50, (float) $batch->total_amount, 0.01);
        $this->assertSame(BankTransferBatch::STATUS_PENDING, $batch->status);
        $this->assertCount(2, $batch->items);
        $this->assertSame([], $result['excluded']);

        Storage::disk('local')->assertExists($batch->file_path);

        $csv = Storage::disk('local')->get($batch->file_path);
        $this->assertStringContainsString('Beneficiary Name', $csv);
        $this->assertStringContainsString('45000.00', $csv);
        // Both are under the RTGS threshold.
        $this->assertStringContainsString('NEFT', $csv);
        $this->assertStringNotContainsString('RTGS', $csv);
    }

    public function test_large_payments_are_routed_as_rtgs(): void
    {
        Storage::fake('local');
        [$org, $actor, $run] = $this->scenario();

        $this->payableEmployee($org, $run, 250000.00);
        $this->actingAs($actor);

        $batch = app(PayrollDisbursementService::class)
            ->prepareBatch($run, $actor->id)['batch'];

        $this->assertStringContainsString(
            'RTGS',
            Storage::disk('local')->get($batch->file_path),
            'A payment above the NEFT ceiling should be routed as RTGS.'
        );
    }

    public function test_it_excludes_rather_than_silently_drops_unpayable_people(): void
    {
        Storage::fake('local');
        [$org, $actor, $run] = $this->scenario();

        $this->payableEmployee($org, $run, 40000.00);

        // No bank account at all.
        $noAccount = User::factory()->create(['organization_id' => $org->id, 'role' => 'employee']);
        $this->whileRunIsOpen($run, fn () => PayrollItem::create([
            'organization_id' => $org->id,
            'payroll_run_id' => $run->id,
            'user_id' => $noAccount->id,
            'net_pay' => 20000.00,
            'payment_status' => 'pending',
        ]));

        // Deductions overran gross.
        $negative = $this->payableEmployee($org, $run, -500.00);

        $this->actingAs($actor);

        $result = app(PayrollDisbursementService::class)->prepareBatch($run, $actor->id);

        $this->assertSame(1, $result['batch']->total_transactions);
        $this->assertCount(2, $result['excluded']);

        $reasons = collect($result['excluded'])->pluck('reason', 'user_id');
        $this->assertStringContainsString('No bank account', $reasons[$noAccount->id]);
        $this->assertStringContainsString('negative', $reasons[$negative->user_id]);
    }

    public function test_an_already_paid_line_is_never_instructed_again(): void
    {
        Storage::fake('local');
        [$org, $actor, $run] = $this->scenario();

        $paid = $this->payableEmployee($org, $run, 30000.00);
        $paid->update(['payment_status' => 'paid']);

        $this->payableEmployee($org, $run, 25000.00);

        $this->actingAs($actor);

        $result = app(PayrollDisbursementService::class)->prepareBatch($run, $actor->id);

        $this->assertSame(1, $result['batch']->total_transactions);
        $this->assertSame(
            'Already paid.',
            collect($result['excluded'])->firstWhere('user_id', $paid->user_id)['reason']
        );
    }

    public function test_recording_bank_results_stores_the_utr_on_both_records(): void
    {
        Storage::fake('local');
        [$org, $actor, $run] = $this->scenario();

        $item = $this->payableEmployee($org, $run, 50000.00);
        $this->actingAs($actor);

        $service = app(PayrollDisbursementService::class);
        $batch = $service->prepareBatch($run, $actor->id)['batch'];
        $transfer = $batch->items->first();

        $batch = $service->recordResults($batch, [
            $transfer->id => ['status' => 'completed', 'reference' => 'UTR0000123456'],
        ]);

        $this->assertSame(BankTransferBatch::STATUS_COMPLETED, $batch->status);
        $this->assertSame(1, $batch->success_count);
        $this->assertSame(0, $batch->failure_count);

        $this->assertSame('UTR0000123456', $batch->items->first()->transaction_reference);

        // The payslip side must agree with the bank side.
        $item->refresh();
        $this->assertSame('paid', $item->payment_status);
        $this->assertSame('UTR0000123456', $item->payment_reference);
    }

    public function test_a_failed_transfer_leaves_the_line_unpaid(): void
    {
        Storage::fake('local');
        [$org, $actor, $run] = $this->scenario();

        $item = $this->payableEmployee($org, $run, 18000.00);
        $this->actingAs($actor);

        $service = app(PayrollDisbursementService::class);
        $batch = $service->prepareBatch($run, $actor->id)['batch'];

        $batch = $service->recordResults($batch, [
            $batch->items->first()->id => [
                'status' => 'failed',
                'failure_reason' => 'Beneficiary account closed',
            ],
        ]);

        $this->assertSame(BankTransferBatch::STATUS_FAILED, $batch->status);
        $this->assertSame(1, $batch->failure_count);

        $item->refresh();
        $this->assertSame(
            'pending',
            $item->payment_status,
            'A failed transfer must not mark the payroll line as paid.'
        );
    }
}
