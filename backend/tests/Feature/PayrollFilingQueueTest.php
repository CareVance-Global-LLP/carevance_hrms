<?php

namespace Tests\Feature;

use App\Jobs\GenerateRunFilings;
use App\Models\PayrollFiling;
use App\Models\PayrollMonthlyRun;
use App\Services\PayrollFilingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Queue;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * Backgrounded statutory filing generation.
 *
 * The bank file is deliberately not covered here because it was deliberately
 * not queued — see GenerateRunFilings' class comment.
 */
class PayrollFilingQueueTest extends TestCase
{
    use RefreshDatabase, BuildsPayrollFixture;

    protected function setUp(): void
    {
        parent::setUp();

        $this->buildPayrollFixture();
    }

    /** A run in a state that filings are actually allowed from. */
    private function fileableRun(string $status = 'approved'): PayrollMonthlyRun
    {
        $this->giveCtc($this->employee);

        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => now()->format('Y-m'),
            'status' => 'draft',
        ]);

        $this->actingAs($this->admin)
            ->postJson("/api/payroll/employees/{$this->employee->id}/process", [
                'month_year' => $run->month_year,
                'annual_ctc' => 1200000,
                'working_days' => 26,
                'days_present' => 26,
            ])->assertOk();

        $run = PayrollMonthlyRun::firstOrFail();
        $run->update(['status' => $status]);

        return $run;
    }

    public function test_generating_all_filings_is_queued_rather_than_run_in_the_request(): void
    {
        Queue::fake();

        $run = $this->fileableRun();

        $this->actingAs($this->admin)
            ->postJson('/api/payroll/filings/generate/all', ['payroll_run_id' => $run->id])
            ->assertStatus(202)
            ->assertJsonPath('filings_state', 'queued');

        Queue::assertPushed(
            GenerateRunFilings::class,
            fn ($job) => $job->runId === $run->id
                && $job->organizationId === $this->organization->id
                && $job->actingUserId === $this->admin->id
        );

        // The request must not have generated anything itself. Filings are keyed
        // by organization and period, not by run — there is no payroll_run_id.
        $this->assertSame(0, PayrollFiling::where('organization_id', $this->organization->id)->count());
    }

    public function test_a_second_generation_is_refused_while_one_is_in_flight(): void
    {
        Queue::fake();

        $run = $this->fileableRun();

        $this->actingAs($this->admin)
            ->postJson('/api/payroll/filings/generate/all', ['payroll_run_id' => $run->id])
            ->assertStatus(202);

        // Two workers would generate the same statutory files for the same run.
        $this->actingAs($this->admin)
            ->postJson('/api/payroll/filings/generate/all', ['payroll_run_id' => $run->id])
            ->assertStatus(409);

        Queue::assertPushed(GenerateRunFilings::class, 1);
    }

    public function test_a_draft_run_is_still_refused_before_anything_is_queued(): void
    {
        Queue::fake();

        $run = $this->fileableRun('draft');

        // Filings must come from figures that are no longer editable.
        $this->actingAs($this->admin)
            ->postJson('/api/payroll/filings/generate/all', ['payroll_run_id' => $run->id])
            ->assertStatus(422);

        Queue::assertNothingPushed();
    }

    public function test_running_the_job_generates_filings_and_records_completion(): void
    {
        $run = $this->fileableRun();

        (new GenerateRunFilings($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(PayrollFilingService::class));

        $run->refresh();

        $this->assertSame('completed', $run->filings_state);
        $this->assertTrue($run->filings_done >= 1, 'At least PF ECR / ESI / 24Q should have been generated');
        $this->assertNotNull($run->filings_finished_at);
        $this->assertTrue(PayrollFiling::where('organization_id', $this->organization->id)->count() >= 1);
    }

    /**
     * The batch must survive one generator throwing.
     *
     * This is the regression guard for the old behaviour, where the first
     * exception destroyed the whole batch after four filings had already been
     * written, leaving a 500 and no report.
     *
     * It used to obtain its exception for free from the ten declaration forms
     * whose blade views do not exist. Those are now recognised as unavailable
     * and skipped before they can throw, so the throw has to be induced
     * deliberately — otherwise this test would keep passing while testing
     * nothing.
     */
    public function test_a_generator_that_throws_does_not_destroy_the_rest_of_the_batch(): void
    {
        $run = $this->fileableRun();

        $service = \Mockery::mock(
            PayrollFilingService::class,
            [app(\App\Services\PayrollCalculatorService::class)]
        )->makePartial();

        $service->shouldReceive('generateEsiChallan')
            ->andThrow(new \RuntimeException('ESI portal unreachable'));

        (new GenerateRunFilings($run->id, $this->organization->id, $this->admin->id))
            ->handle($service);

        $run->refresh();

        $this->assertSame('completed', $run->filings_state, 'Partial failure is still a completed batch');
        $this->assertTrue($run->filings_failed >= 1, 'The throwing generator must be recorded as a failure');
        $this->assertTrue($run->filings_done >= 1, 'The working generators must still have produced filings');

        // The report has to name what broke, or nobody can act on it.
        $this->assertMatchesRegularExpression(
            '/could not be generated: .*esi_challan/',
            (string) $run->filings_message
        );
    }

    /**
     * Nothing is advertised that cannot actually be produced.
     *
     * This test used to assert the opposite - that ten declaration forms were
     * unavailable for want of a blade view, and were therefore skipped rather
     * than failed. Those ten templates now exist, so the premise is gone and
     * the assertion has been inverted rather than deleted: the property worth
     * holding is that the catalogue and the filesystem agree, in whichever
     * direction.
     *
     * Availability is resolved from the filesystem, so a renamed or deleted
     * template silently downgrades a filing to "unavailable" with no other
     * signal. That is the failure this now catches.
     */
    public function test_every_declared_template_exists_on_disk(): void
    {
        $registry = new \App\Services\Payroll\FilingGeneratorRegistry();

        $missing = [];

        foreach ($registry->all() as $type => $meta) {
            if ($meta['view'] !== null && ! $meta['available']) {
                $missing[] = $type.' ('.$meta['view'].')';
            }
        }

        $this->assertSame(
            [],
            $missing,
            'Every generator with a declared view must have that view on disk.'
        );
    }

    /**
     * A real batch produces every due filing and reports nothing unavailable.
     *
     * The counterpart to the test above: the catalogue agreeing with the
     * filesystem is worth little if the batch that walks it still comes back
     * with skips nobody can act on.
     */
    public function test_a_batch_reports_nothing_unavailable_and_nothing_failed(): void
    {
        $run = $this->fileableRun();

        (new GenerateRunFilings($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(PayrollFilingService::class));

        $run->refresh();

        $this->assertSame('completed', $run->filings_state);
        $this->assertSame(0, (int) $run->filings_failed, (string) $run->filings_message);
        $this->assertSame(
            0,
            (int) $run->filings_skipped,
            'Every template now exists, so nothing should be skipped for want of one.'
        );
        $this->assertTrue($run->filings_done >= 1, 'The batch must actually have produced filings');

        $this->assertStringNotContainsString('could not be generated', (string) $run->filings_message);
        $this->assertStringNotContainsString('not available yet', (string) $run->filings_message);
    }

    /**
     * An employee with no work-info row must not sink the filing batch.
     *
     * Four declaration generators read joining_date inside a ternary condition.
     * PHP's ?? suppresses a read on null because it is isset-flavoured, but a
     * ternary CONDITION is not - so `employee_code ?? ''` survived a missing row
     * on the same line that joining_date threw on it.
     *
     * This went unseen because the four had no blade view: the registry marked
     * them unavailable, they were skipped, and the generator never ran. Shipping
     * the templates is what exposed it, which is the honest order of events.
     *
     * A missing work-info row is an ordinary state - somebody created through an
     * import, or an admin form that never reached the work tab - and it must
     * cost a blank cell, not a failed statutory batch.
     */
    public function test_an_employee_with_no_work_info_does_not_break_the_batch(): void
    {
        $run = $this->fileableRun();

        // The genuine absence, not a scoping accident: no work-info row at all.
        \App\Models\EmployeeWorkInfo::withoutOrganizationScope()
            ->where('user_id', $this->employee->id)->forceDelete();

        $result = app(PayrollFilingService::class)
            ->generateAllFilings($run, $this->organization->id, $this->admin->id);

        $this->assertSame(
            [],
            array_map(fn ($f) => $f['type'].': '.$f['message'], $result['failures']),
            'A missing work-info row must cost a blank field, not a failed filing.'
        );
    }

    public function test_progress_is_reported_alongside_employee_processing(): void
    {
        $run = $this->fileableRun();

        (new GenerateRunFilings($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(PayrollFilingService::class));

        // One status endpoint carries both backgrounded tasks for the run.
        $this->actingAs($this->admin)
            ->getJson("/api/payroll/runs/{$run->id}/processing-status")
            ->assertOk()
            ->assertJsonPath('filings.state', 'completed')
            ->assertJsonPath('filings.is_finished', true)
            ->assertJsonStructure([
                'processing' => ['state', 'total', 'done', 'percent', 'is_finished'],
                'filings' => ['state', 'total', 'done', 'percent', 'is_finished'],
            ]);
    }

    /**
     * Same property the run-processing job turns on: with no authenticated user
     * BelongsToOrganization's scope is a no-op, which in a job means querying
     * across every tenant.
     */
    public function test_the_job_authenticates_as_the_acting_user(): void
    {
        $run = $this->fileableRun();

        Auth::forgetUser();
        $this->assertFalse(Auth::hasUser());

        (new GenerateRunFilings($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(PayrollFilingService::class));

        $this->assertTrue(Auth::hasUser());
        $this->assertSame($this->admin->id, Auth::id());
    }

    public function test_a_run_unlocked_back_to_draft_before_the_worker_starts_is_not_filed(): void
    {
        $run = $this->fileableRun();

        // The queue window is real: a run can be unlocked back to draft while
        // the job waits, and filings must not come from editable figures.
        $run->update(['status' => 'draft']);

        (new GenerateRunFilings($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(PayrollFilingService::class));

        $run->refresh();

        $this->assertSame('failed', $run->filings_state);
        $this->assertSame(0, PayrollFiling::where('organization_id', $this->organization->id)->count());
        $this->assertStringContainsString('draft', (string) $run->filings_message);
    }
}
