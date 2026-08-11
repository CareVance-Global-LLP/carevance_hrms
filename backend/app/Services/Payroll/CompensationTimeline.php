<?php

namespace App\Services\Payroll;

use App\Models\EmployeePayrollTemplate;
use App\Models\SalaryRevisionLetter;
use Carbon\Carbon;

/**
 * What an employee's salary was on any given day.
 *
 * `employee_payroll_templates.annual_ctc` is a single mutable scalar: accepting
 * a revision overwrites it, so the previous rate is gone and no calculation can
 * ask what someone earned last month. A revision effective mid-month therefore
 * paid the new rate for the whole month, and a back-dated one produced no
 * arrear at all because there was nothing left to diff against.
 *
 * Accepted revision letters already record old_ctc, new_ctc and effective_from,
 * which is a dated series in all but name. This reads it as one.
 *
 * Scope: this resolves the timeline and splits a month into rate segments. It
 * does NOT yet feed the payroll engines — wiring segmentation into the run has
 * to reconcile with loss-of-pay day attribution, and a half-correct split is
 * worse than an honest whole-month rate.
 */
class CompensationTimeline
{
    /**
     * Annual CTC in force on $date.
     *
     * Walks back from the current template through accepted revisions: any
     * revision effective after $date is undone to recover the earlier rate.
     */
    public function annualCtcOn(int $userId, int $organizationId, Carbon $date): float
    {
        $template = EmployeePayrollTemplate::where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->first();

        if (! $template) {
            return 0.0;
        }

        $ctc = (float) ($template->annual_ctc ?? 0);

        $laterRevisions = $this->acceptedRevisions($userId, $organizationId)
            ->filter(fn (SalaryRevisionLetter $letter) => $letter->effective_from->gt($date))
            ->sortByDesc(fn (SalaryRevisionLetter $letter) => $letter->effective_from->timestamp);

        foreach ($laterRevisions as $letter) {
            // This revision had not taken effect on $date, so the rate then was
            // whatever it replaced.
            $ctc = (float) $letter->old_ctc;
        }

        return $ctc;
    }

    /**
     * Split a pay month into segments, each at one rate.
     *
     * A month with no revision in it yields exactly one segment covering the
     * whole month — callers can treat the single-segment case as "no change"
     * without special-casing.
     *
     * @param string $monthYear 'Y-m'
     * @return array<int, array{from: Carbon, to: Carbon, days: int, annual_ctc: float}>
     */
    public function segmentsForMonth(int $userId, int $organizationId, string $monthYear): array
    {
        $start = Carbon::createFromFormat('Y-m', $monthYear)->startOfMonth();
        $end = $start->copy()->endOfMonth();

        $boundaries = $this->acceptedRevisions($userId, $organizationId)
            ->filter(fn (SalaryRevisionLetter $letter) => $letter->effective_from->betweenIncluded($start, $end)
                && $letter->effective_from->gt($start))
            ->map(fn (SalaryRevisionLetter $letter) => $letter->effective_from->copy()->startOfDay())
            ->unique(fn (Carbon $date) => $date->toDateString())
            ->sortBy(fn (Carbon $date) => $date->timestamp)
            ->values();

        $segments = [];
        $cursor = $start->copy();

        foreach ($boundaries as $boundary) {
            $segments[] = $this->segment($userId, $organizationId, $cursor, $boundary->copy()->subDay());
            $cursor = $boundary->copy();
        }

        $segments[] = $this->segment($userId, $organizationId, $cursor, $end);

        return $segments;
    }

    /**
     * @return array{from: Carbon, to: Carbon, days: int, annual_ctc: float}
     */
    private function segment(int $userId, int $organizationId, Carbon $from, Carbon $to): array
    {
        return [
            'from' => $from->copy(),
            'to' => $to->copy(),
            // Inclusive of both ends: 1st to 15th is 15 days, not 14.
            'days' => (int) $from->diffInDays($to) + 1,
            'annual_ctc' => $this->annualCtcOn($userId, $organizationId, $from),
        ];
    }

    /** Accepted revisions, newest first. */
    private function acceptedRevisions(int $userId, int $organizationId)
    {
        return SalaryRevisionLetter::query()
            ->where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->where('status', 'accepted')
            ->orderByDesc('effective_from')
            ->get();
    }
}
