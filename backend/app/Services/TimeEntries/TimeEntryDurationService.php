<?php

namespace App\Services\TimeEntries;

use Carbon\Carbon;

class TimeEntryDurationService
{
    /**
     * GROSS tracked duration — never idle-net.
     *
     * Idle is subtracted exactly once, downstream, in
     * TimeBreakdownService::build() (working = track - idle). Subtracting it
     * here as well would double-count; WorkTimeSummaryServiceTest asserts
     * `track_time === work_time + idle_time`, which is that contract written
     * down. Do not "fix" this by subtracting idle_seconds here.
     */
    public function effectiveDuration(object|array $entry, ?Carbon $resolvedEnd = null): int
    {
        $storedDuration = max(0, (int) data_get($entry, 'duration', 0));
        $startTime = data_get($entry, 'start_time');

        if (! $startTime) {
            return $storedDuration;
        }

        $start = Carbon::parse($startTime);
        $endTime = data_get($entry, 'end_time');

        if ($endTime) {
            // A reconciled row's duration was deliberately computed by one of
            // the stop paths (span minus in-window idle). Raising it back to the
            // raw span would re-bill idle that the stop path just removed.
            if (data_get($entry, 'duration_reconciled_at') !== null) {
                return $storedDuration;
            }

            // Unreconciled rows keep the legacy guard. `duration` is not a
            // trustworthy lower bound: store() accepts an end_time with
            // duration 0, update() rewrites start/end without ever recomputing
            // duration, and legacy/offline writers insert zeros. Falling back to
            // the row's own span heals those. TimerScopeRegressionTest locks this in.
            return (int) max(
                $storedDuration,
                $start->diffInSeconds(Carbon::parse($endTime))
            );
        }

        // Open entry: start() never writes `duration`, so it is 0 for the whole
        // life of a running timer and the live span is the only truth.
        $resolvedEnd = $resolvedEnd ?: now();

        return (int) max(
            $storedDuration,
            $start->diffInSeconds($resolvedEnd)
        );
    }

    /**
     * The canonical stop-time rule: span minus idle recorded INSIDE the span.
     *
     * Trailing idle (the tail that triggered an auto-stop) is excluded by
     * rewinding end_time to the last activity, so it must not be passed here
     * as well — it would be subtracted twice.
     *
     * Callers persist the result together with duration_reconciled_at, which is
     * what stops effectiveDuration() from raising it back to the raw span.
     */
    public function reconciledDuration(Carbon $start, Carbon $end, int $inWindowIdleSeconds = 0): int
    {
        return (int) max(0, $start->diffInSeconds($end) - max(0, $inWindowIdleSeconds));
    }

    public function sumEffectiveDuration(iterable $entries, ?Carbon $resolvedEnd = null): int
    {
        $total = 0;

        foreach ($entries as $entry) {
            $total += $this->effectiveDuration($entry, $resolvedEnd);
        }

        return (int) $total;
    }
}
