<?php

namespace App\Services\Monitoring;

use App\Models\Activity;
use App\Models\ActivitySession;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;

class ActivityFeedService
{
    // Maximum number of activities to fetch per query
    private const MAX_ACTIVITIES_PER_QUERY = 5000;
    private const CACHE_TTL_SECONDS = 60;

    public function forUsersInRangeForIdle(iterable $userIds, ?Carbon $startDate = null, ?Carbon $endDate = null): Collection
    {
        $userIdCollection = $this->normalizeIds($userIds);
        if ($userIdCollection->isEmpty()) {
            return collect();
        }

        // Build cache key
        $cacheKey = 'activities_idle_' . md5($userIdCollection->implode(',') . ($startDate?->toDateString() ?? '') . ($endDate?->toDateString() ?? ''));
        
        return Cache::remember($cacheKey, self::CACHE_TTL_SECONDS, function () use ($userIdCollection, $startDate, $endDate) {
            // Limit query to prevent memory issues
            $activities = Activity::query()
                ->whereIn('user_id', $userIdCollection)
                ->when($startDate, fn ($query) => $query->where('recorded_at', '>=', $startDate))
                ->when($endDate, fn ($query) => $query->where('recorded_at', '<=', $endDate))
                ->limit(self::MAX_ACTIVITIES_PER_QUERY)
                ->get([
                    'id',
                    'user_id',
                    'time_entry_id',
                    'type',
                    'name',
                    'duration',
                    'recorded_at',
                    'normalized_label',
                    'normalized_domain',
                    'software_name',
                    'tool_type',
                    'classification',
                    'classification_reason',
                ])
                ->map(fn (Activity $activity) => $this->mapActivity($activity));

            $sessionModels = ActivitySession::query()
                ->whereIn('user_id', $userIdCollection)
                ->when($startDate || $endDate, function ($query) use ($startDate, $endDate) {
                    $this->applySessionOverlapFilter($query, $startDate, $endDate);
                })
                ->orderBy('user_id')
                ->orderBy('source')
                ->orderBy('started_at')
                ->orderBy('id')
                ->limit(self::MAX_ACTIVITIES_PER_QUERY)
                ->get([
                    'id',
                    'user_id',
                    'time_entry_id',
                    'source',
                    'activity_kind',
                    'tool_type',
                    'display_name',
                    'app_name',
                    'window_title',
                    'url',
                    'normalized_label',
                    'normalized_domain',
                    'software_name',
                    'classification',
                    'classification_reason',
                    'started_at',
                    'ended_at',
                ]);

            $sessions = $this->mapSessions($sessionModels, $startDate, $endDate);

            return $activities
                ->concat($sessions)
                ->values();
        });
    }

    public function forUsersInRange(iterable $userIds, ?Carbon $startDate = null, ?Carbon $endDate = null): Collection
    {
        $userIdCollection = $this->normalizeIds($userIds);
        if ($userIdCollection->isEmpty()) {
            return collect();
        }

        $activities = Activity::query()
            ->whereIn('user_id', $userIdCollection)
            ->when($startDate, fn ($query) => $query->where('recorded_at', '>=', $startDate))
            ->when($endDate, fn ($query) => $query->where('recorded_at', '<=', $endDate))
            ->limit(self::MAX_ACTIVITIES_PER_QUERY)
            ->get()
            ->map(fn (Activity $activity) => $this->mapActivity($activity));

        $sessionModels = ActivitySession::query()
            ->whereIn('user_id', $userIdCollection)
            ->when($startDate || $endDate, function ($query) use ($startDate, $endDate) {
                $this->applySessionOverlapFilter($query, $startDate, $endDate);
            })
            ->orderBy('user_id')
            ->orderBy('source')
            ->orderBy('started_at')
            ->orderBy('id')
            ->limit(self::MAX_ACTIVITIES_PER_QUERY)
            ->get();

        $sessions = $this->mapSessions($sessionModels, $startDate, $endDate);

        return $activities
            ->concat($sessions)
            ->sortByDesc(fn ($item) => $this->sortTimestamp($item))
            ->values();
    }

