<?php

namespace App\Services\Reports;

use App\Models\Activity;
use App\Models\AttendanceRecord;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Authorization\GroupAccessService;
use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;

class DashboardSummaryService
{
    public function __construct(
        private readonly TimeBreakdownService $timeBreakdownService,
        private readonly UsageProcessingService $usageProcessingService,
        private readonly GroupAccessService $groupAccessService,
        private readonly TimeEntryDurationService $timeEntryDurationService,
    ) {
    }

    public function build(User $user): array
    {
        $now = now();
        $todayStart = $now->copy()->startOfDay();
        $todayEnd = $now->copy()->endOfDay();
        $yesterdayStart = $now->copy()->subDay()->startOfDay();
        $yesterdayEnd = $now->copy()->subDay()->endOfDay();
        $weekStart = $now->copy()->startOfWeek();
        $weekEnd = $now->copy()->endOfWeek();

        $this->closeStalePrimaryRunningEntries((int) $user->id, $todayStart);

        $todayEntries = TimeEntry::with('project', 'task.group')
            ->where('user_id', $user->id)
            ->whereBetween('start_time', [$todayStart, $todayEnd])
            ->orderBy('start_time', 'desc')
            ->get();

        $activeEntry = TimeEntry::with('project', 'task.group')
            ->where('user_id', $user->id)
            ->where(function ($query) {
                $query->where('timer_slot', 'primary')
                    ->orWhereNull('timer_slot');
            })
            ->whereNull('end_time')
            ->orderByDesc('start_time')
            ->first();

        $activeDuration = 0;
        if ($activeEntry) {
            $activeDuration = max(
                0,
                now()->getTimestamp() - Carbon::parse($activeEntry->start_time)->getTimestamp()
            );
            $activeEntry->duration = (int) $activeDuration;
        }

        $todayEntries->transform(function (TimeEntry $entry) use ($now) {
            $entry->duration = $this->elapsedDuration($entry, $now);

            return $entry;
        });

        $todayAdjustmentDuration = $this->manualAdjustmentDurationForRange($user->id, $todayStart, $todayEnd);
        $todayDuration = (int) $todayEntries->sum(fn (TimeEntry $entry) => $this->storedDuration($entry)) + $todayAdjustmentDuration;
        $todayElapsedDuration = (int) $todayEntries->sum(fn (TimeEntry $entry) => $this->elapsedDuration($entry, $now)) + $todayAdjustmentDuration;
        $allEntries = TimeEntry::where('user_id', $user->id)->get(['id', 'start_time', 'end_time', 'duration', 'billable']);
        $allAdjustmentDuration = $this->manualAdjustmentDurationForUser($user->id);
        $allTimeDuration = (int) $allEntries->sum(fn (TimeEntry $entry) => $this->storedDuration($entry)) + $allAdjustmentDuration;
        $allTimeElapsedDuration = (int) $allEntries->sum(fn (TimeEntry $entry) => $this->elapsedDuration($entry, $now)) + $allAdjustmentDuration;

        $yesterdayDuration = (int) TimeEntry::where('user_id', $user->id)
            ->whereBetween('start_time', [$yesterdayStart, $yesterdayEnd])
            ->get(['id', 'start_time', 'end_time', 'duration'])
            ->sum(fn (TimeEntry $entry) => $this->elapsedDuration($entry, $now))
            + $this->manualAdjustmentDurationForRange($user->id, $yesterdayStart, $yesterdayEnd);

        $todayChangePercent = null;
        if ($yesterdayDuration > 0) {
            $todayChangePercent = (int) round((($todayElapsedDuration - $yesterdayDuration) / $yesterdayDuration) * 100);
        }

        $teamMembersCount = 0;
        $newMembersThisWeek = 0;
        $activeProjectsCount = 0;
        $totalProjectsCount = 0;
        $activeTasksCount = 0;
        $totalTasksCount = 0;

        if ($user->organization_id) {
            $visibleUsersQuery = $this->visibleTeamMembersQuery($user);
            $teamMembersCount = (clone $visibleUsersQuery)->count();
            $newMembersThisWeek = (clone $visibleUsersQuery)
                ->where('created_at', '>=', $weekStart)
                ->count();

            $activeProjectsCount = Project::where('organization_id', $user->organization_id)
                ->where('status', 'active')
                ->count();
            $totalProjectsCount = Project::where('organization_id', $user->organization_id)->count();

            $visibleTasksQuery = Task::query();
            $this->groupAccessService->applyTaskVisibilityScope($visibleTasksQuery, $user);
            $activeTasksCount = (clone $visibleTasksQuery)
                ->where('status', '!=', 'done')
                ->count();
            $totalTasksCount = (clone $visibleTasksQuery)->count();
        }

        $weekEntries = TimeEntry::where('user_id', $user->id)
            ->whereBetween('start_time', [$weekStart, $weekEnd])
            ->get(['id', 'start_time', 'end_time', 'duration', 'billable']);
        $weekTotal = (int) $weekEntries->sum(fn (TimeEntry $entry) => $this->elapsedDuration($entry, $now))
            + $this->manualAdjustmentDurationForRange($user->id, $weekStart, $weekEnd);
        $weekActivities = Activity::where('user_id', $user->id)
            ->whereBetween('recorded_at', [$weekStart, $weekEnd])
            ->get(['id', 'user_id', 'time_entry_id', 'type', 'name', 'duration', 'recorded_at']);
        $weekIdle = $this->usageProcessingService->calculateIdleTime($weekActivities);
        $productivityScore = $this->timeBreakdownService->productivityScore($weekTotal, $weekIdle);

        return [
            'active_timer' => $activeEntry,
            'today_entries' => $todayEntries,
            'today_total_duration' => $todayDuration,
            'today_total_elapsed_duration' => $todayElapsedDuration,
            'all_time_total_duration' => $allTimeDuration,
            'all_time_total_elapsed_duration' => $allTimeElapsedDuration,
            'yesterday_total_duration' => $yesterdayDuration,
            'today_change_percent' => $todayChangePercent,
            'active_projects_count' => $activeProjectsCount,
            'total_projects_count' => $totalProjectsCount,
            'active_tasks_count' => $activeTasksCount,
            'total_tasks_count' => $totalTasksCount,
            'team_members_count' => $teamMembersCount,
            'new_members_this_week' => $newMembersThisWeek,
            'productivity_score' => $productivityScore,
        ];
    }

