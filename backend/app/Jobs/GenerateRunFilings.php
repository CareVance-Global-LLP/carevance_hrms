<?php

namespace App\Jobs;

use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\PayrollFilingService;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * Generate every statutory filing for a run, off the web request.
 *
 * generateAllFilings runs ten to fifteen generators — PF ECR, ESI challan, Form
 * 24Q, Form 12BA, a PT return per state, an LWF return per enabled state, and
 * the bonus forms. Each re-queries every payroll item with three eager-loaded
 * relations and writes a real EPFO/NSDL-format file, so the cost grows with
 * employees *and* with the number of states the organization operates in.
 *
 * The bank file was deliberately left synchronous: it is a single eager-loaded
 * query plus string formatting, and it returns content the user is waiting to
 * download. Queueing it would turn a one-click download into prepare-poll-
 * download for no measurable gain.
 */
class GenerateRunFilings implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    /**
     * One attempt, for the same reason as ProcessPayrollRunEmployees: a retry
     * would re-enter a run that already has some filings and race the first
     * attempt. Failure is recorded on the run for a human.
     */
    public int $tries = 1;

    public int $timeout = 3600;

    public function __construct(
        public int $runId,
        public int $organizationId,
        public int $actingUserId,
        public ?int $payGroupId = null,
    ) {
    }

    public function handle(PayrollFilingService $filingService): void
    {
        // See ProcessPayrollRunEmployees for why this is not optional:
        // BelongsToOrganization's scope is a no-op with no authenticated user,
        // so a job that does not set one queries across every tenant.
        $actor = User::find($this->actingUserId);

        if (! $actor || (int) $actor->organization_id !== $this->organizationId) {
            Log::error('GenerateRunFilings: acting user is missing or moved organization', [
                'run_id' => $this->runId,
                'acting_user_id' => $this->actingUserId,
            ]);

            $this->markFailed('The user who started this is no longer available. Start it again.');

            return;
        }

        Auth::setUser($actor);

        $run = PayrollMonthlyRun::where('organization_id', $this->organizationId)->find($this->runId);

        if (! $run) {
            Log::error('GenerateRunFilings: run not found', ['run_id' => $this->runId]);

            return;
        }

        // Re-checked here as well as at dispatch: the run could have been
        // unlocked back to draft while the job sat in the queue, and filings
        // must not be generated from figures that are editable again.
        if (! in_array($run->status, ['locked', 'approved', 'released', 'disbursed'], true)) {
            $run->update([
                'filings_state' => 'failed',
                'filings_message' => "Run moved to '{$run->status}' before filings were generated. Lock and approve it, then try again.",
                'filings_finished_at' => now(),
            ]);

            return;
        }

        $run->update([
            'filings_state' => 'running',
            'filings_started_at' => now(),
            'filings_finished_at' => null,
            'filings_message' => null,
            'filings_done' => 0,
            'filings_failed' => 0,
            'filings_skipped' => 0,
        ]);

        try {
            $report = $filingService->generateAllFilings(
                $run,
                $this->organizationId,
                $this->actingUserId,
                $this->payGroupId
            );

            $generated = count($report['filings']);
            $failures = $report['failures'];
            $unavailable = $report['unavailable'] ?? [];

            /*
             * Three outcomes, not two, and the distinction is the point.
             *
             * A *failure* is something that broke and should be investigated.
             * An *unavailable* filing is one whose statutory template has never
             * been written — ten of the declaration forms are in that state.
             * Reporting those as failures sent people to support for a feature
             * that simply does not exist yet, and buried any real breakage in
             * the same list.
             */
            $message = "{$generated} filing(s) generated.";

            if ($failures !== []) {
                $types = implode(', ', array_column($failures, 'type'));
                $message .= ' '.count($failures)." could not be generated: {$types}.";
            }

            if ($unavailable !== []) {
                $types = implode(', ', array_column($unavailable, 'type'));
                $message .= ' '.count($unavailable)." not available yet: {$types}.";
            }

            $run->update([
                'filings_state' => 'completed',
                'filings_total' => $generated + count($failures) + count($unavailable),
                'filings_done' => $generated,
                'filings_failed' => count($failures),
                'filings_skipped' => count($unavailable),
                'filings_finished_at' => now(),
                'filings_message' => $message,
            ]);
        } catch (\Throwable $e) {
            // Individual generators are handled inside the service, so anything
            // reaching here took the whole batch down.
            Log::error('GenerateRunFilings: generation failed', [
                'run_id' => $this->runId,
                'exception' => $e::class,
                'message' => $e->getMessage(),
            ]);

            $run->update([
                'filings_state' => 'failed',
                'filings_failed' => 1,
                'filings_finished_at' => now(),
                'filings_message' => 'Filing generation stopped: '.$e->getMessage(),
            ]);
        }
    }

    public function failed(?\Throwable $e): void
    {
        Log::error('GenerateRunFilings failed', [
            'run_id' => $this->runId,
            'exception' => $e?->getMessage(),
        ]);

        $this->markFailed('Filing generation stopped unexpectedly. Check the logs, then start it again.');
    }

    private function markFailed(string $message): void
    {
        PayrollMonthlyRun::withoutOrganizationScope()
            ->where('id', $this->runId)
            ->update([
                'filings_state' => 'failed',
                'filings_message' => $message,
                'filings_finished_at' => now(),
            ]);
    }
}
