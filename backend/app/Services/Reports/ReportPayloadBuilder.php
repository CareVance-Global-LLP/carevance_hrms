<?php

namespace App\Services\Reports;

use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;

class ReportPayloadBuilder
{
    public function __construct(
        private readonly TimeEntryDurationService $timeEntryDurationService,
        private readonly TimeBreakdownService $timeBreakdownService,
        private readonly UsageProcessingService $usageProcessingService,
    ) {
    }

    public function buildCommonReportPayload($timeEntries, ?Carbon $startDate = null, ?Carbon $endDate = null): array
    {
        $enrichedEntries = $timeEntries->map(function ($entry) {
            $duration = (int) ($entry->duration ?? 0);
            if (! $entry->end_time && $entry->start_time) {
                $duration = max(
                    $duration,
                    now()->getTimestamp() - Carbon::parse($entry->start_time)->getTimestamp()
                );
            }

            $entry->effective_duration = (int) max(0, $duration);

            return $entry;
        });

        // Break TimeEntries (timer_slot = 'break') must not count as worked time.
        $workedEntries = $enrichedEntries->where('is_break', false)->values();
        $breakEntries = $enrichedEntries->where('is_break', true)->values();

        $totalDuration = (int) $workedEntries->sum('effective_duration');
        $billableDuration = (int) $workedEntries->where('billable', true)->sum('effective_duration');
        $breakDuration = (int) $breakEntries->sum('effective_duration');

        // Idle time must be detected inactivity, never derived from billable.
        // Reuse the same idle-resolution path as the rest of the reports suite.
        $idleByUser = [];
        if ($startDate && $endDate) {
            $userIds = $enrichedEntries->pluck('user_id')->filter()->unique()->values();
            $idleByUser = collect(
                $this->usageProcessingService->summarizeIdleDurationsFastForUsers($userIds, $startDate, $endDate)['by_user'] ?? []
            )->all();
        }
        $idleDuration = (int) array_sum($idleByUser);

        // Work Time = Track Time - Idle Time (canonical formula).
        $workingBreakdown = $this->timeBreakdownService->build($totalDuration, $idleDuration);
        $workingDuration = $workingBreakdown['working_duration'];

        $byProject = $workedEntries->groupBy('project_id')->map(function ($entries) {
            return [
                'project' => $entries->first()->project,
                'total_time' => (int) $entries->sum('effective_duration'),
                'entries' => $entries->values(),
            ];
        })->values();

        $byUser = $workedEntries->groupBy('user_id')->map(function ($entries) use ($idleByUser) {
            $userId = (int) $entries->first()->user_id;
            $userTotal = (int) $entries->sum('effective_duration');
            $userIdle = (int) ($idleByUser[$userId] ?? 0);
            $breakdown = $this->timeBreakdownService->build($userTotal, $userIdle);

            return [
                'user' => $entries->first()->user,
                'total_time' => $userTotal,
                'idle_time' => $breakdown['idle_duration'],
                'working_time' => $breakdown['working_duration'],
                'working_duration' => $breakdown['working_duration'],
                'entries' => $entries->values(),
            ];
        })->values();

        return [
            'entries' => $enrichedEntries,
            'time_entries' => $enrichedEntries,
            'worked_entries' => $workedEntries,
            'break_entries' => $breakEntries,
            'total_time' => $totalDuration,
            'working_time' => $workingDuration,
            'billable_time' => $billableDuration,
            'total_duration' => $totalDuration,
            'working_duration' => $workingDuration,
            'idle_duration' => $idleDuration,
            'idle_time' => $idleDuration,
            'billable_duration' => $billableDuration,
            'total_break_seconds' => $breakDuration,
            'break_hours' => round($breakDuration / 3600, 2),
            'total_hours' => round($totalDuration / 3600, 2),
            'working_hours' => round($workingDuration / 3600, 2),
            'idle_hours' => round($idleDuration / 3600, 2),
            'billable_hours' => round($billableDuration / 3600, 2),
            'by_project' => $byProject,
            'by_user' => $byUser,
        ];
    }

    public function emptyReport(array $extra = []): array
    {
        return array_merge($extra, [
            'entries' => [],
            'time_entries' => [],
            'total_time' => 0,
            'working_time' => 0,
            'billable_time' => 0,
            'total_duration' => 0,
            'working_duration' => 0,
            'idle_duration' => 0,
            'idle_time' => 0,
            'billable_duration' => 0,
            'total_hours' => 0,
            'working_hours' => 0,
            'idle_hours' => 0,
            'billable_hours' => 0,
            'by_project' => [],
            'by_user' => [],
        ]);
    }
}
