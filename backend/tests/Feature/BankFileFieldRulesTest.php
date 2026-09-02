<?php

namespace Tests\Feature;

use App\Models\EmployeeBankAccount;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Employees\SalaryAccountResolver;
use App\Services\Payroll\PayrollDisbursementService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * Four fields decide whether a salary line reaches somebody's account.
 *
 * The readiness screen already checked the IFSC against the RBI format, but the
 * readiness screen is advisory — it warns on day minus seven and blocks nothing.
 * The gate that actually decides who lands in the bank file is
 * PayrollDisbursementService::cannotPay(), and it asked only whether the two
 * columns were non-empty. So a present-but-malformed IFSC, or an account number
 * that was plainly a placeholder, passed disbursement, went into the CSV, and
 * was rejected by the bank AFTER the batch had gone out — at which point the
 * run says 'disbursed' and the money has not moved.
 *
 * The rules are the bank's, not ours: an account number of 9 to 18 digits, an
 * IFSC of exactly eleven characters in the form AAAA0BBBBBB, a beneficiary name
 * the file can carry, and an amount above zero.
 *
 * A failure here is an EXCLUSION, never a dropped line. Somebody who cannot be
 * paid has to be named, with the reason, or the run quietly pays fewer people
 * than it reports.
 */
class BankFileFieldRulesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;
    private User $actor;
    private PayrollMonthlyRun $run;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');

        $this->org = Organization::factory()->create();
        $this->actor = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'admin']);
        $this->run = PayrollMonthlyRun::create([
            'organization_id' => $this->org->id,
            'month_year' => '2026-07',
            'status' => 'approved',
            'created_by' => $this->actor->id,
        ]);
    }

    private function employee(array $bank = [], float $net = 45238, ?string $holder = null): PayrollItem
    {
        $user = User::factory()->create(['organization_id' => $this->org->id, 'role' => 'employee']);

        EmployeeBankAccount::withoutOrganizationScope()->create(array_merge([
            'organization_id' => $this->org->id,
            'user_id' => $user->id,
            'account_holder_name' => $holder ?? $user->name,
            'bank_name' => 'HDFC Bank',
            'account_number' => '50100123456789',
            'ifsc_swift' => 'HDFC0001234',
            'is_default' => true,
        ], $bank));

        // The run is 'approved' because that is the state disbursement operates
        // on, but PayrollItemObserver refuses writes into a closed run, so the
        // item goes in while it is still open — the order production uses.
        $status = $this->run->status;
        \DB::table('payroll_monthly_runs')->where('id', $this->run->id)->update(['status' => 'draft']);

        $item = PayrollItem::create([
            'organization_id' => $this->org->id,
            'payroll_run_id' => $this->run->id,
            'user_id' => $user->id,
            'net_pay' => $net,
            'gross_salary' => $net,
            'payment_status' => 'pending',
        ]);

        \DB::table('payroll_monthly_runs')->where('id', $this->run->id)->update(['status' => $status]);

        return $item;
    }

    private function service(): PayrollDisbursementService
    {
        return app(PayrollDisbursementService::class);
    }

    private function reasonFor(PayrollItem $item): ?string
    {
        return $this->service()->cannotPay($item->fresh(['user.employeeBankAccounts']));
    }

    // ── Account number ────────────────────────────────────────────────────

    public function test_a_well_formed_account_is_payable(): void
    {
        $this->assertNull($this->reasonFor($this->employee()));
    }

    public function test_an_account_number_shorter_than_nine_digits_is_refused(): void
    {
        $reason = $this->reasonFor($this->employee(['account_number' => '12345678']));

        $this->assertNotNull($reason);
        $this->assertStringContainsString('account number', strtolower($reason));
    }

    public function test_an_account_number_longer_than_eighteen_digits_is_refused(): void
    {
        $this->assertNotNull($this->reasonFor($this->employee(['account_number' => '1234567890123456789'])));
    }

    public function test_separators_are_stripped_before_the_length_is_judged(): void
    {
        // People type their account number off a passbook, spaces and all.
        // 5010-0123 456789 is fourteen digits and perfectly payable.
        $this->assertNull($this->reasonFor($this->employee(['account_number' => '5010-0123 456789'])));
    }

    public function test_a_single_repeated_digit_is_refused_as_a_placeholder(): void
    {
        $reason = $this->reasonFor($this->employee(['account_number' => '999999999999']));

        $this->assertNotNull($reason, '999999999999 is what somebody types to get past a required field');
        $this->assertStringContainsString('account number', strtolower($reason));
    }

    public function test_an_account_number_with_letters_in_it_is_refused(): void
    {
        $this->assertNotNull($this->reasonFor($this->employee(['account_number' => '5010ABCD6789'])));
    }

    // ── IFSC ──────────────────────────────────────────────────────────────

    public function test_an_ifsc_of_the_wrong_length_is_refused(): void
    {
        $reason = $this->reasonFor($this->employee(['ifsc_swift' => 'TEST0001']));

        $this->assertNotNull($reason, 'eight characters is not an IFSC, and the bank is what finds out');
        $this->assertStringContainsString('ifsc', strtolower($reason));
    }

    public function test_the_fifth_character_must_be_a_zero(): void
    {
        // RBI reserves position five; a bank that does not have a 0 there is a
        // bank whose code somebody has mistyped.
        $this->assertNotNull($this->reasonFor($this->employee(['ifsc_swift' => 'HDFC1001234'])));
    }

    public function test_the_first_four_characters_must_be_letters(): void
    {
        $this->assertNotNull($this->reasonFor($this->employee(['ifsc_swift' => 'HD1C0001234'])));
    }

    public function test_a_lowercase_ifsc_is_accepted_because_case_is_not_the_error(): void
    {
        $this->assertNull($this->reasonFor($this->employee(['ifsc_swift' => 'hdfc0001234'])));
    }

    // ── Beneficiary name ──────────────────────────────────────────────────

    public function test_a_beneficiary_with_no_name_anywhere_is_refused(): void
    {
        $item = $this->employee(holder: '');
        $item->user->update(['name' => '']);

        $reason = $this->reasonFor($item);

        $this->assertNotNull($reason);
        $this->assertStringContainsString('name', strtolower($reason));
    }

    public function test_the_account_holder_name_is_used_when_it_differs_from_the_login_name(): void
    {
        $item = $this->employee(holder: 'A K VIJAYKUMAR');
        $this->assertNull($this->reasonFor($item));

        $batch = $this->service()->prepareBatch($this->run, $this->actor->id)['batch'];

        $this->assertSame('A K VIJAYKUMAR', $batch->items->first()->beneficiary_name);
    }

    // ── Amount ────────────────────────────────────────────────────────────

    public function test_zero_and_negative_net_pay_are_refused_separately(): void
    {
        $this->assertStringContainsString('zero', strtolower((string) $this->reasonFor($this->employee(net: 0))));
        $this->assertStringContainsString('negative', strtolower((string) $this->reasonFor($this->employee(net: -8547))));
    }

    // ── The whole batch ───────────────────────────────────────────────────

    public function test_an_unpayable_line_is_excluded_by_name_and_never_silently_dropped(): void
    {
        $good = $this->employee();
        $bad = $this->employee(['ifsc_swift' => 'TEST0001']);

        $result = $this->service()->prepareBatch($this->run, $this->actor->id);

        $this->assertCount(1, $result['batch']->items, 'only the payable line is instructed');
        $this->assertSame($good->user_id, $result['batch']->items->first()->user_id);

        $excluded = collect($result['excluded']);
        $this->assertCount(1, $excluded);
        $this->assertSame($bad->user_id, $excluded->first()['user_id'] ?? null);
        $this->assertStringContainsString('IFSC', (string) ($excluded->first()['reason'] ?? ''));
    }

    public function test_the_written_file_carries_no_row_for_an_excluded_person(): void
    {
        $this->employee();
        $bad = $this->employee(['account_number' => '111111111111']);

        $batch = $this->service()->prepareBatch($this->run, $this->actor->id)['batch'];
        $csv = Storage::disk('local')->get($batch->file_path);

        $this->assertStringNotContainsString('111111111111', $csv);
        $this->assertStringNotContainsString((string) $bad->user->name, $csv);
        $this->assertStringContainsString('50100123456789', $csv);
    }

    // ── The two callers must not diverge ──────────────────────────────────

    /**
     * The readiness screen and the bank file have to answer this identically.
     *
     * They did not: SalaryAccountResolver checked the IFSC and cannotPay() did
     * not, so an employee could pass "Bank account for salary" on the readiness
     * report and still be rejected by the bank — or, worse, the reverse, with
     * the checklist ticking "Add bank account details" against an account the
     * run could not pay into.
     */
    public function test_the_readiness_check_and_the_disbursement_gate_agree(): void
    {
        $resolver = app(SalaryAccountResolver::class);

        foreach ([
            ['account_number' => '50100123456789', 'ifsc_swift' => 'HDFC0001234'],
            ['account_number' => '12345678',       'ifsc_swift' => 'HDFC0001234'],
            ['account_number' => '999999999999',   'ifsc_swift' => 'HDFC0001234'],
            ['account_number' => '50100123456789', 'ifsc_swift' => 'TEST0001'],
        ] as $bank) {
            $item = $this->employee($bank);
            $account = $item->user->employeeBankAccounts->first();

            $this->assertSame(
                $resolver->isPayable($account),
                $this->reasonFor($item) === null,
                sprintf('disagreement on %s / %s', $bank['account_number'], $bank['ifsc_swift'])
            );
        }
    }
}
