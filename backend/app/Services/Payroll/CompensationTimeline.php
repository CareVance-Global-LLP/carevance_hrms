<?php

namespace App\Services\Payroll;

use App\Support\MonthYear;
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
 * Scope: this resolves the timeline, splits a month into rate segments, and
 * blends those segments into the single monthly rate the payroll run uses —
 * see blendedAnnualCtcForMonth(), which PayrollAutoProcessService now calls.
 *
 * Loss of pay is applied after blending, not per segment. LOP is a deduction
 * against the month's earned gross, and the month has one gross once the
 * segments are blended; attributing LOP days to particular segments would
 * require knowing which side of the revision each absence fell on, which the
 * attendance data does not distinguish and the employee would not expect.
 *
 * Note this class needs employee_payroll_templates.annual_ctc to keep holding
 * the CURRENT rate: annualCtcOn() starts there and walks backwards through
 * later revisions. Do not stop writing it on accept — the history lives in the
 * letters, the pointer lives on the template, and removing the pointer breaks
 * the walk.
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
        $start = MonthYear::start($monthYear);
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
     * One annual CTC for the month that pays each segment at its own rate.
     *
     * The mechanical detail that makes this correct, and which is easy to get
     * subtly wrong: <b>every segment is divided by the pay period's day count,
     * not by its own length.</b> That shared denominator is what makes the
     * segments sum to exactly one month's pay. Keka's worked example for a
     * revision effective 1 April on a 20th-to-19th cycle:
     *
     *     Mar 20-31 = (30,000 x 12) / 31 = 11,612.90
     *     Apr 1-19  = (35,000 x 19) / 31 = 21,451.61
     *                              total = 33,064.51
     *
     * Both denominators are 31 -- the period's length -- not 31 and 30. Divide
     * each segment by its own month and every mid-month revision is out by a
     * few hundred rupees in a way nobody can explain from the payslip.
     *
     * Returned as an ANNUAL figure so callers divide by 12 exactly as they
     * already do for a flat rate. A month with no revision returns the flat
     * rate unchanged, so wiring this in costs nothing for the 99% case.
     *
     * Blending to one rate, rather than running payroll per segment, is
     * deliberate: PF's wage cap, the ESI ceiling and PT slabs are all monthly
     * tests. Evaluating them once per segment would apply each cap twice.
     */
    public function blendedAnnualCtcForMonth(int $userId, int $organizationId, string $monthYear): float
    {
        $segments = $this->segmentsForMonth($userId, $organizationId, $monthYear);

        if ($segments === []) {
            return 0.0;
        }

        if (count($segments) === 1) {
            return (float) $segments[0]['annual_ctc'];
        }

        $periodDays = array_sum(array_column($segments, 'days'));

        if ($periodDays <= 0) {
            return (float) $segments[0]['annual_ctc'];
        }

        $blended = 0.0;
        foreach ($segments as $segment) {
            $blended += (float) $segment['annual_ctc'] * ((int) $segment['days'] / $periodDays);
        }

        return $blended;
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
