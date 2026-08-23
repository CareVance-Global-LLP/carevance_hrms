<?php

namespace Tests\Feature;

use App\Models\PayrollFiling;
use App\Services\Payroll\FilingDueDates;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * The half of a statutory filing that happens after the file is produced.
 *
 * Generating a return is the easy half. The half that matters during an
 * inspection is the evidence: which return, filed when, against which
 * acknowledgement number, with the portal's receipt attached. Those columns
 * existed on payroll_filings and were written by nothing — the reachable
 * lifecycle stopped at "filed", and `acknowledged_at` was dead.
 */
class FilingLifecycleTest extends TestCase
{
    use RefreshDatabase, BuildsPayrollFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildPayrollFixture();
        Storage::fake('local');
    }

    private function filing(array $overrides = []): PayrollFiling
    {
        return PayrollFiling::create(array_merge([
            'organization_id' => $this->organization->id,
            'type' => 'pf_ecr',
            'period_type' => 'monthly',
            'period_month' => '08',
            'period_year' => 2026,
            'status' => 'generated',
            'compliance_status' => 'ready',
            'file_path' => 'filings/x/pf.txt',
            'original_filename' => 'pf_ecr.txt',
            'generated_at' => now(),
        ], $overrides));
    }

    public function test_marking_filed_attaches_the_acknowledgement_in_one_request(): void
    {
        $filing = $this->filing();

        $this->actingAs($this->admin)
            ->post("/api/payroll/filings/{$filing->id}/mark-filed", [
                'acknowledgment_number' => 'EPFO/2026/00123',
                'filed_on' => '2026-09-12',
                'receipt' => UploadedFile::fake()->create('challan.pdf', 40, 'application/pdf'),
            ])
            ->assertOk();

        $filing->refresh();

        $this->assertSame('filed', $filing->status);
        $this->assertSame('EPFO/2026/00123', $filing->acknowledgment_number);
        $this->assertSame('2026-09-12', $filing->filed_at->toDateString(), 'filed_on must back-date the filing, not stamp today');
        $this->assertTrue($filing->hasReceipt(), 'The receipt must arrive in the same request as the filing');
        $this->assertSame('challan.pdf', $filing->receipt_original_filename);

        /*
         * The generated return must survive. file_path holds the document the
         * acknowledgement is evidence FOR — overwriting it with the receipt
         * would destroy the thing being evidenced.
         */
        $this->assertSame('filings/x/pf.txt', $filing->file_path);
        $this->assertNotSame($filing->file_path, $filing->receipt_path);
    }

    public function test_an_acknowledgement_cannot_be_attached_before_anything_is_filed(): void
    {
        $filing = $this->filing();

        $this->actingAs($this->admin)
            ->post("/api/payroll/filings/{$filing->id}/receipt", [
                'receipt' => UploadedFile::fake()->create('challan.pdf', 20, 'application/pdf'),
            ])
            ->assertStatus(422);

        $this->assertFalse($filing->refresh()->hasReceipt());
    }

    public function test_acknowledging_moves_the_last_state_and_only_from_filed(): void
    {
        $generated = $this->filing();

        // Not filed yet: there is nothing for an authority to have accepted.
        $this->actingAs($this->admin)
            ->postJson("/api/payroll/filings/{$generated->id}/acknowledge", [])
            ->assertStatus(422);

        $filed = $this->filing([
            'type' => 'esi_challan',
            'status' => 'filed',
            'filed_at' => now()->subDay(),
            'acknowledgment_number' => 'PROVISIONAL',
        ]);

        $this->actingAs($this->admin)
            ->postJson("/api/payroll/filings/{$filed->id}/acknowledge", [
                'acknowledgment_number' => 'ESIC/FINAL/9911',
                'acknowledged_on' => '2026-09-14',
            ])
            ->assertOk();

        $filed->refresh();

        $this->assertSame('acknowledged', $filed->status);
        $this->assertSame('2026-09-14', $filed->acknowledged_at->toDateString());
        // The number is often only final at acknowledgement.
        $this->assertSame('ESIC/FINAL/9911', $filed->acknowledgment_number);
    }

    public function test_a_return_prepared_elsewhere_can_be_recorded_but_is_never_called_filing_ready(): void
    {
        $this->actingAs($this->admin)
            ->post('/api/payroll/filings/upload', [
                'type' => 'form_24q',
                'period_month' => '08',
                'period_year' => 2026,
                'document' => UploadedFile::fake()->create('24q-from-consultant.pdf', 30, 'application/pdf'),
            ])
            ->assertStatus(201);

        $filing = PayrollFiling::where('type', 'form_24q')->firstOrFail();

        $this->assertSame('uploaded', $filing->source);
        /*
         * We did not produce this file and cannot vouch for its format.
         * Claiming 'ready' would be exactly the overclaim compliance_status
         * exists to prevent.
         */
        $this->assertSame('reference_only', $filing->compliance_status);
    }

    public function test_the_calendar_dates_from_the_statute_and_never_invents_one(): void
    {
        $response = $this->actingAs($this->admin)
            ->getJson('/api/payroll/filings/calendar?month_year=2026-08')
            ->assertOk();

        $rows = collect($response->json('data'))->keyBy('type');

        // EPF Scheme para 38 / ESI reg. 31: the 15th of the FOLLOWING month.
        // The calendar this replaces used the period month and was therefore a
        // month early on every row.
        $this->assertSame('2026-09-15', $rows['pf_ecr']['due_date']);
        $this->assertSame('2026-09-15', $rows['esi_challan']['due_date']);

        // Rule 31A: Jul-Sep is Q2, due 31 October.
        $this->assertSame('2026-10-31', $rows['form_24q']['due_date']);

        foreach ($rows as $type => $row) {
            $this->assertArrayHasKey('urgency', $row);
            $this->assertSame('not_generated', $row['status'], "{$type} must read off real filing rows, not a placeholder");
        }
    }

    public function test_the_calendar_reflects_a_real_filing_rather_than_assuming_progress(): void
    {
        $this->filing([
            'status' => 'filed',
            'filed_at' => Carbon::parse('2026-09-10'),
            'acknowledgment_number' => 'EPFO/2026/00123',
        ]);

        $rows = collect(
            $this->actingAs($this->admin)
                ->getJson('/api/payroll/filings/calendar?month_year=2026-08')
                ->json('data')
        )->keyBy('type');

        $this->assertSame('filed', $rows['pf_ecr']['status']);
        $this->assertSame('EPFO/2026/00123', $rows['pf_ecr']['acknowledgment_number']);
        // Filed before the 15th, so on time — and a filed return can never
        // become overdue later, however long the deadline has since passed.
        $this->assertSame('filed_on_time', $rows['pf_ecr']['urgency']);
    }

    public function test_a_state_that_levies_no_professional_tax_gets_no_deadline(): void
    {
        $dueDates = new FilingDueDates();

        $this->assertNull(
            $dueDates->dueDateFor('pt_return', '2026-08', 'sikkim'),
            'An unknown state must yield no date. Inventing one puts an overdue badge on a return that does not exist.'
        );

        $this->assertSame(
            '2026-09-30',
            $dueDates->dueDateFor('pt_return', '2026-08', 'maharashtra')?->toDateString(),
            'Maharashtra is month-end, and day(31) on a 30-day month must clamp rather than roll into October.'
        );
    }

    public function test_a_filed_return_is_never_reported_overdue(): void
    {
        $filing = $this->filing([
            'due_date' => '2026-09-15',
            'status' => 'filed',
            'filed_at' => Carbon::parse('2026-09-20'),
        ]);

        // Late, but filed. A screen that keeps reddening a filed return is a
        // screen people stop reading.
        $this->assertFalse($filing->isOverdue(Carbon::parse('2027-01-01')));

        $unfiled = $this->filing(['type' => 'esi_challan', 'due_date' => '2026-09-15']);
        $this->assertTrue($unfiled->isOverdue(Carbon::parse('2026-09-16')));

        // No known deadline is unscheduled, not overdue.
        $undated = $this->filing(['type' => 'lwf_return']);
        $this->assertFalse($undated->isOverdue(Carbon::parse('2030-01-01')));
    }
}
