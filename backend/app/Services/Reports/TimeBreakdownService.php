<?php

namespace App\Services\Reports;

class TimeBreakdownService
{
    public function build(int $trackedDuration, int $idleDuration, int $nonIdleActivityDuration = 0): array
    {
        $totalDuration = max(0, $trackedDuration);

        // When non-idle activities span a wider range than the time entries (e.g. full-day
        // activities vs. per-timer tracking), pro-rata idle to the tracked period
        // so that idle from outside the timer windows doesn't erase tracked work.
        // IMPORTANT: Only non-idle activity duration is used here. Including idle
        // activity durations inflates the denominator and incorrectly reduces idle
        // (e.g., cumulative idle updates of 60+180+300=540 vs actual merged 300).
        if ($nonIdleActivityDuration > $totalDuration && $nonIdleActivityDuration > 0) {
            $idleDuration = (int) round($idleDuration * ($totalDuration / $nonIdleActivityDuration));
        }

        // Never reduce idle below what the actual idle records report.
        // Legitimate idle can be 100% of tracked time (e.g., auto-stop after idle detection).
        $normalizedIdleDuration = min(max(0, $idleDuration), $totalDuration);
        $workingDuration = max($totalDuration - $normalizedIdleDuration, 0);

        return [
            'total_duration' => $totalDuration,
            'working_time' => $workingDuration,
            'working_duration' => $workingDuration,
            'working_hours' => round($workingDuration / 3600, 2),
            'billable_time' => $workingDuration,
            'billable_duration' => $workingDuration,
            'billable_hours' => round($workingDuration / 3600, 2),
            'idle_time' => $normalizedIdleDuration,
            'idle_duration' => $normalizedIdleDuration,
            'idle_hours' => round($normalizedIdleDuration / 3600, 2),
            'non_working_duration' => $normalizedIdleDuration,
            'non_billable_duration' => $normalizedIdleDuration,
            'working_percentage' => $totalDuration > 0
                ? (float) round(($workingDuration / $totalDuration) * 100, 2)
                : 0.0,
            'idle_percentage' => $totalDuration > 0
                ? (float) round(($normalizedIdleDuration / $totalDuration) * 100, 2)
                : 0.0,
        ];
    }

    public function productivityScore(int $trackedDuration, int $idleDuration): int
    {
        return (int) round($this->build($trackedDuration, $idleDuration)['working_percentage']);
    }
}
