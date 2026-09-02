<?php

namespace Tests\Feature;

use App\Models\EmployeeBankAccount;
use App\Models\EmployeeProfile;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\PayrollPdfService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A payslip is a statement an employee can hold the employer to.
 *
 * A QA pass over the August 2026 run found sixteen defects in the rendered
 * document, three of which made it unusable as evidence: the two columns
 * collided so every earnings amount ran into the next deduction label
 * ("20,000.00Provident Fund"), the two totals sat at different heights so
 * A minus B could not be read across the page, and provident fund was deducted
 * against a record carrying no UAN — a contribution that cannot be filed.
 *
 * These assertions are on the view data and the rendered HTML rather than on
 * the PDF bytes, because that is where the defects live; dompdf faithfully
 * renders whatever it is handed. PayslipRendersAndReconcilesTest already covers
 * that the PDF itself comes out.
 */
class PayslipIsADocumentOfRecordTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();
        $this->organization = Organization::factory()->create(['name' => 'CareVance test']);
    }

    /**
     * @param  array<string, mixed>  $itemOverrides
     * @param  array<string, mixed>  $options
     */
    private function payslipFor(array $itemOverrides = [], array $options = []): PayrollItem
    {
        $employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
            'name' => 'Viswakarma Akash Vijaykumar',
        ]);

        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $employee->id,
            // Unique per organisation, so a test may build more than one person.
            'employee_code' => 'EMP-'.str_pad((string) $employee->id, 4, '0', STR_PAD_LEFT),
            'designation' => 'Operation Manager',
            'joining_date' => '2026-08-01',
        ]);

        EmployeeProfile::create([
            'organization_id' => $this->organization->id,
            'user_id' => $employee->id,
            'uan_number' => $options['uan'] ?? null,
        ]);

        if ($options['bank'] ?? true) {
            EmployeeBankAccount::create([
                'organization_id' => $this->organization->id,
                'user_id' => $employee->id,
                'account_holder_name' => $employee->name,
                'bank_name' => 'HDFC Bank',
                'account_number' => '50100234560361',
                'ifsc_swift' => 'HDFC0001234',
                'is_default' => true,
            ]);
        }

        // The run starts open whatever it is meant to end up as: PayrollItemObserver
        // refuses to write an item into a closed run, which is the guard that makes
        // a released month immutable. The real chain approves and releases a run
        // that already has its items, so the fixture advances it the same way round.
        // One run per organisation per month, so a test building several people
        // shares it rather than colliding on the unique index.
        $run = PayrollMonthlyRun::firstOrCreate(
            ['organization_id' => $this->organization->id, 'month_year' => '2026-08'],
            ['status' => 'draft', 'pay_date' => $options['pay_date'] ?? null],
        );

        if (($options['pay_date'] ?? null) !== null) {
            $run->update(['pay_date' => $options['pay_date']]);
        }

        \DB::table('payroll_monthly_runs')->where('id', $run->id)->update(['status' => 'draft']);

        $item = PayrollItem::create(array_merge([
            'organization_id' => $this->organization->id,
            'payroll_run_id' => $run->id,
            'user_id' => $employee->id,
            'month_year' => '2026-08',
            'basic' => 20000,
            'hra' => 10000,
            'conveyance' => 1600,
            'special_allowance' => 15638,
            'gross_salary' => 47238,
            'gross_full_month' => 47238,
            'pf_employee' => 1800,
            'pt' => 200,
            'tds' => 0,
            'total_deductions' => 2000,
            'net_pay' => 45238,
            'salary_day_basis' => 'calendar',
            'salary_divisor_days' => 31,
            'total_working_days' => 21,
            'lOP_days' => 0,
            'lOP_deduction' => 0,
        ], $itemOverrides));

        if (($status = $options['status'] ?? 'draft') !== 'draft') {
            \DB::table('payroll_monthly_runs')->where('id', $run->id)->update(['status' => $status]);
        }

        return $item;
    }

    private function html(PayrollItem $item): string
    {
        return app(PayrollPdfService::class)->payslipHtml($item);
    }

    /** @return array<string, mixed> */
    private function data(PayrollItem $item): array
    {
        return app(PayrollPdfService::class)->payslipViewData($item);
    }

    // ── R2: the two totals have to sit on one baseline ────────────────────

    public function test_both_columns_carry_the_same_number_of_rows_so_the_totals_align(): void
    {
        // Four earnings against two deductions: the shape that put "Total
        // Earnings (A)" two rows below "Total Deductions (B)".
        $data = $this->data($this->payslipFor());

        $this->assertGreaterThan(count($data['deductionsComponents']), count($data['earningsComponents']));
        $this->assertSame(
            count($data['earningsRows']),
            count($data['deductionsRows']),
            'the shorter column is padded so both totals land on the same line'
        );
    }

    public function test_padding_a_column_adds_no_money_to_it(): void
    {
        $data = $this->data($this->payslipFor());

        $padded = array_filter($data['deductionsRows'], fn ($r) => $r === null);
        $this->assertNotEmpty($padded, 'the deductions column is the short one here');

        $real = array_values(array_filter($data['deductionsRows'], fn ($r) => $r !== null));
        $this->assertEqualsWithDelta(
            2000.0,
            array_sum(array_column($real, 'amount')),
            0.01,
            'a spacer row is empty, never a zero-valued line'
        );
    }

    // ── R1: a gutter wide enough that the columns cannot touch ────────────

    public function test_the_two_columns_are_separated_by_a_real_gutter(): void
    {
        $html = $this->html($this->payslipFor());

        $this->assertStringContainsString(
            'col-gutter',
            $html,
            'earnings and deductions need a spacer cell between them, not 1pt of padding'
        );
    }

    // ── R3: amounts align without a typewriter face ───────────────────────

    public function test_amounts_do_not_fall_back_to_a_monospace_face(): void
    {
        $html = $this->html($this->payslipFor());

        $this->assertStringNotContainsString(
            'DejaVu Sans Mono',
            $html,
            'DejaVu Sans already has fixed-width digits; the mono face only made the slip look like a dot-matrix print'
        );
    }

    // ── S2: a zero tax line is a claim; silence is ambiguous ──────────────

    public function test_income_tax_is_printed_even_when_it_is_zero(): void
    {
        $data = $this->data($this->payslipFor(['tds' => 0]));

        $labels = array_column($data['deductionsComponents'], 'label');
        $this->assertContains(
            'Income Tax (TDS)',
            $labels,
            'a visible zero says tax was computed and came to nothing; an absent row cannot distinguish that from never having run'
        );
    }

    public function test_a_zero_tax_line_is_not_counted_into_the_total(): void
    {
        $data = $this->data($this->payslipFor(['tds' => 0]));

        $this->assertEqualsWithDelta(
            2000.0,
            array_sum(array_column($data['deductionsComponents'], 'amount')),
            0.01
        );
    }

    // ── Every slip has the same shape, and says what it does not know ─────

    public function test_every_payslip_carries_the_same_rows_in_the_same_order(): void
    {
        // One with a bank account, one without: two payslips from the same run
        // must still look like the same document.
        $with = array_column($this->data($this->payslipFor())['identityFields'], 'label');
        $without = array_column($this->data($this->payslipFor(options: ['bank' => false]))['identityFields'], 'label');

        $this->assertSame($with, $without);
    }

    public function test_a_missing_value_is_stated_rather_than_punctuated(): void
    {
        $fields = collect($this->data($this->payslipFor(options: ['bank' => false]))['identityFields'])
            ->pluck('value', 'label');

        $this->assertSame('Not recorded', $fields['Bank Account']);

        foreach ($fields as $value) {
            $this->assertNotSame('—', $value, 'an em-dash is indistinguishable from a rendering fault');
            $this->assertNotEmpty($value);
        }
    }

    /**
     * Pinned because it read `date_of_joining`, which is not a column. The real
     * one is `joining_date`, so this row silently resolved to null on every
     * payslip ever produced.
     */
    public function test_the_joining_date_actually_renders(): void
    {
        $fields = collect($this->data($this->payslipFor())['identityFields'])->pluck('value', 'label');

        $this->assertSame('01 Aug 2026', $fields['Date Joined']);
    }

    // ── D3: the account is identified without being disclosed ─────────────

    public function test_the_bank_account_is_masked_to_its_last_four_digits(): void
    {
        $data = $this->data($this->payslipFor());

        $bank = collect($data['identityFields'])->firstWhere('label', 'Bank Account');
        $this->assertNotNull($bank);
        $this->assertStringContainsString('0361', $bank['value'], 'enough to recognise the account');
        $this->assertStringNotContainsString('50100234560361', $bank['value'], 'not enough to use it');
    }

    // ── D2/D6: the period, the pay date and a reference to quote ──────────

    public function test_the_pay_period_and_a_slip_reference_are_printed(): void
    {
        $item = $this->payslipFor(options: ['pay_date' => '2026-08-31']);
        $data = $this->data($item);

        $this->assertSame('01 Aug 2026 to 31 Aug 2026', $data['payPeriod']);
        $this->assertSame('31 Aug 2026', $data['payDate']);
        $this->assertStringContainsString('2026-08', $data['slipReference']);
        $this->assertStringContainsString((string) $item->user_id, $data['slipReference']);
    }

    public function test_an_unscheduled_run_states_no_pay_date_rather_than_inventing_one(): void
    {
        $data = $this->data($this->payslipFor());

        $this->assertNull($data['payDate'], 'a draft run has not been paid; guessing a date would be a false statement');
    }

    // ── L1: one divisor, named ────────────────────────────────────────────

    public function test_the_pro_rata_basis_names_its_divisor(): void
    {
        $data = $this->data($this->payslipFor());

        $this->assertStringContainsString('calendar days', strtolower($data['payBasisNote']));
        $this->assertStringContainsString('31', $data['payBasisNote']);
    }

    public function test_a_fixed_basis_says_so_instead_of_saying_calendar(): void
    {
        $data = $this->data($this->payslipFor([
            'salary_day_basis' => 'fixed_26',
            'salary_divisor_days' => 26,
        ]));

        $note = strtolower($data['payBasisNote']);
        $this->assertStringContainsString('26', $note);
        $this->assertStringNotContainsString('calendar days', $note);
    }

    // ── The wage period follows the organisation's basis ──────────────────

    public function test_days_in_the_wage_period_is_the_divisor_the_organisation_configured(): void
    {
        foreach ([['calendar', 31.0], ['fixed_30', 30.0], ['fixed_26', 26.0]] as [$basis, $days]) {
            $data = $this->data($this->payslipFor([
                'salary_day_basis' => $basis,
                'salary_divisor_days' => $days,
            ]));

            $this->assertSame($days, $data['totalDays'], "the {$basis} basis must drive the printed wage period");
            $this->assertSame($days, $data['paidDays'] + $data['lopDays'], 'paid + LOP must still reconcile to it');
        }
    }

    /**
     * The label used to print on every payslip ever generated, unconditionally,
     * including a disbursed month. A document that always calls itself
     * provisional never means it.
     */
    public function test_a_released_payslip_with_nothing_missing_is_not_labelled_provisional(): void
    {
        $html = $this->html($this->payslipFor(options: [
            'uan' => '100234567890',
            'status' => 'disbursed',
        ]));

        $this->assertStringNotContainsString('Provisional', $html);
    }

    public function test_a_draft_run_is_always_provisional_because_the_figures_can_still_change(): void
    {
        $data = $this->data($this->payslipFor(options: ['uan' => '100234567890', 'status' => 'draft']));

        $this->assertTrue($data['isProvisional']);
    }

    // ── Both columns must add up to their own total ───────────────────────

    /**
     * A payslip that contradicts itself is not evidence of anything.
     *
     * Irbaz mavli's August slip listed four deductions summing to ₹2,103.19
     * under a "Total Deductions (B)" of ₹598.74, and four earnings summing to
     * ₹11,659.50 under a "Total Earnings (A)" of ₹10,155.05. One mistake caused
     * both: loss of pay was printed as a DEDUCTION line while being correctly
     * excluded from the deduction total, and the earnings components are the
     * full month while (A) is what was actually earned.
     *
     * The fix is to make each total the sum of the column printed above it:
     * (A) is the full month, (B) carries loss of pay alongside the statutory
     * lines. A − B is unchanged at the net that is actually paid.
     */
    private function withLop(): PayrollItem
    {
        return $this->payslipFor([
            'basic' => 5000, 'hra' => 2500, 'conveyance' => 1600, 'special_allowance' => 2559.50,
            'gross_full_month' => 11659.50,
            'gross_salary' => 10155.05,
            'lOP_days' => 4,
            'lOP_deduction' => 1504.45,
            'pf_employee' => 522.58,
            'esi_employee' => 76.16,
            'pt' => 0,
            'tds' => 0,
            'total_deductions' => 598.74,
            'net_pay' => 9556.31,
        ]);
    }

    public function test_the_earnings_column_sums_to_the_total_printed_under_it(): void
    {
        $data = $this->data($this->withLop());

        $this->assertEqualsWithDelta(
            11659.50,
            array_sum(array_column($data['earningsComponents'], 'amount')),
            0.01
        );
        $this->assertEqualsWithDelta(
            $data['grossSalary'],
            array_sum(array_column($data['earningsComponents'], 'amount')),
            0.01,
            '(A) is the sum of the lines above it, or the slip contradicts itself'
        );
    }

    public function test_the_deductions_column_sums_to_the_total_printed_under_it(): void
    {
        $data = $this->data($this->withLop());

        $this->assertEqualsWithDelta(
            2103.19,
            array_sum(array_column($data['deductionsComponents'], 'amount')),
            0.01
        );
        $this->assertEqualsWithDelta(
            $data['totalDeductions'],
            array_sum(array_column($data['deductionsComponents'], 'amount')),
            0.01
        );
    }

    public function test_loss_of_pay_is_a_deduction_line(): void
    {
        $this->assertContains(
            'Loss of Pay',
            array_column($this->data($this->withLop())['deductionsComponents'], 'label')
        );
    }

    /**
     * Whatever else changes, the net has to be the net.
     *
     * (A) is now the full month and (B) carries loss of pay, which is a
     * different split from the stored `gross_salary` / `total_deductions` pair.
     * The one thing that must not move is what the employee is actually paid.
     */
    public function test_the_printed_totals_still_produce_the_net_that_is_paid(): void
    {
        $item = $this->withLop();
        $data = $this->data($item);

        $this->assertEqualsWithDelta(
            (float) $item->net_pay,
            $data['grossSalary'] - $data['totalDeductions'],
            0.02,
            'A minus B must be the figure that reaches the bank'
        );
    }

    /**
     * The stored columns mean something else and must not be rewritten.
     *
     * `total_deductions` is money WITHHELD — what the ECR, the payroll register
     * and the accounting journal all read. Loss of pay is not withheld, so it
     * stays out of the column even though the payslip now prints it inside (B).
     */
    public function test_the_presentation_total_does_not_change_the_stored_one(): void
    {
        $item = $this->withLop();
        $data = $this->data($item);

        $this->assertEqualsWithDelta(598.74, (float) $item->total_deductions, 0.01);
        $this->assertGreaterThan((float) $item->total_deductions, $data['totalDeductions']);
    }

    public function test_a_month_with_no_loss_of_pay_carries_no_such_line(): void
    {
        $labels = array_column($this->data($this->payslipFor())['deductionsComponents'], 'label');

        $this->assertNotContains('Loss of Pay', $labels);
    }

    // ── Loan recovery is itemised, not lumped ─────────────────────────────

    /**
     * "Custom Deductions ₹6,000" is not an answer to "what was this for?".
     *
     * The run already writes the breakdown to `deduction_lines` — one entry per
     * loan commitment and per wizard deduction — with a comment saying it exists
     * so a payslip can answer that question months later. The payslip printed
     * the lumped column instead, so somebody repaying two loans saw one number
     * that could not be decomposed even by inference.
     */
    private function withLoanLines(array $lines): PayrollItem
    {
        $total = array_sum(array_column($lines, 'amount'));

        return $this->payslipFor([
            'custom_deductions' => $total,
            'deduction_lines' => $lines,
            'total_deductions' => 2000 + $total,
            'net_pay' => 47238 - (2000 + $total),
        ]);
    }

    public function test_a_loan_instalment_is_named_rather_than_lumped(): void
    {
        $labels = array_column($this->data($this->withLoanLines([
            ['type' => 'loan_emi', 'label' => 'Loan EMI', 'amount' => 6000.0, 'loan_id' => 7, 'remaining' => 34000.0],
        ]))['deductionsComponents'], 'label');

        $this->assertNotContains('Custom Deductions', $labels);
        $this->assertNotEmpty(array_filter($labels, fn ($l) => str_contains($l, 'Loan EMI')));
    }

    public function test_two_commitments_produce_two_lines(): void
    {
        $data = $this->data($this->withLoanLines([
            ['type' => 'loan_emi', 'label' => 'Loan EMI', 'amount' => 6000.0, 'loan_id' => 7, 'remaining' => 34000.0],
            ['type' => 'loan_emi', 'label' => 'Advance EMI', 'amount' => 2500.0, 'loan_id' => 9, 'remaining' => 7500.0],
        ]));

        $labels = array_column($data['deductionsComponents'], 'label');
        $this->assertNotEmpty(array_filter($labels, fn ($l) => str_contains($l, 'Loan EMI')));
        $this->assertNotEmpty(array_filter($labels, fn ($l) => str_contains($l, 'Advance EMI')));
    }

    /**
     * The instalment is named; the remaining balance is not printed.
     *
     * An outstanding figure on a payslip is a second statement of account on a
     * document whose job is the month — and it dates the moment it is printed,
     * so a payslip reprinted later contradicts the copy the employee holds. The
     * loan screen is where a balance belongs.
     */
    public function test_the_outstanding_balance_is_not_printed_on_the_instalment(): void
    {
        $labels = array_column($this->data($this->withLoanLines([
            ['type' => 'loan_emi', 'label' => 'Loan EMI', 'amount' => 6000.0, 'loan_id' => 7, 'remaining' => 34000.0],
        ]))['deductionsComponents'], 'label');

        $loan = collect($labels)->first(fn ($l) => str_contains($l, 'Loan EMI'));
        $this->assertSame('Loan EMI', $loan);
        $this->assertStringNotContainsStringIgnoringCase('outstanding', implode(' ', $labels));
        $this->assertStringNotContainsString('34,000', implode(' ', $labels));
    }

    public function test_a_wizard_deduction_keeps_the_name_it_was_given(): void
    {
        $labels = array_column($this->data($this->withLoanLines([
            ['type' => 'custom_deduction', 'label' => 'Canteen', 'amount' => 450.0],
        ]))['deductionsComponents'], 'label');

        $this->assertContains('Canteen', $labels);
    }

    public function test_the_itemised_lines_still_add_up_to_the_printed_total(): void
    {
        $item = $this->withLoanLines([
            ['type' => 'loan_emi', 'label' => 'Loan EMI', 'amount' => 6000.0, 'loan_id' => 7, 'remaining' => 34000.0],
            ['type' => 'custom_deduction', 'label' => 'Canteen', 'amount' => 450.0],
        ]);
        $data = $this->data($item);

        $this->assertEqualsWithDelta(
            (float) $item->total_deductions,
            array_sum(array_column($data['deductionsComponents'], 'amount')),
            0.01,
            'the column has to reconcile to Total Deductions (B) or the slip contradicts itself'
        );
    }

    /**
     * Itemising a set that does not reconcile would break the column.
     *
     * If the lines disagree with the stored total — a legacy row, a partial
     * write — printing them makes the deductions column stop adding up to
     * Total Deductions (B), which is worse than an unhelpful label.
     */
    public function test_lines_that_do_not_reconcile_fall_back_to_the_lump(): void
    {
        $data = $this->data($this->payslipFor([
            'custom_deductions' => 6000,
            // Only half the story: one line for a two-loan recovery.
            'deduction_lines' => [
                ['type' => 'loan_emi', 'label' => 'Loan EMI', 'amount' => 3500.0, 'loan_id' => 7, 'remaining' => 0.0],
            ],
            'total_deductions' => 8000,
            'net_pay' => 39238,
        ]));

        $labels = array_column($data['deductionsComponents'], 'label');
        $this->assertContains('Custom Deductions', $labels);
        $this->assertEqualsWithDelta(
            8000.0,
            array_sum(array_column($data['deductionsComponents'], 'amount')),
            0.01
        );
    }

    public function test_an_item_written_before_the_breakdown_existed_still_renders(): void
    {
        $data = $this->data($this->payslipFor([
            'custom_deductions' => 6000,
            'deduction_lines' => null,
            'total_deductions' => 8000,
            'net_pay' => 39238,
        ]));

        $this->assertContains('Custom Deductions', array_column($data['deductionsComponents'], 'label'));
    }
}
