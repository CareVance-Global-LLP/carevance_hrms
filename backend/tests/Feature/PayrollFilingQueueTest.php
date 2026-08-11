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
     * Ten of the declaration-form generators reference blade views that do not
     * exist, so some of them fail on every run today. The batch must still
     * complete and still produce the statutory filings that matter — this is the
     * regression guard for the old behaviour, where the first missing view threw
     * and destroyed the whole batch after four filings had already been written.
     */
    public function test_a_generator_that_throws_does_not_destroy_the_rest_of_the_batch(): void
    {
        $run = $this->fileableRun();

        (new GenerateRunFilings($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(PayrollFilingService::class));

        $run->refresh();

        $this->assertSame('completed', $run->filings_state, 'Partial failure is still a completed batch');
        $this->assertTrue($run->filings_failed >= 1, 'The missing-view generators should be recorded as failures');
        $this->assertTrue($run->filings_done >= 1, 'The working generators must still have produced filings');

        // The report has to name what broke, or nobody can act on it.
        $this->assertMatchesRegularExpression(
            '/could not be generated: .+/',
            (string) $run->filings_message
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