    private function storedDuration(TimeEntry $entry): int
    {
        return (int) max(0, (int) ($entry->duration ?? 0));
    }

    private function elapsedDuration(TimeEntry $entry, Carbon $now): int
    {
        if ($entry->end_time) {
            return (int) max(
                $this->storedDuration($entry),
                Carbon::parse($entry->start_time)->diffInSeconds(Carbon::parse($entry->end_time))
            );
        }

        return (int) max(
            $this->storedDuration($entry),
            Carbon::parse($entry->start_time)->diffInSeconds($now)
        );
    }

    private function manualAdjustmentDurationForRange(int $userId, Carbon $start, Carbon $end): int
    {
        return (int) AttendanceRecord::query()
            ->where('user_id', $userId)
            ->whereDate('attendance_date', '>=', $start->toDateString())
            ->whereDate('attendance_date', '<=', $end->toDateString())
            ->sum('manual_adjustment_seconds');
    }

    private function visibleTeamMembersQuery(User $user)
    {
        $query = User::query()->where('organization_id', $user->organization_id);

        if ($user->role === 'admin') {
            return $query;
        }

        $visibleGroupIds = $this->groupAccessService->visibleGroupIds($user);
        if (is_array($visibleGroupIds)) {
            if (empty($visibleGroupIds)) {
                return User::query()->whereRaw('1 = 0');
            }

            return $query
                ->whereHas('groups', fn ($groupQuery) => $groupQuery->whereIn('groups.id', $visibleGroupIds))
                ->distinct('users.id');
        }

        return $query;
    }

    private function manualAdjustmentDurationForUser(int $userId): int
    {
        return (int) AttendanceRecord::query()
            ->where('user_id', $userId)
            ->sum('manual_adjustment_seconds');
    }

    private function closeStalePrimaryRunningEntries(int $userId, Carbon $boundaryAt): void
    {
        $staleEntries = TimeEntry::query()
            ->where('user_id', $userId)
            ->whereNull('end_time')
            ->where(function ($query) {
                $query->where('timer_slot', 'primary')
                    ->orWhereNull('timer_slot');
            })
            ->where('start_time', '<', $boundaryAt)
            ->get();

        foreach ($staleEntries as $entry) {
            $entry->update([
                'end_time' => $boundaryAt,
                'duration' => $this->timeEntryDurationService->effectiveDuration($entry, $boundaryAt),
            ]);
        }
    }
}