    public function forTimeEntriesForIdle(iterable $timeEntryIds, ?Carbon $startDate = null, ?Carbon $endDate = null): Collection
    {
        $timeEntryIdCollection = $this->normalizeIds($timeEntryIds);
        if ($timeEntryIdCollection->isEmpty()) {
            return collect();
        }

        $activities = Activity::query()
            ->whereIn('time_entry_id', $timeEntryIdCollection)
            ->when($startDate, fn ($query) => $query->where('recorded_at', '>=', $startDate))
            ->when($endDate, fn ($query) => $query->where('recorded_at', '<=', $endDate))
            ->limit(self::MAX_ACTIVITIES_PER_QUERY)
            ->get([
                'id',
                'user_id',
                'time_entry_id',
                'type',
                'name',
                'duration',
                'recorded_at',
                'normalized_label',
                'normalized_domain',
                'software_name',
                'tool_type',
                'classification',
                'classification_reason',
            ])
            ->map(fn (Activity $activity) => $this->mapActivity($activity));

        $sessionModels = ActivitySession::query()
            ->whereIn('time_entry_id', $timeEntryIdCollection)
            ->when($startDate || $endDate, function ($query) use ($startDate, $endDate) {
                $this->applySessionOverlapFilter($query, $startDate, $endDate);
            })
            ->orderBy('user_id')
            ->orderBy('source')
            ->orderBy('started_at')
            ->orderBy('id')
            ->limit(self::MAX_ACTIVITIES_PER_QUERY)
            ->get([
                'id',
                'user_id',
                'time_entry_id',
                'source',
                'activity_kind',
                'tool_type',
                'display_name',
                'app_name',
                'window_title',
                'url',
                'normalized_label',
                'normalized_domain',
                'software_name',
                'classification',
                'classification_reason',
                'started_at',
                'ended_at',
            ]);

        $sessions = $this->mapSessions($sessionModels, $startDate, $endDate);

        return $activities
            ->concat($sessions)
            ->values();
    }

    public function pageForUsersInRange(
        iterable $userIds,
        ?Carbon $startDate = null,
        ?Carbon $endDate = null,
        int $page = 1,
        int $perPage = 10,
        ?string $type = null,
        ?string $classification = null,
        ?string $toolType = null,
        bool $includeTotal = true,
    ): array {
        $userIdCollection = $this->normalizeIds($userIds);
        if ($userIdCollection->isEmpty()) {
            return ['items' => collect(), 'total' => 0];
        }

        $page = max(1, $page);
        $perPage = max(1, min($perPage, 50)); // Max 50 per page
        $offset = ($page - 1) * $perPage;
        
        // Use smaller window for better performance
        $windowSize = $offset + $perPage + ($includeTotal ? $perPage : 1);
        $windowSize = min($windowSize, self::MAX_ACTIVITIES_PER_QUERY);

        $activitiesQuery = Activity::query()
            ->whereIn('user_id', $userIdCollection)
            ->when($startDate, fn ($query) => $query->where('recorded_at', '>=', $startDate))
            ->when($endDate, fn ($query) => $query->where('recorded_at', '<=', $endDate));
        $this->applyActivityFilters($activitiesQuery, $type, $classification, $toolType);

        // Use approximate count for large datasets (much faster)
        $activityTotal = null;
        if ($includeTotal) {
            $activityTotal = $this->getApproximateCount($activitiesQuery);
        }
        
        $activities = (clone $activitiesQuery)
            ->orderByDesc('recorded_at')
            ->orderByDesc('id')
            ->limit($windowSize)
            ->get()
            ->map(fn (Activity $activity) => $this->mapActivity($activity));

        $sessionsQuery = ActivitySession::query()
            ->whereIn('user_id', $userIdCollection)
            ->when($startDate || $endDate, function ($query) use ($startDate, $endDate) {
                $this->applySessionOverlapFilter($query, $startDate, $endDate);
            });
        $this->applySessionFilters($sessionsQuery, $type, $classification, $toolType);

        $sessionTotal = null;
        if ($includeTotal) {
            $sessionTotal = $this->getApproximateCount($sessionsQuery);
        }
        
        $sessionModels = (clone $sessionsQuery)
            ->orderByRaw('COALESCE(ended_at, started_at) DESC')
            ->orderByDesc('id')
            ->limit($windowSize)
            ->get();

        $sessions = $this->mapSessions($sessionModels, $startDate, $endDate);

        $items = $activities
            ->concat($sessions)
            ->sortByDesc(fn ($item) => $this->sortTimestamp($item))
            ->slice($offset, $perPage + ($includeTotal ? 0 : 1))
            ->values();
        $hasMore = $items->count() > $perPage;

        return [
            'items' => $items->take($perPage)->values(),
            'total' => $includeTotal ? ((int) $activityTotal + (int) $sessionTotal) : null,
            'has_more' => $hasMore,
        ];
    }

