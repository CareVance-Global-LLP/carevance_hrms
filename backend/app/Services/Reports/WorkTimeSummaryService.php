<?php

namespace App\Services\Reports;

use App\Models\TimeEntry;
use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;
use Illuminate\Support\Collection;

/**
 * Single source of truth for the standardized time breakdown used across
 * every dashboard, the desktop app, and all reports.
 *
 * Track Time = worked (is_break = false) session time
 * Idle Time  = detected inactivity during sessions
 * Work Time  = Track Time - Idle Time
 * Break Time = separate bucket, NEVER included in Track/Work/Idle
 *
 * Every consumer (employee dashboard, desktop timer, HR/Admin dashboard,
 * attendance, reports) must derive these four values from this service so
 * the formula is identical everywhere.
 */
class WorkTimeSummaryService
{
    public function __construct(
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly TimeBreakdownService $timeBreakdownService,
        private readonly UsageProcessingService $usageProcessingService,
    ) {
    }

    /**
     * @return array{track_time: int, work_time: int, idle_time: int, break_time: int}
     */
    public function forUserRange(int $userId, Carbon $start, Carbon $end, ?Carbon $resolvedNow = null): array
    {
        $resolvedNow = $resolvedNow ?? now();

        $entries = TimeEntry::where('user_id', $userId)
            ->whereBetween('start_time', [$start, $end])
            ->get(['id', 'user_id', 'start_time', 'end_time', 'duration', 'is_break', 'billable']);

        $perUser = $this->buildFromEntries($entries, [$userId], $start, $end, $resolvedNow);

        return $perUser[$userId] ?? [
            'track_time' => 0,
            'work_time' => 0,
            'idle_time' => 0,
            'break_time' => 0,
        ];
    }

    /**
     * @return array<int, array{track_time: int, work_time: int, idle_time: int, break_time: int}>
     */
    public function forUsers(Collection $userIds, Carbon $start, Carbon $end, ?Carbon $resolvedNow = null): array
    {
        $resolvedNow = $resolvedNow ?? now();
        $ids = $userIds
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->unique()
            ->values();

        if ($ids->isEmpty()) {
            return [];
        }

        $entries = TimeEntry::whereIn('user_id', $ids)
            ->whereBetween('start_time', [$start, $end])
            ->get(['id', 'user_id', 'start_time', 'end_time', 'duration', 'is_break', 'billable']);

        return $this->buildFromEntries($entries, $ids, $start, $end, $resolvedNow);
    }

    private function buildFromEntries(Collection $entries, array|Collection $userIds, Carbon $start, Carbon $end, Carbon $resolvedNow): array
    {
        $idleSummary = $this->usageProcessingService->summarizeIdleDurationsFastForUsers($userIds, $start, $end);
        // Clipped to entry windows: what still needs subtracting from tracked time.
        $idleByUser = collect($idleSummary['by_user'] ?? []);
        // Unclipped: how long the person was actually idle, which is what gets shown.
        $measuredIdleByUser = collect($idleSummary['by_user_measured'] ?? []);

        $perUser = [];
        foreach ($userIds as $userId) {
            $userEntries = $entries->where('user_id', $userId)->values();
            $workedEntries = $userEntries->where('is_break', false)->values();
            $breakEntries = $userEntries->where('is_break', true)->values();

            $trackTime = (int) $this->timeEntryDurationService->sumEffectiveDuration($workedEntries, $resolvedNow);
            $breakTime = (int) $this->timeEntryDurationService->sumEffectiveDuration($breakEntries, $resolvedNow);
            $idleTime = (int) ($idleByUser->get($userId) ?? 0);

            /*
             * Deliberately the CLIPPED figure, and only this one.
             *
             * work_time = track - idle, and tracked time only ever counts what
             * lies inside an entry. An idle auto-stop already rewound the entry
             * to the last keypress, so subtracting the tail again would remove
             * it twice - and worked time feeds payroll. Changing what is
             * DISPLAYED must not change what is paid.
             */
            $breakdown = $this->timeBreakdownService->build($trackTime, $idleTime);

            /*
             * What a person reads. Measured on live data 21 Aug 2026, a
             * five-minute idle span sat entirely outside its own entry, so the
             * clipped figure was ZERO while the auto-stop email correctly
             * reported the full span - three surfaces reporting three numbers
             * for one event. Falls back to the clipped value when no measured
             * figure exists, so nothing regresses.
             */
            $measuredIdleTime = (int) ($measuredIdleByUser->get($userId) ?? $idleTime);

            $perUser[$userId] = [
                'track_time' => $trackTime,
                'work_time' => $breakdown['working_duration'],
                // The measured figure, not the clipped one - see above.
                'idle_time' => $measuredIdleTime,
                // Kept separately for anything that needs to reconcile against
                // work_time, which is derived from the clipped value.
                'idle_time_billable' => $breakdown['idle_duration'],
                'break_time' => $breakTime,
            ];
        }

        return $perUser;
    }
}
