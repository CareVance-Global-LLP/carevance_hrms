<?php

namespace App\Observers;

use App\Exceptions\ClosedPayrollRunException;
use App\Models\PayrollItem;
use App\Models\PayrollItemVersion;
use App\Models\PayrollMonthlyRun;
use App\Services\Payroll\ClosedRunWriteContext;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Log;

/**
 * Makes a closed payroll run immutable where it actually matters: the money.
 *
 * Before this existed, immutability was ~25 hand-written status checks spread
 * across six controllers, two jobs and a service. They disagreed with each
 * other -- two tested a status ('paid') the system has never written, so CTC
 * edits and arrear approvals both succeeded against a disbursed run -- and a
 * seventh write path had no check at all. Every new endpoint was one more
 * chance to forget.
 *
 * The guard is deliberately scoped to PayrollItem::MONEY_COLUMNS rather than to
 * every attribute. Disbursement writes payment_status, payment_reference and
 * paid_at onto approved and released runs by design; recording that money left
 * the bank is not the same as changing what was owed. Scoping positively also
 * means a column added later is unguarded until someone lists it as money,
 * which fails at review rather than in production.
 *
 * The escape hatch is ClosedRunWriteContext::permit(), which requires a stated
 * reason -- see that class for why.
 */
class PayrollItemObserver
{
    public function __construct(private readonly ClosedRunWriteContext $context)
    {
    }

    /**
     * Fires for both create and update, so adding an employee to a closed run
     * is refused on the same terms as rewriting one already in it.
     */
    public function saving(PayrollItem $item): void
    {
        $dirtyMoneyColumns = array_values(
            array_intersect(PayrollItem::MONEY_COLUMNS, array_keys($item->getDirty()))
        );

        if ($dirtyMoneyColumns === []) {
            return;
        }

        // Tier 3: this employee can be settled while the run around them is
        // still open. Read from the ORIGINAL rather than the pending state, so
        // unlocking still works -- an item that is being unlocked has
        // locked_at set on the row it was loaded from.
        if (! $this->context->isPermitted() && $item->getOriginal('locked_at') !== null) {
            throw new ClosedPayrollRunException(
                monthYear: (string) ($item->getOriginal('month_year') ?? $item->month_year),
                runStatus: 'locked for this employee',
                operation: 'write '.implode(', ', $dirtyMoneyColumns).' to',
            );
        }

        $this->refuseIfRunIsClosed(
            $item,
            'write '.implode(', ', $dirtyMoneyColumns).' to'
        );

        // Past the guard, so either the run is open or a governed correction is
        // in progress. Only the latter is worth versioning: an open run is
        // edited constantly while it is being built, and versioning drafts
        // would bury the corrections that actually matter under the noise of
        // ordinary processing.
        if ($this->context->isPermitted() && $item->exists) {
            $this->captureSupersededVersion($item);
        }
    }

    /**
     * A delete removes the money entirely, so it is guarded regardless of which
     * columns are dirty.
     *
     * Note this only fires for model deletes. A query-builder mass delete --
     * $run->items()->delete() -- bypasses model events altogether, which is why
     * PayrollAutoProcessService iterates instead.
     */
    public function deleting(PayrollItem $item): void
    {
        $this->refuseIfRunIsClosed($item, 'delete a payroll item from');
    }

    /**
     * Retain the figures this correction is about to replace.
     *
     * Captured from getOriginal(), so it is the state as loaded from the
     * database rather than the state being written — the version records what
     * was paid, not what is replacing it.
     *
     * Failure here must not take the correction down with it. A payroll
     * correction that is refused because its audit row could not be written
     * leaves the wrong figure in place, which is worse than the missing row:
     * the money is what the employee receives, the version is how we explain
     * it. Recorded and continued rather than thrown.
     */
    private function captureSupersededVersion(PayrollItem $item): void
    {
        try {
            $original = $item->getOriginal();

            $snapshot = [];
            foreach (PayrollItem::MONEY_COLUMNS as $column) {
                if (array_key_exists($column, $original)) {
                    $snapshot[$column] = (float) $original[$column];
                }
            }

            $versionNo = (int) ($original['current_version_no'] ?? 1);

            PayrollItemVersion::create([
                'payroll_item_id' => $item->getKey(),
                'organization_id' => $original['organization_id'] ?? $item->organization_id,
                'user_id' => $original['user_id'] ?? $item->user_id,
                'month_year' => $original['month_year'] ?? $item->month_year,
                'version_no' => $versionNo,
                'money_snapshot' => $snapshot,
                'reason' => $this->context->reason(),
                'superseded_by' => Auth::id(),
                'superseded_at' => now(),
            ]);

            // The row now carries the next version. Set on the model rather
            // than saved separately so it lands in the same write as the
            // correction — a second save would re-enter this observer.
            $item->current_version_no = $versionNo + 1;
        } catch (\Throwable $e) {
            Log::error('Failed to capture a superseded payroll version', [
                'payroll_item_id' => $item->getKey(),
                'reason' => $this->context->reason(),
                'exception' => $e->getMessage(),
            ]);
        }
    }

    private function refuseIfRunIsClosed(PayrollItem $item, string $operation): void
    {
        if ($this->context->isPermitted()) {
            return;
        }

        $runId = (int) $item->payroll_run_id;
        if ($runId === 0) {
            return;
        }

        // Deliberately unscoped. If the organization scope hid the run we would
        // read null and allow the write, which is the wrong way to fail for a
        // guard. Console commands and queued jobs must see it too.
        $run = PayrollMonthlyRun::withoutOrganizationScope()
            ->whereKey($runId)
            ->first(['month_year', 'status']);

        if (! $run || ! in_array($run->status, PayrollMonthlyRun::CLOSED_STATUSES, true)) {
            return;
        }

        throw new ClosedPayrollRunException(
            monthYear: (string) $run->month_year,
            runStatus: (string) $run->status,
            operation: $operation,
        );
    }
}