    /**
     * Get approximate count for better performance on large tables
     */
    private function getApproximateCount($query): int
    {
        try {
            // For PostgreSQL, use EXPLAIN to get approximate count
            $sql = $query->toSql();
            $bindings = $query->getBindings();
            $fullSql = vsprintf(str_replace('?', '%s', $sql), array_map(fn ($b) => is_string($b) ? "'$b'" : $b, $bindings));
            
            // Use EXPLAIN to get estimated rows
            $explain = \DB::select("EXPLAIN (FORMAT JSON) " . $fullSql);
            if (!empty($explain) && isset($explain[0]->QUERY PLAN)) {
                $plan = json_decode($explain[0]->QUERY PLAN, true);
                if (isset($plan[0]['Plan']['Plan Rows'])) {
                    return (int) $plan[0]['Plan']['Plan Rows'];
                }
            }
        } catch (\Throwable $e) {
            Log::warning('Failed to get approximate count, falling back to exact count', ['error' => $e->getMessage()]);
        }
        
        // Fallback to exact count
        return $query->count();
    }

    public function forTimeEntries(iterable $timeEntryIds, ?Carbon $startDate = null, ?Carbon $endDate = null): Collection
    {
        $timeEntryIdCollection = $this->normalizeIds($timeEntryIds);
        if ($timeEntryIdCollection->isEmpty()) {
            return collect();
        }

        $activities = Activity::query()
            ->whereIn('time_entry_id', $timeEntryIdCollection)
            ->when($startDate, fn ($query) => $query->where('recorded_at', '>=', $startDate))
            ->when($endDate, fn ($query) => $query->where('recorded_at', '<=', $endDate))
            ->limit(self::MAX_ACTIVITIES_PER_QUERY)
            ->get()
            ->map(fn (Activity $activity) => $this->mapActivity($activity));

        $sessionModels = ActivitySession::query()
            ->whereIn('time_entry_id', $timeEntryIdCollection)
            ->when($startDate || $endDate, function ($query) use ($startDate, $endDate) {
                $this->applySessionOverlapFilter($query, $startDate, $endDate);
            })
            ->orderBy('user_id')
            ->orderBy('source')
            ->orderBy('started_at')
            ->orderBy('id')
            ->limit(self::MAX_ACTIVITIES_PER_QUERY)
            ->get();

        $sessions = $this->mapSessions($sessionModels, $startDate, $endDate);

        return $activities
            ->concat($sessions)
            ->sortByDesc(fn ($item) => $this->sortTimestamp($item))
            ->values();
    }

    public function recentForUsers(iterable $userIds, Carbon $since, ?Carbon $until = null): Collection
    {
        return $this->forUsersInRange($userIds, $since, $until ?? now());
    }

    private function normalizeIds(iterable $ids): Collection
    {
        return collect($ids)
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values();
    }

    private function applySessionOverlapFilter($query, ?Carbon $startDate, ?Carbon $endDate): void
    {
        if ($endDate) {
            $query->where('started_at', '<=', $endDate);
        }

        if ($startDate) {
            $query->where(function ($nestedQuery) use ($startDate) {
                $nestedQuery->whereNull('ended_at')
                    ->orWhere('ended_at', '>=', $startDate);
            });
        }
    }

    private function applyActivityFilters($query, ?string $type, ?string $classification, ?string $toolType): void
    {
        if ($type) {
            $query->where('type', $type);
        }

        if ($classification) {
            $query->where('classification', $classification);
        }

        if ($toolType) {
            $query->where('tool_type', $toolType);
        }
    }

    private function applySessionFilters($query, ?string $type, ?string $classification, ?string $toolType): void
    {
        $type = strtolower(trim((string) $type));

        if ($type === 'idle') {
            $query->whereIn('activity_kind', ['desktop_idle', 'idle']);
        } elseif ($type === 'url') {
            $query->whereIn('activity_kind', ['website', 'browser', 'browser_tab']);
        } elseif ($type === 'app') {
            $query->whereNotIn('activity_kind', ['desktop_idle', 'idle', 'website', 'browser', 'browser_tab']);
        }

        if ($classification) {
            $query->where('classification', $classification);
        }

        if ($toolType) {
            $query->where('tool_type', $toolType);
        }
    }

    private function mapActivity(Activity $activity): object
    {
        return (object) [
            'id' => (int) $activity->id,
            'source' => 'activity',
            'user_id' => (int) $activity->user_id,
            'time_entry_id' => $activity->time_entry_id ? (int) $activity->time_entry_id : null,
            'type' => (string) $activity->type,
            'name' => (string) $activity->name,
            'duration' => max(0, (int) $activity->duration),
            'recorded_at' => $activity->recorded_at?->copy(),
            'normalized_label' => $activity->normalized_label,
            'normalized_domain' => $activity->normalized_domain,
            'software_name' => $activity->software_name,
            'tool_type' => $activity->tool_type,
            'classification' => $activity->classification,
            'classification_reason' => $activity->classification_reason,
            'created_at' => $activity->created_at?->copy(),
            'updated_at' => $activity->updated_at?->copy(),
        ];
    }

