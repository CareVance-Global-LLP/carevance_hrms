<?php

namespace Tests\Feature;

use App\Models\EmployeeBankAccount;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Disbursing a run must not record people as paid who were never in the bank
 * file.
 *
 * disburseRun marked every pending item 'paid' with no bank-detail check and
 * no net-pay check, and stamped a locally invented 'PAY-xxxxxxxx' reference
 * when no batch existed — a string that looks like a reference while matching
 * nothing on any statement.
 */
class PayrollDisburseExclusionTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private PayrollMonthlyRun $run;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => '2026-06',
            'status' => 'released',
            'created_by' => $this->admin->id,
        ]);
    }

    private function itemFor(string $email, float $netPay, bool $withBank): PayrollItem
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'email' => $email,
        ]);

        if ($withBank) {
            EmployeeBankAccount::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'account_holder_name' => $user->name,
                'account_number' => '1234567890',
                'ifsc_swift' => 'HDFC0001234',
                'bank_name' => 'HDFC',
                'is_default' => true,
            ]);
        }

        return $this->whileRunIsOpen(fn () => PayrollItem::create([
            'payroll_run_id' => $this->run->id,
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'month_year' => '2026-06',
            'gross_salary' => 50000,
            'total_deductions' => 50000 - $netPay,
            'net_pay' => $netPay,
            'payment_status' => 'pending',
        ]));
    }

    /**
     * Build a run's contents while the run is still open.
     *
     * This suite starts its run at 'released' because that is the state
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
    private function whileRunIsOpen(callable $build): mixed
    {
        $closedStatus = $this->run->status;
        $this->run->update(['status' => 'draft']);

        try {
            return $build();
        } finally {
            $this->run->update(['status' => $closedStatus]);
        }
    }

    private function disburse()
    {
        return $this->postJson(
            '/api/payroll/runs/'.$this->run->id.'/disburse',
            [],
            $this->apiHeadersFor($this->admin)
        );
    }

    public function test_employee_without_bank_details_is_not_marked_paid(): void
    {
        $item = $this->itemFor('nobank@example.com', 40000, false);

        $this->disburse()->assertOk();

        $this->assertSame(
            'pending',
            $item->fresh()->payment_status,
            'Nobody in the bank file means nobody was paid.'
        );
    }

    public function test_employee_with_negative_net_is_not_marked_paid(): void
    {
        $item = $this->itemFor('negative@example.com', -5000, true);

        $this->disburse()->assertOk();

        $this->assertSame('pending', $item->fresh()->payment_status);
    }

    public function test_payable_employee_is_marked_paid(): void
    {
        $item = $this->itemFor('ok@example.com', 40000, true);

        $this->disburse()->assertOk();

        $this->assertSame('paid', $item->fresh()->payment_status);
    }

    public function test_exclusions_are_returned_with_a_reason(): void
    {
        $this->itemFor('nobank2@example.com', 40000, false);
        $this->itemFor('ok2@example.com', 40000, true);

        $response = $this->disburse()->assertOk();

        $this->assertSame(1, $response->json('paid_count'));
        $excluded = $response->json('excluded');
        $this->assertCount(1, $excluded, 'The unpayable employee must be named, not silently dropped.');
        $this->assertStringContainsString('bank account', strtolower((string) $excluded[0]['reason']));
    }

    public function test_no_invented_payment_reference_when_there_is_no_batch(): void
    {
        $item = $this->itemFor('ref@example.com', 40000, true);

        $this->disburse()->assertOk();

        $this->assertNull(
            $item->fresh()->payment_reference,
            'An invented PAY-xxxxxxxx reconciles against nothing; an empty field is honest.'
        );
    }
}
