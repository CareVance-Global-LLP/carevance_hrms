<?php

namespace Tests\Feature;

use App\Jobs\ProcessPayrollRunEmployees;
use App\Models\EmployeePayrollTemplate;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Queue;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * Backgrounded run processing.
 *
 * Shares PayrollIntegrationTest's fixture through BuildsPayrollFixture rather
 * than extending it, which would re-run all fifteen of that class's tests here
 * under a second name.
 */
class PayrollRunProcessingQueueTest extends TestCase
{
    use RefreshDatabase, BuildsPayrollFixture;

    protected function setUp(): void
    {
        parent::setUp();

        $this->buildPayrollFixture();
    }

    private function runWithMissingEmployee(): PayrollMonthlyRun
    {
        $this->giveCtc($this->employee);

        return PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => now()->format('Y-m'),
            'status' => 'draft',
        ]);
    }

    public function test_processing_is_queued_rather_than_run_in_the_request(): void
    {
        Queue::fake();

        $run = $this->runWithMissingEmployee();

        $this->actingAs($this->admin)
            ->postJson("/api/payroll/runs/{$run->id}/process-remaining")
            ->assertStatus(202)
            ->assertJsonPath('processing.state', 'queued');

        Queue::assertPushed(
            ProcessPayrollRunEmployees::class,
            fn ($job) => $job->runId === $run->id
                && $job->organizationId === $this->organization->id
                && $job->actingUserId === $this->admin->id
        );

        // The request must not have done the work itself.
        $this->assertSame(0, PayrollItem::where('payroll_run_id', $run->id)->count());
    }

    public function test_a_second_start_is_refused_while_one_is_in_flight(): void
    {
        Queue::fake();

        $run = $this->runWithMissingEmployee();

        $this->actingAs($this->admin)
            ->postJson("/api/payroll/runs/{$run->id}/process-remaining")
            ->assertStatus(202);

        // Two workers walking the same missing list would both see an employee
        // as unprocessed and race to create their payroll item.
        $this->actingAs($this->admin)
            ->postJson("/api/payroll/runs/{$run->id}/process-remaining")
            ->assertStatus(409);

        Queue::assertPushed(ProcessPayrollRunEmployees::class, 1);
    }

    public function test_progress_is_readable_while_the_work_happens_elsewhere(): void
    {
        Queue::fake();

        $run = $this->runWithMissingEmployee();

        $this->actingAs($this->admin)
            ->postJson("/api/payroll/runs/{$run->id}/process-remaining")
            ->assertStatus(202);

        $this->actingAs($this->admin)
            ->getJson("/api/payroll/runs/{$run->id}/processing-status")
            ->assertOk()
            ->assertJsonPath('processing.state', 'queued')
            ->assertJsonPath('processing.is_finished', false)
            ->assertJsonStructure(['processing' => ['state', 'total', 'done', 'failed', 'skipped', 'percent', 'is_finished']]);
    }

    public function test_running_the_job_processes_the_employee_and_records_completion(): void
    {
        $run = $this->runWithMissingEmployee();

        (new ProcessPayrollRunEmployees($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(\App\Http\Controllers\Api\PayrollDepartmentController::class));

        $run->refresh();

        $this->assertSame('completed', $run->processing_state);
        $this->assertTrue($run->processing_done >= 1, 'The employee with a CTC should have been processed');
        $this->assertNotNull($run->processing_finished_at);
        $this->assertSame(1, PayrollItem::where('payroll_run_id', $run->id)->where('user_id', $this->employee->id)->count());
    }

    public function test_an_employee_without_a_ctc_is_skipped_rather_than_failed(): void
    {
        // No giveCtc() — processing cannot value this person, and skipping is
        // not the same as failing. Reporting it as a failure would send someone
        // hunting a bug when the answer is "configure their salary".
        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => now()->format('Y-m'),
            'status' => 'draft',
        ]);

        (new ProcessPayrollRunEmployees($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(\App\Http\Controllers\Api\PayrollDepartmentController::class));

        $run->refresh();

        $this->assertSame('completed', $run->processing_state);
        $this->assertSame(0, (int) $run->processing_failed);
        $this->assertTrue($run->processing_skipped >= 1);
        $this->assertStringContainsString('no annual_ctc', (string) $run->processing_message);
    }

    /**
     * The property this whole design turns on.
     *
     * BelongsToOrganization's global scope reads the organization from the
     * authenticated user, and with *no* user it is deliberately a no-op so that
     * console commands and jobs are not silently filtered to nothing. In a
     * queued job that default would mean querying across every tenant, so the
     * job authenticates as the user who started it. This asserts that actually
     * happens — without it the job would look fine in a single-tenant test.
     */
    public function test_the_job_authenticates_as_the_acting_user_so_the_tenant_scope_applies(): void
    {
        $run = $this->runWithMissingEmployee();

        $this->assertFalse(Auth::hasUser(), 'No user should be authenticated before the job runs');

        (new ProcessPayrollRunEmployees($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(\App\Http\Controllers\Api\PayrollDepartmentController::class));

        $this->assertTrue(Auth::hasUser());
        $this->assertSame($this->admin->id, Auth::id());
        $this->assertSame($this->organization->id, Auth::user()->organization_id);
    }

    public function test_a_run_locked_before_the_worker_starts_is_not_processed(): void
    {
        $run = $this->runWithMissingEmployee();

        // The window between dispatch and the worker picking the job up is real,
        // and a locked run must not gain new items.
        $run->update(['status' => 'locked']);

        (new ProcessPayrollRunEmployees($run->id, $this->organization->id, $this->admin->id))
            ->handle(app(\App\Http\Controllers\Api\PayrollDepartmentController::class));

        $run->refresh();

        $this->assertSame('failed', $run->processing_state);
        $this->assertSame(0, PayrollItem::where('payroll_run_id', $run->id)->count());
        $this->assertStringContainsString('locked', (string) $run->processing_message);
    }
}