    private function mapSessions(Collection $sessions, ?Carbon $rangeStart, ?Carbon $rangeEnd): Collection
    {
        $orderedSessions = $sessions
            ->sortBy([
                ['user_id', 'asc'],
                ['source', 'asc'],
                ['started_at', 'asc'],
                ['id', 'asc'],
            ])
            ->values();

        $nextSessionStarts = [];

        foreach ($orderedSessions->reverse()->values() as $session) {
            if (! $session instanceof ActivitySession) {
                continue;
            }

            $partitionKey = $this->sessionPartitionKey($session);
            $nextSessionStarts[$session->id] = $nextSessionStarts[$partitionKey] ?? null;

            if ($session->started_at instanceof Carbon) {
                $nextSessionStarts[$partitionKey] = $session->started_at->copy();
            }
        }

        return $orderedSessions
            ->map(fn (ActivitySession $session) => $this->mapSession(
                $session,
                $rangeStart,
                $rangeEnd,
                $nextSessionStarts[$session->id] ?? null,
            ))
            ->filter()
            ->values();
    }

    private function mapSession(ActivitySession $session, ?Carbon $rangeStart, ?Carbon $rangeEnd, ?Carbon $nextStartedAt = null): ?object
    {
        $effectiveStart = $session->started_at?->copy();
        if (! $effectiveStart) {
            return null;
        }

        $effectiveEnd = $session->ended_at?->copy()
            ?? ($nextStartedAt?->copy() ?: now());

        if ($rangeStart && $effectiveEnd->lessThanOrEqualTo($rangeStart)) {
            return null;
        }

        if ($rangeEnd && $effectiveStart->greaterThanOrEqualTo($rangeEnd)) {
            return null;
        }

        if ($rangeStart && $effectiveStart->lessThan($rangeStart)) {
            $effectiveStart = $rangeStart->copy();
        }

        if ($rangeEnd && $effectiveEnd->greaterThan($rangeEnd)) {
            $effectiveEnd = $rangeEnd->copy();
        }

        if ($effectiveEnd->lessThanOrEqualTo($effectiveStart)) {
            return null;
        }

        $type = $this->resolveSessionType($session);
        $duration = max(0, $effectiveStart->diffInSeconds($effectiveEnd));

        return (object) [
            'id' => (int) $session->id,
            'source' => 'activity_session',
            'user_id' => (int) $session->user_id,
            'time_entry_id' => $session->time_entry_id ? (int) $session->time_entry_id : null,
            'type' => $type,
            'name' => $this->resolveSessionName($session),
            'duration' => $duration,
            'recorded_at' => $effectiveEnd->copy(),
            'normalized_label' => $session->normalized_label,
            'normalized_domain' => $session->normalized_domain,
            'software_name' => $session->software_name,
            'tool_type' => $session->tool_type,
            'classification' => $session->classification,
            'classification_reason' => $session->classification_reason,
            'started_at' => $effectiveStart,
            'ended_at' => $effectiveEnd->copy(),
            'display_name' => $session->display_name,
            'app_name' => $session->app_name,
            'window_title' => $session->window_title,
            'url' => $session->url,
            'confidence' => $session->confidence,
            'metadata' => $session->metadata,
            'created_at' => $session->created_at?->copy(),
            'updated_at' => $session->updated_at?->copy(),
        ];
    }

    private function sessionPartitionKey(ActivitySession $session): string
    {
        return implode('|', [
            (int) $session->user_id,
            strtolower(trim((string) $session->source)),
        ]);
    }

    private function resolveSessionType(ActivitySession $session): string
    {
        return match (strtolower(trim((string) $session->activity_kind))) {
            'desktop_idle', 'idle' => 'idle',
            'website', 'browser', 'browser_tab' => 'url',
            default => 'app',
        };
    }

    private function resolveSessionName(ActivitySession $session): string
    {
        return (string) (
            $session->display_name
            ?: $session->app_name
            ?: $session->window_title
            ?: $session->url
            ?: 'Unknown Activity'
        );
    }

    private function sortTimestamp(object $item): int
    {
        $recordedAt = $item->recorded_at;

        if ($recordedAt instanceof Carbon) {
            return $recordedAt->getTimestamp();
        }

        return Carbon::parse((string) $recordedAt)->getTimestamp();
    }
}
