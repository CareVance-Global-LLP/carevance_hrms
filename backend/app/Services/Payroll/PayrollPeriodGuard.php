<?php

namespace App\Services\Payroll;

use App\Models\PayrollMonthlyRun;
use Carbon\Carbon;

/**
 * Protects a closed payroll period from upstream edits.
 *
 * Attendance regularisation, leave approval and attendance re-sync all write
 * to data a payroll run has already consumed, and none of them checked whether
 * that month's run was still open. Approving a back-dated correction for a
 * locked, approved, released or disbursed month silently changed the inputs
 * behind money that had already been signed off — and, once disbursed, behind
 * money that had already left the bank. Nothing recomputed, so the run's own
 * figures and the attendance backing them quietly disagreed.
 *
 * The rule this enforces: a period that has been locked is closed to upstream
 * edits. A correction discovered afterwards belongs in the next run as an
 * arrear, not as a rewrite of a closed one.
 */
class PayrollPeriodGuard
{
    /**
     * Statuses at or beyond which the period's inputs are settled.
     *
     * 'draft' and 'processing' are still open — a run in progress is expected
     * to pick up corrections.
     */
    private const CLOSED_STATUSES = ['locked', 'approved', 'released', 'disbursed'];

    /**
     * The run covering $date for $organizationId, if that period is closed.
     *
     * Returns null when the month has no run, or has one that is still open —
     * in both cases the caller may proceed.
     */
    public function closedRunFor(int $organizationId, Carbon|string $date): ?PayrollMonthlyRun
    {
        $monthYear = ($date instanceof Carbon ? $date : Carbon::parse($date))->format('Y-m');

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $monthYear)
            ->first();

        if (! $run || ! in_array($run->status, self::CLOSED_STATUSES, true)) {
            return null;
        }

        return $run;
    }

    public function isClosed(int $organizationId, Carbon|string $date): bool
    {
        return $this->closedRunFor($organizationId, $date) !== null;
    }

    /**
     * A message naming the period and why the edit was refused, for the 422 an
     * approver sees. Deliberately concrete: "payroll for 2026-06 is approved"
     * tells them what to do next, "forbidden" does not.
     */
    public function refusalMessage(PayrollMonthlyRun $run): string
    {
        return "Payroll for {$run->month_year} is already {$run->status}, so its attendance can no longer be changed. "
            . 'Raise the correction against the next open run instead.';
    }
}
