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
        $idleByUser = collect($idleSummary['by_user'] ?? []);

        $perUser = [];
        foreach ($userIds as $userId) {
            $userEntries = $entries->where('user_id', $userId)->values();
            $workedEntries = $userEntries->where('is_break', false)->values();
            $breakEntries = $userEntries->where('is_break', true)->values();

            $trackTime = (int) $this->timeEntryDurationService->sumEffectiveDuration($workedEntries, $resolvedNow);
            $breakTime = (int) $this->timeEntryDurationService->sumEffectiveDuration($breakEntries, $resolvedNow);
            $idleTime = (int) ($idleByUser->get($userId) ?? 0);

            $breakdown = $this->timeBreakdownService->build($trackTime, $idleTime);

            $perUser[$userId] = [
                'track_time' => $trackTime,
                'work_time' => $breakdown['working_duration'],
                'idle_time' => $breakdown['idle_duration'],
                'break_time' => $breakTime,
            ];
        }

        return $perUser;
    }
}
