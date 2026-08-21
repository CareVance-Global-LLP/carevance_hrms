<?php

namespace Tests\Feature;

use App\Models\GlMappingConfig;
use App\Models\Organization;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Payroll\AccountingExportService;
use App\Services\Payroll\PayrollJournalService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * Exporting payroll to an accounting package.
 *
 * Two things must hold or the export is worse than not having one.
 *
 * The journal must BALANCE exactly — an unbalanced one is rejected by any
 * accounting system worth the name, and the ones that do not reject it import
 * half, which costs far more than a refusal.
 *
 * And nothing may be silently dropped. "Your salary journal is 40,000 light and
 * nobody knows why" is a month-end nobody should have to have, and it is
 * exactly what omitting one unmapped line produces.
 */
class AccountingExportTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private PayrollMonthlyRun $run;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-gl']);

        User::create([
            'name' => 'Admin',
            'email' => 'admin@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $this->organization->id,
        ]);

        /*
         * A run that balances by construction:
         *   gross 500000 + employer PF 24000 + employer ESI 3250   (debits)
         *   = PF payable 48000 + ESI payable 7000 + TDS 25000
         *     + PT 2500 + net 444750                                (credits)
         */
        $this->run = PayrollMonthlyRun::query()->create([
            'organization_id' => $this->organization->id,
            'month_year' => '2026-08',
            'status' => 'approved',
            'pay_date' => '2026-08-31',
            'total_employees' => 10,
            'total_gross' => 500000,
            'total_pf_employee' => 24000,
            'total_pf_employer' => 24000,
            'total_esi_employee' => 3750,
            'total_esi_employer' => 3250,
            'total_tds' => 25000,
            'total_pt' => 2500,
            'total_net_pay' => 444750,
        ]);
    }

    private function map(string $entity, string $code, string $name): GlMappingConfig
    {
        return GlMappingConfig::query()->create([
            'organization_id' => $this->organization->id,
            'entity_type' => $entity,
            'gl_code' => $code,
            'gl_name' => $name,
            'is_active' => true,
        ]);
    }

    private function mapEverything(): void
    {
        foreach ([
            ['gross', '5001', 'Salaries and Wages'],
            ['pf_employer', '5002', 'Employer PF Contribution'],
            ['esi_employer', '5003', 'Employer ESI Contribution'],
            ['pf_payable', '2001', 'PF Payable'],
            ['esi_payable', '2002', 'ESI Payable'],
            ['tds', '2003', 'TDS Payable'],
            ['pt', '2004', 'Professional Tax Payable'],
            ['net_pay', '2005', 'Salaries Payable'],
        ] as [$entity, $code, $name]) {
            $this->map($entity, $code, $name);
        }
    }

    private function journals(): PayrollJournalService
    {
        return app(PayrollJournalService::class);
    }

    private function exports(): AccountingExportService
    {
        return app(AccountingExportService::class);
    }

    public function test_the_journal_balances_to_the_paisa(): void
    {
        $this->mapEverything();

        $journal = $this->journals()->build($this->run);

        $this->assertTrue($journal['totals']['balanced']);
        $this->assertSame('527250.00', $journal['totals']['debit']);
        $this->assertSame('527250.00', $journal['totals']['credit']);
    }

    public function test_pf_payable_carries_both_halves(): void
    {
        $this->mapEverything();

        $journal = $this->journals()->build($this->run);
        $pf = collect($journal['lines'])->firstWhere('entity', 'pf_payable');

        /*
         * The employee's share was deducted from pay and the employer's was an
         * expense above; the organization owes the total onward as ONE
         * liability, and splitting it would not reconcile against the single
         * challan that actually gets paid.
         */
        $this->assertSame('48000.00', $pf['amount']);
        $this->assertSame('credit', $pf['side']);
    }

    public function test_an_unmapped_component_refuses_the_export(): void
    {
        $this->mapEverything();
        GlMappingConfig::query()->where('entity_type', 'tds')->delete();

        try {
            $this->exports()->toTallyXml($this->run);
            $this->fail('an unmapped component was exported anyway');
        } catch (RuntimeException $exception) {
            // Named, so somebody can go and fix it rather than hunting.
            $this->assertStringContainsString('tds', $exception->getMessage());
        }
    }

    public function test_an_unmapped_component_is_never_quietly_omitted(): void
    {
        $this->mapEverything();
        GlMappingConfig::query()->where('entity_type', 'tds')->delete();

        $journal = $this->journals()->build($this->run);

        // Reported, and the imbalance it causes is visible rather than papered
        // over with a suspense account.
        $this->assertSame(['tds'], $journal['unmapped']);
        $this->assertFalse($journal['totals']['balanced']);
    }

    public function test_a_zero_component_is_not_posted(): void
    {
        $this->mapEverything();
        $this->run->forceFill([
            'total_esi_employee' => 0,
            'total_esi_employer' => 0,
            // Only the EMPLOYEE half changes take-home: 444750 + 3750. The
            // employer half was never deducted from anybody's pay.
            'total_net_pay' => 448500,
        ])->save();

        $journal = $this->journals()->build($this->run->fresh());
        $entities = collect($journal['lines'])->pluck('entity');

        // An organization with no ESI liability this month should not have an
        // ESI row, and a reviewer scanning for anomalies should not skip past
        // one.
        $this->assertFalse($entities->contains('esi_employer'));
        $this->assertFalse($entities->contains('esi_payable'));
        $this->assertTrue($journal['totals']['balanced']);
    }

    public function test_tally_debits_are_negative_and_deemed_positive(): void
    {
        $this->mapEverything();

        $xml = $this->exports()->toTallyXml($this->run);

        /*
         * Tally's convention is backwards from every other system and it is the
         * single thing that goes wrong with these imports. Get it the intuitive
         * way round and the voucher still imports - it just posts every salary
         * as income, which nobody notices until the P&L is read.
         */
        $this->assertMatchesRegularExpression(
            '/<LEDGERNAME>Salaries and Wages<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-500000\.00<\/AMOUNT>/',
            $xml,
        );

        $this->assertMatchesRegularExpression(
            '/<LEDGERNAME>Salaries Payable<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>444750\.00<\/AMOUNT>/',
            $xml,
        );
    }

    public function test_tally_dates_have_no_separators(): void
    {
        $this->mapEverything();

        // One of the two reasons a Tally import silently produces nothing.
        $this->assertStringContainsString('<DATE>20260831</DATE>', $this->exports()->toTallyXml($this->run));
    }

    public function test_the_tally_xml_is_well_formed(): void
    {
        $this->mapEverything();
        // A ledger name that would break an unescaped document.
        $this->map('gross', '5001', 'R&D Salaries')->save();
        GlMappingConfig::query()->where('entity_type', 'gross')->where('gl_name', 'Salaries and Wages')->delete();

        $xml = $this->exports()->toTallyXml($this->run->fresh());

        $previous = libxml_use_internal_errors(true);
        $document = simplexml_load_string($xml);
        libxml_use_internal_errors($previous);

        $this->assertNotFalse($document, 'the Tally XML did not parse');
    }

    public function test_the_zoho_csv_leaves_the_unused_side_empty(): void
    {
        $this->mapEverything();

        $csv = $this->exports()->toZohoCsv($this->run);
        $lines = explode("\r\n", $csv);

        $this->assertStringContainsString('Journal Date', $lines[0]);

        // A row with 0.00 in both columns is one an importer may reject and a
        // human will certainly misread.
        $salaryRow = collect($lines)->first(fn ($line) => str_contains($line, 'Salaries and Wages'));
        $this->assertStringContainsString('"500000.00",""', $salaryRow);
    }

    public function test_every_zoho_row_repeats_the_reference(): void
    {
        $this->mapEverything();

        $lines = collect(explode("\r\n", $this->exports()->toZohoCsv($this->run)))->slice(1)->filter();

        /*
         * Zoho groups rows into one entry by date and reference. A blank on any
         * row splits the journal into two that each fail to balance.
         */
        foreach ($lines as $line) {
            $this->assertStringContainsString('PAYROLL-2026-08', $line);
        }
    }

    public function test_a_run_with_nothing_to_post_is_refused(): void
    {
        $empty = PayrollMonthlyRun::query()->create([
            'organization_id' => $this->organization->id,
            'month_year' => '2026-09',
            'status' => 'approved',
        ]);

        $this->mapEverything();

        $this->expectException(RuntimeException::class);
        $this->exports()->toTallyXml($empty);
    }
}
