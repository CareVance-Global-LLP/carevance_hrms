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
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class DashboardSummaryService
{
    // Cache keys and TTL
    private const CACHE_PREFIX = 'dashboard_summary_';
    private const CACHE_TTL_SECONDS = 30; // Short cache for real-time data
    private const CACHE_TTL_MINUTES = 5; // Longer cache for less volatile data

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

        // Cache key includes user ID and date to invalidate daily
        $cacheKey = self::CACHE_PREFIX . $user->id . '_' . $todayStart->toDateString();

        // Try to get from cache first
        $cached = Cache::get($cacheKey);
        if ($cached && !$this->shouldBypassCache($user)) {
            return $cached;
        }

        $this->closeStalePrimaryRunningEntries((int) $user->id, $todayStart);

        // Fetch all today's entries with eager loading
        $todayEntries = $this->getTodayEntries($user->id, $todayStart, $todayEnd);

        // Get active timer
        $activeEntry = $this->getActiveTimer($user->id);

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

        // Calculate durations with caching for expensive operations
        $todayAdjustmentDuration = $this->manualAdjustmentDurationForRange($user->id, $todayStart, $todayEnd);
        $todayDuration = (int) $todayEntries->sum(fn (TimeEntry $entry) => $this->storedDuration($entry)) + $todayAdjustmentDuration;
        $todayElapsedDuration = (int) $todayEntries->sum(fn (TimeEntry $entry) => $this->elapsedDuration($entry, $now)) + $todayAdjustmentDuration;
        
        // Cache the all-time duration calculation (expensive)
        $allTimeCacheKey = self::CACHE_PREFIX . 'alltime_' . $user->id;
        $allTimeDuration = Cache::remember($allTimeCacheKey, 300, function () use ($user, $now) {
            $allAdjustmentDuration = $this->manualAdjustmentDurationForUser($user->id);
            $closedAllTimeDuration = (int) TimeEntry::query()
                ->where('user_id', $user->id)
                ->whereNotNull('end_time')
                ->sum('duration');
            $runningAllTimeDuration = (int) TimeEntry::query()
                ->where('user_id', $user->id)
                ->whereNull('end_time')
                ->select(['id', 'start_time', 'end_time', 'duration'])
                ->get()
                ->sum(fn (TimeEntry $entry) => $this->elapsedDuration($entry, $now));
            return $closedAllTimeDuration + $runningAllTimeDuration + $allAdjustmentDuration;
        });
        $allTimeElapsedDuration = $allTimeDuration;

        // Cache yesterday's duration
        $yesterdayCacheKey = self::CACHE_PREFIX . 'yesterday_' . $user->id . '_' . $yesterdayStart->toDateString();
        $yesterdayDuration = Cache::remember($yesterdayCacheKey, 3600, function () use ($user, $yesterdayStart, $yesterdayEnd, $now) {
            return (int) TimeEntry::where('user_id', $user->id)
                ->whereBetween('start_time', [$yesterdayStart, $yesterdayEnd])
                ->select(['id', 'start_time', 'end_time', 'duration'])
                ->get()
                ->sum(fn (TimeEntry $entry) => $this->elapsedDuration($entry, $now))
                + $this->manualAdjustmentDurationForRange($user->id, $yesterdayStart, $yesterdayEnd);
        });

        $todayChangePercent = null;
        if ($yesterdayDuration > 0) {
            $todayChangePercent = (int) round((($todayElapsedDuration - $yesterdayDuration) / $yesterdayDuration) * 100);
        }

        // Get team stats (cached)
        $teamStats = $this->getTeamStats($user, $weekStart);

        // Cache week activities calculation (expensive)
        $weekCacheKey = self::CACHE_PREFIX . 'week_' . $user->id . '_' . $weekStart->toDateString();
        $weekData = Cache::remember($weekCacheKey, 300, function () use ($user, $weekStart, $weekEnd, $now) {
            $weekEntries = TimeEntry::where('user_id', $user->id)
                ->whereBetween('start_time', [$weekStart, $weekEnd])
                ->select(['id', 'start_time', 'end_time', 'duration', 'billable'])
                ->get();
            $weekTotal = (int) $weekEntries->sum(fn (TimeEntry $entry) => $this->elapsedDuration($entry, $now))
                + $this->manualAdjustmentDurationForRange($user->id, $weekStart, $weekEnd);
            
            // Only fetch required fields for activities
            $weekActivities = Activity::where('user_id', $user->id)
                ->whereBetween('recorded_at', [$weekStart, $weekEnd])
                ->select(['id', 'user_id', 'time_entry_id', 'type', 'name', 'duration', 'recorded_at'])
                ->get();
            $weekIdle = $this->usageProcessingService->calculateIdleTime($weekActivities);
            $productivityScore = $this->timeBreakdownService->productivityScore($weekTotal, $weekIdle);

            return [
                'week_total' => $weekTotal,
                'productivity_score' => $productivityScore,
            ];
        });

        $result = [
            'active_timer' => $activeEntry,
            'today_entries' => $todayEntries,
            'today_total_duration' => $todayDuration,
            'today_total_elapsed_duration' => $todayElapsedDuration,
            'all_time_total_duration' => $allTimeDuration,
            'all_time_total_elapsed_duration' => $allTimeElapsedDuration,
            'yesterday_total_duration' => $yesterdayDuration,
            'today_change_percent' => $todayChangePercent,
            'active_projects_count' => $teamStats['active_projects_count'],
            'total_projects_count' => $teamStats['total_projects_count'],
            'active_tasks_count' => $teamStats['active_tasks_count'],
            'total_tasks_count' => $teamStats['total_tasks_count'],
            'team_members_count' => $teamStats['team_members_count'],
            'new_members_this_week' => $teamStats['new_members_this_week'],
            'productivity_score' => $weekData['productivity_score'],
        ];

        // Cache the result
        Cache::put($cacheKey, $result, self::CACHE_TTL_SECONDS);

        return $result;
    }

    /**
     * Get today's entries with optimized query
     */
    private function getTodayEntries(int $userId, Carbon $todayStart, Carbon $todayEnd)
    {
        return TimeEntry::with(['project', 'task.group'])
            ->where('user_id', $userId)
            ->whereBetween('start_time', [$todayStart, $todayEnd])
            ->orderBy('start_time', 'desc')
            ->limit(100) // Reasonable limit for dashboard
            ->get();
    }

    /**
     * Get active timer for user
     */
    private function getActiveTimer(int $userId): ?TimeEntry
    {
        return TimeEntry::with(['project', 'task.group'])
            ->where('user_id', $userId)
            ->where(function ($query) {
                $query->where('timer_slot', 'primary')
                    ->orWhereNull('timer_slot');
            })
            ->whereNull('end_time')
            ->orderByDesc('start_time')
            ->first();
    }

    /**
     * Get team stats with caching
     */
    private function getTeamStats(User $user, Carbon $weekStart): array
    {
        if (!$user->organization_id) {
            return [
                'team_members_count' => 0,
                'new_members_this_week' => 0,
                'active_projects_count' => 0,
                'total_projects_count' => 0,
                'active_tasks_count' => 0,
                'total_tasks_count' => 0,
            ];
        }

        $cacheKey = self::CACHE_PREFIX . 'team_stats_' . $user->organization_id . '_' . $user->id . '_' . $weekStart->toDateString();
        
        return Cache::remember($cacheKey, 600, function () use ($user, $weekStart) {
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

            return [
                'team_members_count' => $teamMembersCount,
                'new_members_this_week' => $newMembersThisWeek,
                'active_projects_count' => $activeProjectsCount,
                'total_projects_count' => $totalProjectsCount,
                'active_tasks_count' => $activeTasksCount,
                'total_tasks_count' => $totalTasksCount,
            ];
        });
    }

    /**
     * Check if we should bypass cache (e.g., for debugging)
     */
    private function shouldBypassCache(User $user): bool
    {
        // Check for cache bypass header or query parameter
        return request()->header('X-Cache-Bypass') === 'true' 
            || request()->query('nocache') === '1';
    }

    /**
     * Clear dashboard cache for a user
     */
    public function clearCache(int $userId): void
    {
        $today = now()->toDateString();
        Cache::forget(self::CACHE_PREFIX . $userId . '_' . $today);
        Cache::forget(self::CACHE_PREFIX . 'alltime_' . $userId);
        Cache::forget(self::CACHE_PREFIX . 'week_' . $userId . '_' . now()->startOfWeek()->toDateString());
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
