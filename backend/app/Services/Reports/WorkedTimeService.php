<?php

namespace App\Services\Reports;

use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;

/**
 * The single answer to "how long has this person worked today".
 *
 * There used to be five, and consumers reconciled them by taking the largest:
 * attendance punch seconds, gross time-entry duration, a localStorage snapshot,
 * and two client-side extrapolations. Picking the biggest of five disagreeing
 * numbers is not reconciliation — it produces a figure nobody computed, that
 * changes depending on which source happens to lead at that instant, and that
 * never fails loudly. It is why the shift countdown ran backwards: the client
 * counted wall-clock through an idle period while the server netted the idle
 * out, and a refresh swapped one for the other.
 *
 * Everything that needs worked time reads this. Nothing recomputes it.
 */
class WorkedTimeService
{
    public const DEFAULT_SHIFT_SECONDS = 8 * 3600;

    public function __construct(
        private readonly WorkTimeSummaryService $workTimeSummaryService,
    ) {
    }

    /**
     * @return array{
     *   track_seconds:int, idle_seconds:int, break_seconds:int, worked_seconds:int,
     *   shift_target_seconds:int, remaining_seconds:int, overtime_seconds:int, as_of:string
     * }
     */
    public function forUserToday(User $user, ?Carbon $resolvedNow = null): array
    {
        $resolvedNow = $resolvedNow ?: now();

        return $this->forUserDate($user, $resolvedNow->copy()->startOfDay(), $resolvedNow);
    }

    /**
     * @return array{
     *   track_seconds:int, idle_seconds:int, break_seconds:int, worked_seconds:int,
     *   shift_target_seconds:int, remaining_seconds:int, overtime_seconds:int, as_of:string
     * }
     */
    public function forUserDate(User $user, Carbon $date, ?Carbon $resolvedNow = null): array
    {
        $resolvedNow = $resolvedNow ?: now();
        $start = $date->copy()->startOfDay();
        $end = $date->copy()->endOfDay();

        $summary = $this->workTimeSummaryService->forUserRange((int) $user->id, $start, $end, $resolvedNow);

        $trackSeconds = max(0, (int) ($summary['track_time'] ?? 0));
        $idleSeconds = max(0, (int) ($summary['idle_time'] ?? 0));
        $breakSeconds = max(0, (int) ($summary['break_time'] ?? 0));

        // Paid breaks count toward payable time; unpaid ones do not. This is
        // the explicit form of a decision the code used to make silently — the
        // is_break filter excluded EVERY break from worked time, so all breaks
        // were unpaid without anyone having chosen that.
        $paidBreakSeconds = $this->paidBreakSeconds($user, $start, $end, $resolvedNow);

        // work_time is track minus in-window idle. Breaks are excluded upstream
        // by is_break, so the paid portion is added back exactly once here.
        $workedSeconds = max(0, (int) ($summary['work_time'] ?? 0)) + $paidBreakSeconds;

        $shiftTargetSeconds = $this->shiftTargetSecondsFor($user, $start);

        // worked_seconds is truthful and CAN dip. Idle is only knowable once the
        // detection threshold has elapsed, so the moment a 3-minute absence is
        // confirmed, three minutes previously counted as work are correctly
        // reclassified. That is the right answer for the worked figure.
        //
        // It is the wrong answer for a countdown. A shift clock that jumps back
        // up is what the bug report was about, so remaining is derived from a
        // per-day high-water mark instead: it pauses while worked catches back
        // up, and never rewinds. The two reconcile within one idle threshold.
        $billedSeconds = $this->highWaterWorkedSeconds($user, $start, $workedSeconds);

        return [
            'track_seconds' => $trackSeconds,
            'idle_seconds' => $idleSeconds,
            'break_seconds' => $breakSeconds,
            'paid_break_seconds' => $paidBreakSeconds,
            'worked_seconds' => $workedSeconds,
            'billed_seconds' => $billedSeconds,
            'shift_target_seconds' => $shiftTargetSeconds,
            'remaining_seconds' => max(0, $shiftTargetSeconds - $billedSeconds),
            'overtime_seconds' => max(0, $billedSeconds - $shiftTargetSeconds),
            'as_of' => $resolvedNow->toIso8601String(),
        ];
    }

    /**
     * Seconds spent on breaks whose type is paid, inside the range. A break
     * with no type (legacy rows, or a client that predates types) is unpaid —
     * the conservative reading, and identical to the previous behaviour.
     */
    private function paidBreakSeconds(User $user, Carbon $start, Carbon $end, Carbon $resolvedNow): int
    {
        $entries = \App\Models\TimeEntry::query()
            ->where('user_id', $user->id)
            ->where('is_break', true)
            ->whereBetween('start_time', [$start, $end])
            ->whereHas('breakType', fn ($query) => $query->where('is_paid', true))
            ->get(['id', 'start_time', 'end_time', 'duration']);

        $total = 0;
        foreach ($entries as $entry) {
            $total += app(\App\Services\TimeEntries\TimeEntryDurationService::class)
                ->effectiveDuration($entry, $resolvedNow);
        }

        return max(0, (int) $total);
    }

    /**
     * The highest worked figure seen for this user on this day.
     *
     * Kept in cache rather than a column because it is a presentation guard,
     * not a payroll fact — payroll reads worked_seconds. If the cache is lost
     * the mark simply re-seeds from the current value; the worst case is the
     * countdown correcting once, which is the behaviour we already had.
     */
    private function highWaterWorkedSeconds(User $user, Carbon $date, int $workedSeconds): int
    {
        $key = sprintf('worked_time.high_water:%d:%s', $user->id, $date->toDateString());

        $previous = (int) (Cache::get($key) ?? 0);

        if ($workedSeconds >= $previous) {
            // Hold until the end of the following day so a shift crossing
            // midnight, or a late report, still sees the mark.
            Cache::put($key, $workedSeconds, $date->copy()->addDay()->endOfDay());

            return $workedSeconds;
        }

        return $previous;
    }

    /**
     * Length of the user's shift in seconds. Delegates to AttendanceService so
     * the countdown and the attendance payload can never disagree about how
     * long a shift is.
     */
    public function shiftTargetSecondsFor(User $user, ?Carbon $date = null): int
    {
        $target = (int) app(\App\Services\Attendance\AttendanceService::class)->shiftTargetSeconds();

        return $target > 0 ? $target : self::DEFAULT_SHIFT_SECONDS;
    }
}
