<?php

namespace App\Jobs;

use App\Http\Controllers\Api\PayrollDepartmentController;
use App\Models\EmployeePayrollTemplate;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Http\Request;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * Process every unprocessed employee in a payroll run, off the web request.
 *
 * This is the loop that used to live in
 * PayrollDepartmentController::processRemainingEmployees. One full payroll
 * calculation per employee, synchronously, while an HTTP request was held open
 * — fine for a handful of people, a `max_execution_time` failure part-way
 * through for a few hundred, leaving the run half-populated.
 *
 * It calls the controller method rather than a service because the calculation
 * is ~490 lines inside a 4,675-line controller. Extracting the most money-
 * critical function in the application deserves its own change with its own
 * review; smuggling it into the queue work would put a large untested refactor
 * behind an infrastructure change. The synthesised Request is exactly what the
 * old inline loop already did — this moves where the loop runs, not what it does.
 */
class ProcessPayrollRunEmployees implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * One attempt. A retry would re-enter a partially processed run, and while
     * the work is idempotent per employee (already-processed people are not in
     * the missing list), a silent retry after a timeout would race the first
     * attempt. Failure is recorded on the run for a human to look at.
     */
    public int $tries = 1;

    public int $timeout = 3600;

    public function __construct(
        public int $runId,
        public int $organizationId,
        public int $actingUserId,
    ) {
    }

    public function handle(PayrollDepartmentController $controller): void
    {
        /*
         * Authenticate as the person who asked for this.
         *
         * BelongsToOrganization's global scope reads the organization from the
         * authenticated user, and with no user at all it is deliberately a
         * no-op so console commands and jobs are not silently filtered to
         * nothing. That default is right for the trait and catastrophic here:
         * an unauthenticated run of this job would query across every tenant.
         *
         * Setting the actor restores the scope. The organization check below is
         * belt-and-braces in case the user moved between dispatch and handling.
         */
        // Plain find: User is deliberately excluded from BelongsToOrganization
        // (the scope resolves the acting user through Auth, so scoping the user
        // table by the current user would be circular), and therefore has no
        // withoutOrganizationScope(). The organization check below is what keeps
        // this honest.
        $actor = User::find($this->actingUserId);

        if (! $actor || (int) $actor->organization_id !== $this->organizationId) {
            Log::error('ProcessPayrollRunEmployees: acting user is missing or moved organization', [
                'run_id' => $this->runId,
                'acting_user_id' => $this->actingUserId,
                'expected_organization_id' => $this->organizationId,
            ]);

            $this->markFailed('The user who started this run is no longer available. Start it again.');

            return;
        }

        Auth::setUser($actor);

        $run = PayrollMonthlyRun::where('organization_id', $this->organizationId)
            ->find($this->runId);

        if (! $run) {
            Log::error('ProcessPayrollRunEmployees: run not found', ['run_id' => $this->runId]);

            return;
        }

        // Re-check the status here, not only at dispatch: the run may have been
        // locked in the window between the request and the worker picking it up.
        if (! in_array($run->status, ['draft', 'processing'], true)) {
            $run->update([
                'processing_state' => 'failed',
                'processing_message' => "Run moved to '{$run->status}' before processing started.",
                'processing_finished_at' => now(),
            ]);

            return;
        }

        $missingUserIds = $controller->missingEmployeeIdsForRun($this->organizationId, $run);

        $run->update([
            'processing_state' => 'running',
            'processing_total' => count($missingUserIds),
            'processing_done' => 0,
            'processing_failed' => 0,
            'processing_skipped' => 0,
            'processing_started_at' => now(),
            'processing_finished_at' => null,
            'processing_message' => null,
        ]);

        $succeeded = 0;
        $failed = 0;
        $skippedNoCtc = 0;

        foreach ($missingUserIds as $uid) {
            $template = EmployeePayrollTemplate::where('user_id', $uid)
                ->where('organization_id', $this->organizationId)
                ->first();

            if (! $template || ! $template->annual_ctc || $template->annual_ctc <= 0) {
                $skippedNoCtc++;
                $run->increment('processing_skipped');

                continue;
            }

            // working_days is re-derived from attendance inside
            // processEmployeePayroll when not overridden, so 26 is a safe
            // placeholder rather than a figure anyone is paid against.
            $subRequest = Request::create(
                '/payroll/employees/'.$uid.'/process',
                'POST',
                [
                    'month_year' => $run->month_year,
                    'annual_ctc' => (float) $template->annual_ctc,
                    'working_days' => 26,
                ]
            );
            $subRequest->setUserResolver(fn () => $actor);

            try {
                $response = $controller->processEmployeePayroll($subRequest, $uid);

                if (($response->getData(true)['success'] ?? false) === true) {
                    $succeeded++;
                    $run->increment('processing_done');
                } else {
                    $failed++;
                    $run->increment('processing_failed');
                }
            } catch (\Throwable $e) {
                $failed++;
                $run->increment('processing_failed');

                Log::warning('ProcessPayrollRunEmployees: failed for one employee', [
                    'run_id' => $this->runId,
                    'user_id' => $uid,
                    'exception' => $e::class,
                    'message' => $e->getMessage(),
                ]);
            }
        }

        $run->update([
            'processing_state' => 'completed',
            'processing_finished_at' => now(),
            'processing_message' => "{$succeeded} processed, {$failed} failed, {$skippedNoCtc} skipped (no annual_ctc configured).",
        ]);
    }

    /**
     * A job that dies outside handle() still has to leave the run in a state the
     * UI can render, or the progress bar spins forever.
     */
    public function failed(?\Throwable $e): void
    {
        Log::error('ProcessPayrollRunEmployees failed', [
            'run_id' => $this->runId,
            'exception' => $e?->getMessage(),
        ]);

        $this->markFailed('Processing stopped unexpectedly. Check the logs, then start it again.');
    }

    private function markFailed(string $message): void
    {
        PayrollMonthlyRun::withoutOrganizationScope()
            ->where('id', $this->runId)
            ->update([
                'processing_state' => 'failed',
                'processing_message' => $message,
                'processing_finished_at' => now(),
            ]);
    }
}
