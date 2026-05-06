<?php

namespace App\Services\Reports;

use App\Services\Monitoring\ProductivityClassifier;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;

class UsageProcessingService
{
    public function __construct(
        private readonly ActivityProductivityService $activityProductivityService,
        private readonly ProductivityClassifier $productivityClassifier,
    ) {
    }

    public function describeTool(?string $tool, ?string $activityType = 'app'): array
    {
        $resolvedType = strtolower(trim((string) $activityType));
        $label = $resolvedType === 'idle'
            ? 'idle'
            : $this->canonicalizeToolLabel((string) $tool, $resolvedType);
        $toolType = $resolvedType === 'idle'
            ? 'idle'
            : $this->resolveToolType($resolvedType, (string) $tool, $label);

        return [
            'label' => $label,
            'type' => $toolType,
            'classification' => $this->classifyUsage($label, (string) $tool, $resolvedType),
        ];
    }

    public function normalizeUsageLogs(iterable $logs): Collection
    {
        $normalized = collect($logs)
            ->map(fn ($log) => $this->toNormalizedRow($log))
            ->filter()
            ->values();

        $idleRows = $this->mergeIntervals(
            $normalized->where('type', 'idle')->values(),
            mergeDuplicatesOnly: false,
            partitionBy: fn (array $row) => (int) ($row['user_id'] ?? 0)
        );

        $activeRows = $this->mergeIntervals(
            $normalized->reject(fn (array $row) => $row['type'] === 'idle')->values(),
            mergeDuplicatesOnly: true
        );

        $exclusiveActiveRows = $this->resolveCrossToolOverlaps($activeRows);

        return $exclusiveActiveRows
            ->concat($idleRows)
            ->sortBy([
                ['user_id', 'asc'],
                ['time_entry_id', 'asc'],
                ['start_timestamp', 'asc'],
                ['end_timestamp', 'asc'],
                ['id', 'asc'],
            ])
            ->values();
    }

    public function detectAndFilterIdleTime(iterable $logs, iterable $activityEvents = []): array
    {
        $normalizedLogs = collect($logs)->values();
        $activeLogs = $normalizedLogs->reject(fn (array $row) => $row['type'] === 'idle')->values();
        $explicitIdleLogs = $normalizedLogs->where('type', 'idle')->values();
        $inferredIdleLogs = $this->inferIdleIntervals($activeLogs, $activityEvents);

        $idleLogs = $this->mergeIntervals(
            $explicitIdleLogs->concat($inferredIdleLogs)->values(),
            mergeDuplicatesOnly: false,
            partitionBy: fn (array $row) => (int) ($row['user_id'] ?? 0)
        )->map(function (array $row) {
            $row['is_idle'] = true;

            return $row;
        })->values();

        $activeWithoutIdle = $this->subtractIdleFromActiveLogs($activeLogs, $idleLogs)
            ->map(function (array $row) {
                $row['is_idle'] = false;

                return $row;
            })
            ->values();

        return [
            'active_logs' => $activeWithoutIdle,
            'idle_logs' => $idleLogs,
            'all_logs' => $activeWithoutIdle->concat($idleLogs)
                ->sortBy([
                    ['user_id', 'asc'],
                    ['time_entry_id', 'asc'],
                    ['start_timestamp', 'asc'],
                    ['end_timestamp', 'asc'],
                    ['id', 'asc'],
                ])
                ->values(),
            'idle_time' => (int) $idleLogs->sum('duration'),
            'idle_segments_count' => $idleLogs->count(),
        ];
    }

    public function classifyUsage(?string $tool, ?string $url = null, ?string $activityType = null): string
    {
        $result = $this->productivityClassifier->classifyContext([
            'raw_name' => (string) ($tool ?: $url),
            'activity_type' => (string) $activityType,
            'url' => (string) $url,
        ]);

        return (string) ($result['classification'] ?? 'neutral');
    }

    public function isUnproductiveUsageTool(?string $toolName, ?string $url = null): bool
    {
        return $this->classifyUsage($toolName, $url) === 'unproductive';
    }

    public function normalizeUsageToolName(?string $toolName, ?string $url = null, string $activityType = 'app'): string
    {
        $candidate = trim((string) ($url ?: $toolName));

        return $this->canonicalizeToolLabel($candidate, strtolower(trim($activityType)) ?: 'app');
    }

    public function mergeUsageIntervals(iterable $intervals): Collection
    {
        return $this->mergeIntervals(collect($intervals)->values(), false);
    }

    public function calculateWebAppUsageUnproductiveDuration(iterable $logs): array
    {
        $normalizedLogs = $this->normalizeUsageLogs($logs);
        $focusedUnproductiveLogs = $normalizedLogs
            ->reject(fn (array $row) => $row['type'] === 'idle')
            ->map(function (array $row) {
                $row['classification'] = $this->classifyUsage(
                    (string) ($row['label'] ?? ''),
                    (string) ($row['raw_name'] ?? ''),
                    (string) ($row['type'] ?? 'app'),
                );

                return $row;
            })
            ->filter(fn (array $row) => ($row['classification'] ?? 'neutral') === 'unproductive')
            ->values();

        return [
            'total_duration' => (int) $focusedUnproductiveLogs->sum('duration'),
            'tools' => $this->aggregateToolRows($focusedUnproductiveLogs)['unproductive'],
            'logs' => $focusedUnproductiveLogs,
        ];
    }

    public function calculateUsageMetrics(iterable $logs, iterable $activityEvents = []): array
    {
        return $this->buildUsageSummary($logs, $activityEvents)['metrics'];
    }

    public function calculateIdleTime(iterable $logs, iterable $activityEvents = []): int
    {
        return (int) data_get(
            $this->buildUsageSummary($logs, $activityEvents),
            'metrics.idle_time',
            0
        );
    }

    public function buildUsageSummary(iterable $logs, iterable $activityEvents = []): array
    {
        $normalizedLogs = $this->normalizeUsageLogs($logs);
        $idleResult = $this->detectAndFilterIdleTime($normalizedLogs, $activityEvents);
        $classifiedActiveLogs = $idleResult['active_logs']->map(function (array $row) {
            $row['classification'] = $this->classifyUsage(
                (string) ($row['label'] ?? ''),
                (string) ($row['raw_name'] ?? ''),
                (string) ($row['type'] ?? 'app'),
            );

            if (($row['type'] ?? 'app') === 'app' && ($row['classification'] ?? 'neutral') === 'neutral') {
                $row['classification'] = 'productive';
            }

            return $row;
        })->values();

        $productiveTime = (int) $classifiedActiveLogs->where('classification', 'productive')->sum('duration');
        $unproductiveTime = (int) $classifiedActiveLogs->where('classification', 'unproductive')->sum('duration');
        $neutralTime = (int) $classifiedActiveLogs->where('classification', 'neutral')->sum('duration');
        $contextDependentTime = (int) $classifiedActiveLogs->where('classification', 'context_dependent')->sum('duration');
        $totalTime = $productiveTime + $unproductiveTime + $neutralTime + $contextDependentTime;
        $idleTime = (int) ($idleResult['idle_time'] ?? 0);

        return [
            'metrics' => [
                'total_time' => $totalTime,
                'productive_time' => $productiveTime,
                'unproductive_time' => $unproductiveTime,
                'neutral_time' => $neutralTime,
                'context_dependent_time' => $contextDependentTime,
                'idle_time' => $idleTime,
                'productivity_percentage' => $totalTime > 0
                    ? (float) round(($productiveTime / $totalTime) * 100, 2)
                    : 0.0,
            ],
            'tools' => $this->aggregateToolRows($classifiedActiveLogs),
            'activity_breakdown' => $idleResult['all_logs']
                ->groupBy('type')
                ->map(function (Collection $group, string $type) {
                    return [
                        'type' => $type,
                        'count' => $group->count(),
                        'total_duration' => (int) $group->sum('duration'),
                    ];
                })
                ->sortBy('type')
                ->values()
                ->all(),
            'processed_logs' => $idleResult['all_logs'],
            'idle_segments_count' => (int) ($idleResult['idle_segments_count'] ?? 0),
            'last_processed_at' => now()->toIso8601String(),
        ];
    }

    public function buildTimelineRows(iterable $logs, iterable $activityEvents = []): Collection
    {
        $normalizedLogs = $this->normalizeUsageLogs($logs);
        $idleResult = $this->detectAndFilterIdleTime($normalizedLogs, $activityEvents);
        $classifiedActiveLogs = $idleResult['active_logs']->map(function (array $row) {
            $row['classification'] = $this->classifyUsage(
                (string) ($row['label'] ?? ''),
                (string) ($row['raw_name'] ?? ''),
                (string) ($row['type'] ?? 'app'),
            );

            if (($row['type'] ?? 'app') === 'app' && ($row['classification'] ?? 'neutral') === 'neutral') {
                $row['classification'] = 'productive';
            }

            return $row;
        })->values();

        $idleRows = $idleResult['idle_logs']->map(function (array $row) {
            $row['classification'] = 'neutral';

            return $row;
        })->values();

        return $classifiedActiveLogs
            ->concat($idleRows)
            ->sortBy([
                ['end_timestamp', 'desc'],
                ['start_timestamp', 'desc'],
                ['id', 'desc'],
            ])
            ->values();
    }

    public function buildWebAppUsageSummary(iterable $logs, iterable $activityEvents = []): array
    {
        $timelineRows = $this->buildTimelineRows($logs, $activityEvents)->values();
        $effectiveClassifiedLogs = $timelineRows
            ->reject(fn (array $row) => ($row['tool_type'] ?? null) === 'idle' || ($row['type'] ?? null) === 'idle')
            ->sortBy([
                ['user_id', 'asc'],
                ['time_entry_id', 'asc'],
                ['start_timestamp', 'asc'],
                ['end_timestamp', 'asc'],
                ['id', 'asc'],
            ])
            ->values();

        $productiveTime = (int) $effectiveClassifiedLogs->where('classification', 'productive')->sum('duration');
        $unproductiveTime = (int) $effectiveClassifiedLogs->where('classification', 'unproductive')->sum('duration');
        $neutralTime = (int) $effectiveClassifiedLogs->where('classification', 'neutral')->sum('duration');
        $contextDependentTime = (int) $effectiveClassifiedLogs->where('classification', 'context_dependent')->sum('duration');
        $totalTime = $productiveTime + $unproductiveTime + $neutralTime + $contextDependentTime;
        $idleRows = $timelineRows->filter(fn (array $row) => ($row['tool_type'] ?? null) === 'idle' || ($row['type'] ?? null) === 'idle')->values();
        $idleTime = (int) $idleRows->sum('duration');

        return [
            'metrics' => [
                'total_time' => $totalTime,
                'productive_time' => $productiveTime,
                'unproductive_time' => $unproductiveTime,
                'neutral_time' => $neutralTime,
                'context_dependent_time' => $contextDependentTime,
                'idle_time' => $idleTime,
                'productivity_percentage' => $totalTime > 0
                    ? (float) round(($productiveTime / $totalTime) * 100, 2)
                    : 0.0,
            ],
            'tools' => $this->aggregateToolRows($effectiveClassifiedLogs),
            'activity_breakdown' => $timelineRows
                ->groupBy('type')
                ->map(function (Collection $group, string $type) {
                    return [
                        'type' => $type,
                        'count' => $group->count(),
                        'total_duration' => (int) $group->sum('duration'),
                    ];
                })
                ->sortBy('type')
                ->values()
                ->all(),
            'processed_logs' => $timelineRows,
            'idle_segments_count' => $idleRows->count(),
            'last_processed_at' => now()->toIso8601String(),
        ];
    }

    public function buildUserRangeSummary(int $userId, iterable $logs, Carbon $startDate, Carbon $endDate, iterable $activityEvents = []): array
    {
        $logsByDay = collect($logs)
            ->map(function ($log) {
                $recordedAt = $this->resolveCarbon(data_get($log, 'recorded_at'));
                if (! $recordedAt) {
                    return null;
                }

                return [
                    'day' => $recordedAt->toDateString(),
                    'log' => $log,
                ];
            })
            ->filter()
            ->groupBy('day')
            ->map(fn (Collection $group) => $group->pluck('log')->values());

        $reports = [];
        foreach ($logsByDay as $day => $dayLogs) {
            $reports[] = $this->buildCachedDailySummary($userId, $day, $dayLogs, $activityEvents);
        }

        return $this->combineUsageSummaries($reports);
    }

    public function buildWebAppUsageUserRangeSummary(int $userId, iterable $logs, Carbon $startDate, Carbon $endDate, iterable $activityEvents = []): array
    {
        $logsByDay = collect($logs)
            ->map(function ($log) {
                $recordedAt = $this->resolveCarbon(data_get($log, 'recorded_at'));
                if (! $recordedAt) {
                    return null;
                }

                return [
                    'day' => $recordedAt->toDateString(),
                    'log' => $log,
                ];
            })
            ->filter()
            ->groupBy('day')
            ->map(fn (Collection $group) => $group->pluck('log')->values());

        $reports = [];
        foreach ($logsByDay as $day => $dayLogs) {
            $reports[] = $this->buildCachedDailySummary($userId, $day, $dayLogs, $activityEvents, 'web-app-usage');
        }

        return $this->combineUsageSummaries($reports);
    }

    public function combineUsageSummaries(iterable $reports): array
    {
        $metrics = [
            'total_time' => 0,
            'productive_time' => 0,
            'unproductive_time' => 0,
            'neutral_time' => 0,
            'context_dependent_time' => 0,
            'idle_time' => 0,
            'productivity_percentage' => 0.0,
        ];
        $toolRows = [];
        $activityRows = [];
        $processedLogs = collect();
        $idleSegmentsCount = 0;
        $lastProcessedAt = null;

        foreach ($reports as $report) {
            $currentMetrics = (array) ($report['metrics'] ?? []);
            $metrics['total_time'] += (int) ($currentMetrics['total_time'] ?? 0);
            $metrics['productive_time'] += (int) ($currentMetrics['productive_time'] ?? 0);
            $metrics['unproductive_time'] += (int) ($currentMetrics['unproductive_time'] ?? 0);
            $metrics['neutral_time'] += (int) ($currentMetrics['neutral_time'] ?? 0);
            $metrics['context_dependent_time'] += (int) ($currentMetrics['context_dependent_time'] ?? 0);
            $metrics['idle_time'] += (int) ($currentMetrics['idle_time'] ?? 0);

            foreach (['productive', 'unproductive', 'neutral', 'context_dependent'] as $classification) {
                foreach ((array) data_get($report, "tools.{$classification}", []) as $toolRow) {
                    $key = strtolower(implode('|', [
                        (string) ($toolRow['classification'] ?? $classification),
                        (string) ($toolRow['type'] ?? 'software'),
                        (string) ($toolRow['label'] ?? 'unknown'),
                    ]));

                    if (! isset($toolRows[$key])) {
                        $toolRows[$key] = [
                            'label' => (string) ($toolRow['label'] ?? 'unknown'),
                            'type' => (string) ($toolRow['type'] ?? 'software'),
                            'classification' => (string) ($toolRow['classification'] ?? $classification),
                            'total_duration' => 0,
                            'total_events' => 0,
                        ];
                    }

                    $toolRows[$key]['total_duration'] += (int) ($toolRow['total_duration'] ?? 0);
                    $toolRows[$key]['total_events'] += (int) ($toolRow['total_events'] ?? 0);
                }
            }

            foreach ((array) ($report['activity_breakdown'] ?? []) as $row) {
                $type = strtolower((string) ($row['type'] ?? 'unknown'));
                if (! isset($activityRows[$type])) {
                    $activityRows[$type] = [
                        'type' => $type,
                        'count' => 0,
                        'total_duration' => 0,
                    ];
                }

                $activityRows[$type]['count'] += (int) ($row['count'] ?? 0);
                $activityRows[$type]['total_duration'] += (int) ($row['total_duration'] ?? 0);
            }

            $processedLogs = $processedLogs->concat(collect($report['processed_logs'] ?? []));
            $idleSegmentsCount += (int) ($report['idle_segments_count'] ?? 0);

            $currentProcessedAt = data_get($report, 'last_processed_at');
            if (is_string($currentProcessedAt) && ($lastProcessedAt === null || $currentProcessedAt > $lastProcessedAt)) {
                $lastProcessedAt = $currentProcessedAt;
            }
        }

        $metrics['productivity_percentage'] = $metrics['total_time'] > 0
            ? (float) round(($metrics['productive_time'] / $metrics['total_time']) * 100, 2)
            : 0.0;

        $toolCollection = collect(array_values($toolRows))->sortByDesc('total_duration')->values();

        return [
            'metrics' => $metrics,
            'tools' => [
                'productive' => $toolCollection->where('classification', 'productive')->values()->all(),
                'unproductive' => $toolCollection->where('classification', 'unproductive')->values()->all(),
                'neutral' => $toolCollection->where('classification', 'neutral')->values()->all(),
                'context_dependent' => $toolCollection->where('classification', 'context_dependent')->values()->all(),
            ],
            'activity_breakdown' => collect(array_values($activityRows))->sortBy('type')->values()->all(),
            'processed_logs' => $processedLogs
                ->sortBy([
                    ['user_id', 'asc'],
                    ['time_entry_id', 'asc'],
                    ['start_timestamp', 'asc'],
                    ['end_timestamp', 'asc'],
                    ['id', 'asc'],
                ])
                ->values(),
            'idle_segments_count' => $idleSegmentsCount,
            'last_processed_at' => $lastProcessedAt,
        ];
    }

    private function buildCachedDailySummary(int $userId, string $day, iterable $logs, iterable $activityEvents = [], string $mode = 'default'): array
    {
        $logsCollection = collect($logs)->values();
        $fingerprint = $this->buildFingerprint($logsCollection);
        $cachePrefix = (string) config('usage_processing.cache.prefix', 'usage-processing');
        $classifierVersion = (string) config('productivity_monitoring.classifier_version', 'unknown');
        $ttl = (int) config('usage_processing.cache.ttl_seconds', 300);
        $cacheKey = implode(':', [$cachePrefix, $mode, $classifierVersion, $userId, $day, $fingerprint]);

        return Cache::remember($cacheKey, $ttl, function () use ($logsCollection, $activityEvents, $mode) {
            if ($mode === 'web-app-usage') {
                return $this->buildWebAppUsageSummary($logsCollection, $activityEvents);
            }

            return $this->buildUsageSummary($logsCollection, $activityEvents);
        });
    }

    private function buildFingerprint(Collection $logs): string
    {
        $count = $logs->count();
        $maxId = (int) $logs->max(fn ($log) => (int) data_get($log, 'id', 0));
        $maxRecordedAt = $logs->map(fn ($log) => $this->resolveCarbon(data_get($log, 'recorded_at'))?->getTimestamp() ?? 0)->max() ?? 0;
        $maxUpdatedAt = $logs->map(fn ($log) => $this->resolveCarbon(data_get($log, 'updated_at'))?->getTimestamp() ?? 0)->max() ?? 0;
        $totalDuration = (int) $logs->sum(fn ($log) => max(0, (int) data_get($log, 'duration', 0)));

        return md5(implode('|', [$count, $maxId, $maxRecordedAt, $maxUpdatedAt, $totalDuration]));
    }

    private function buildWebAppUsageUnproductiveLogs(Collection $focusedUnproductiveLogs, Collection $idleLogs): Collection
    {
        $idleAttributedLogs = $idleLogs
            ->map(fn (array $idleLog) => $this->buildIdleAttributedUnproductiveLog($idleLog))
            ->filter()
            ->values();

        $combined = $focusedUnproductiveLogs
            ->concat($idleAttributedLogs)
            ->values();

        if ($combined->isEmpty()) {
            return collect();
        }

        return $this->resolveCrossToolOverlaps(
            $this->mergeIntervals($combined, false)
        )->map(function (array $row) {
            $row['classification'] = 'unproductive';

            return $row;
        })->values();
    }

    private function buildIdleAttributedUnproductiveLog(array $idleLog): ?array
    {
        $contextName = $this->extractIdleContextName((string) ($idleLog['raw_name'] ?? ''));
        if ($contextName === '') {
            return null;
        }

        $descriptor = $this->describeTool($contextName, 'url');
        if (($descriptor['classification'] ?? 'neutral') !== 'unproductive') {
            return null;
        }

        return [
            'id' => (int) ($idleLog['id'] ?? 0),
            'user_id' => (int) ($idleLog['user_id'] ?? 0),
            'time_entry_id' => (int) ($idleLog['time_entry_id'] ?? 0),
            'type' => 'url',
            'raw_name' => $contextName,
            'label' => (string) ($descriptor['label'] ?? 'unknown-site'),
            'tool_type' => (string) ($descriptor['type'] ?? 'website'),
            'start_at' => $idleLog['start_at'] instanceof Carbon ? $idleLog['start_at']->copy() : Carbon::createFromTimestamp((int) ($idleLog['start_timestamp'] ?? 0)),
            'end_at' => $idleLog['end_at'] instanceof Carbon ? $idleLog['end_at']->copy() : Carbon::createFromTimestamp((int) ($idleLog['end_timestamp'] ?? 0)),
            'start_timestamp' => (int) ($idleLog['start_timestamp'] ?? 0),
            'end_timestamp' => (int) ($idleLog['end_timestamp'] ?? 0),
            'duration' => (int) ($idleLog['duration'] ?? 0),
            'recorded_at' => $idleLog['recorded_at'] instanceof Carbon ? $idleLog['recorded_at']->copy() : Carbon::createFromTimestamp((int) ($idleLog['end_timestamp'] ?? 0)),
            'raw_events_count' => (int) ($idleLog['raw_events_count'] ?? 1),
            'source_ids' => (array) ($idleLog['source_ids'] ?? []),
            'source_recorded_timestamps' => (array) ($idleLog['source_recorded_timestamps'] ?? []),
            'classification' => 'unproductive',
        ];
    }

    private function extractIdleContextName(string $idleName): string
    {
        return trim((string) preg_replace('/^system idle\s*-\s*/iu', '', trim($idleName)));
    }

    private function toNormalizedRow(mixed $log): ?array
    {
        $type = strtolower(trim((string) data_get($log, 'type', 'app')));
        if (! in_array($type, ['app', 'url', 'idle'], true)) {
            return null;
        }

        $recordedAt = $this->resolveCarbon(data_get($log, 'recorded_at'));
        if (! $recordedAt) {
            return null;
        }

        $duration = max(0, (int) data_get($log, 'duration', 0));
        $duration = min($duration, (int) config('usage_processing.normalization.max_log_duration_seconds', 14400));
        if ($duration < (int) config('usage_processing.normalization.noise_threshold_seconds', 2)) {
            return null;
        }

        $startAt = $recordedAt->copy()->subSeconds($duration);
        if ($startAt->greaterThanOrEqualTo($recordedAt)) {
            return null;
        }

        $rawName = trim((string) data_get($log, 'name', ''));
        $rawUrl = trim((string) data_get($log, 'url', ''));
        $softwareName = trim((string) data_get($log, 'software_name', ''));
        $normalizedDomain = trim((string) data_get($log, 'normalized_domain', ''));
        $candidateToolType = $type === 'idle'
            ? 'idle'
            : (string) data_get($log, 'tool_type', $this->resolveToolType($type, $rawUrl !== '' ? $rawUrl : $rawName, ''));
        $label = $type === 'idle'
            ? 'idle'
            : (string) (
                data_get($log, 'normalized_label')
                ?: ($candidateToolType === 'website'
                    ? ($normalizedDomain !== '' ? $normalizedDomain : $this->canonicalizeToolLabel($rawUrl !== '' ? $rawUrl : $rawName, 'url'))
                    : ($softwareName !== '' ? $softwareName : $this->canonicalizeToolLabel($rawName, 'app')))
            );
        if ($type !== 'idle' && $this->isNoiseLabel($label, $rawName)) {
            return null;
        }

        return [
            'id' => (int) data_get($log, 'id', 0),
            'user_id' => (int) data_get($log, 'user_id', 0),
            'time_entry_id' => (int) data_get($log, 'time_entry_id', 0),
            'type' => $type,
            'raw_name' => $rawName,
            'label' => $label,
            'tool_type' => $candidateToolType === 'website' && $label !== ''
                ? 'website'
                : ($type === 'idle'
                    ? 'idle'
                    : (string) data_get($log, 'tool_type', $this->resolveToolType($type, $rawUrl !== '' ? $rawUrl : $rawName, $label))),
            'classification' => $type === 'idle'
                ? 'neutral'
                : (string) data_get($log, 'classification', $this->classifyUsage($label, $rawUrl !== '' ? $rawUrl : $rawName, $type)),
            'classification_reason' => (string) data_get($log, 'classification_reason', ''),
            'start_at' => $startAt,
            'end_at' => $recordedAt,
            'start_timestamp' => $startAt->getTimestamp(),
            'end_timestamp' => $recordedAt->getTimestamp(),
            'duration' => $startAt->diffInSeconds($recordedAt),
            'recorded_at' => $recordedAt,
            'raw_events_count' => 1,
            'source_ids' => array_filter([(int) data_get($log, 'id', 0)]),
            'source_recorded_timestamps' => [$recordedAt->getTimestamp()],
        ];
    }

    private function mergeIntervals(
        Collection $rows,
        bool $mergeDuplicatesOnly,
        ?callable $partitionBy = null,
    ): Collection {
        if ($rows->isEmpty()) {
            return collect();
        }

        $partitionBy ??= fn (array $row) => implode('|', [
            (int) ($row['user_id'] ?? 0),
            (int) ($row['time_entry_id'] ?? 0),
            (string) ($row['type'] ?? 'app'),
            strtolower((string) ($row['label'] ?? 'unknown')),
        ]);

        $mergeGap = (int) config('usage_processing.normalization.merge_gap_seconds', 5);

        return $rows
            ->groupBy(fn (array $row) => (string) $partitionBy($row))
            ->flatMap(function (Collection $group) use ($mergeDuplicatesOnly, $mergeGap) {
                $sorted = $group
                    ->sortBy(fn (array $row) => [
                        (int) ($row['start_timestamp'] ?? 0),
                        (int) ($row['end_timestamp'] ?? 0),
                        $row['recorded_at'] instanceof Carbon ? $row['recorded_at']->getTimestamp() : 0,
                        (int) ($row['id'] ?? 0),
                    ])
                    ->values();

                $merged = [];
                foreach ($sorted as $row) {
                    if ($merged === []) {
                        $merged[] = $row;
                        continue;
                    }

                    $lastIndex = count($merged) - 1;
                    $last = $merged[$lastIndex];
                    $gap = (int) $row['start_timestamp'] - (int) $last['end_timestamp'];
                    $overlapsOrTouches = $gap <= $mergeGap;

                    if (! $overlapsOrTouches) {
                        $merged[] = $row;
                        continue;
                    }

                    $isDuplicate = $this->isLikelyDuplicate($last, $row, $mergeGap);
                    if ($isDuplicate) {
                        $merged[$lastIndex] = $this->preferWiderInterval($last, $row);
                        continue;
                    }

                    if ($mergeDuplicatesOnly) {
                        $merged[] = $row;
                        continue;
                    }

                    $merged[$lastIndex] = $this->mergeRows($last, $row);
                }

                return collect($merged);
            })
            ->values();
    }

    private function resolveCrossToolOverlaps(Collection $rows): Collection
    {
        if ($rows->isEmpty()) {
            return collect();
        }

        $mergedRows = [];
        foreach ($rows->groupBy(fn (array $row) => (int) ($row['user_id'] ?? 0)) as $userRows) {
            $boundaries = $userRows
                ->flatMap(fn (array $row) => [(int) $row['start_timestamp'], (int) $row['end_timestamp']])
                ->unique()
                ->sort()
                ->values();

            $segments = [];
            for ($index = 0; $index < $boundaries->count() - 1; $index++) {
                $segmentStart = (int) $boundaries[$index];
                $segmentEnd = (int) $boundaries[$index + 1];
                if ($segmentEnd <= $segmentStart) {
                    continue;
                }

                $coveringRows = $userRows
                    ->filter(fn (array $row) => (int) $row['start_timestamp'] < $segmentEnd && (int) $row['end_timestamp'] > $segmentStart)
                    ->values();

                if ($coveringRows->isEmpty()) {
                    continue;
                }

                $winner = $coveringRows
                    ->sort(fn (array $left, array $right) => $this->compareRowsForPriority($right, $left))
                    ->first();

                if (! $winner) {
                    continue;
                }

                $segments[] = [
                    'id' => (int) ($winner['id'] ?? 0),
                    'user_id' => (int) ($winner['user_id'] ?? 0),
                    'time_entry_id' => (int) ($winner['time_entry_id'] ?? 0),
                    'type' => (string) ($winner['type'] ?? 'app'),
                    'raw_name' => (string) ($winner['raw_name'] ?? ''),
                    'label' => (string) ($winner['label'] ?? 'unknown'),
                    'tool_type' => (string) ($winner['tool_type'] ?? 'software'),
                    'start_at' => Carbon::createFromTimestamp($segmentStart),
                    'end_at' => Carbon::createFromTimestamp($segmentEnd),
                    'start_timestamp' => $segmentStart,
                    'end_timestamp' => $segmentEnd,
                    'duration' => $segmentEnd - $segmentStart,
                    'recorded_at' => $winner['recorded_at'] instanceof Carbon ? $winner['recorded_at']->copy() : Carbon::createFromTimestamp((int) ($winner['end_timestamp'] ?? $segmentEnd)),
                    'raw_events_count' => (int) ($winner['raw_events_count'] ?? 1),
                    'source_ids' => (array) ($winner['source_ids'] ?? []),
                    'source_recorded_timestamps' => (array) ($winner['source_recorded_timestamps'] ?? []),
                ];
            }

            $mergedRows = array_merge($mergedRows, $this->mergeAdjacentSegments(collect($segments))->all());
        }

        return collect($mergedRows)->values();
    }

    private function mergeAdjacentSegments(Collection $rows): Collection
    {
        if ($rows->isEmpty()) {
            return collect();
        }

        $mergeGap = (int) config('usage_processing.normalization.merge_gap_seconds', 5);

        return $rows
            ->groupBy(fn (array $row) => implode('|', [
                (int) ($row['user_id'] ?? 0),
                (int) ($row['time_entry_id'] ?? 0),
                (string) ($row['type'] ?? 'app'),
                strtolower((string) ($row['label'] ?? 'unknown')),
            ]))
            ->flatMap(function (Collection $group) use ($mergeGap) {
                $sorted = $group->sortBy([
                    ['start_timestamp', 'asc'],
                    ['end_timestamp', 'asc'],
                    ['id', 'asc'],
                ])->values();

                $merged = [];
                foreach ($sorted as $row) {
                    if ($merged === []) {
                        $merged[] = $row;
                        continue;
                    }

                    $lastIndex = count($merged) - 1;
                    $last = $merged[$lastIndex];
                    $gap = (int) $row['start_timestamp'] - (int) $last['end_timestamp'];

                    if ($gap <= $mergeGap) {
                        $merged[$lastIndex] = $this->mergeRows($last, $row);
                        continue;
                    }

                    $merged[] = $row;
                }

                return collect($merged);
            })
            ->values();
    }

    private function subtractIdleFromActiveLogs(Collection $activeLogs, Collection $idleLogs): Collection
    {
        if ($activeLogs->isEmpty() || $idleLogs->isEmpty()) {
            return $activeLogs->values();
        }

        $rows = [];
        foreach ($activeLogs as $activeLog) {
            $segments = [[
                'start' => (int) ($activeLog['start_timestamp'] ?? 0),
                'end' => (int) ($activeLog['end_timestamp'] ?? 0),
            ]];

            $overlappingIdleLogs = $idleLogs
                ->filter(fn (array $idleLog) => (int) ($idleLog['user_id'] ?? 0) === (int) ($activeLog['user_id'] ?? 0))
                ->filter(fn (array $idleLog) => (int) ($idleLog['start_timestamp'] ?? 0) < (int) ($activeLog['end_timestamp'] ?? 0) && (int) ($idleLog['end_timestamp'] ?? 0) > (int) ($activeLog['start_timestamp'] ?? 0))
                ->values();

            foreach ($overlappingIdleLogs as $idleLog) {
                $nextSegments = [];
                foreach ($segments as $segment) {
                    $idleStart = max($segment['start'], (int) ($idleLog['start_timestamp'] ?? 0));
                    $idleEnd = min($segment['end'], (int) ($idleLog['end_timestamp'] ?? 0));

                    if ($idleEnd <= $idleStart) {
                        $nextSegments[] = $segment;
                        continue;
                    }

                    if ($segment['start'] < $idleStart) {
                        $nextSegments[] = [
                            'start' => $segment['start'],
                            'end' => $idleStart,
                        ];
                    }

                    if ($idleEnd < $segment['end']) {
                        $nextSegments[] = [
                            'start' => $idleEnd,
                            'end' => $segment['end'],
                        ];
                    }
                }

                $segments = $nextSegments;
            }

            foreach ($segments as $segment) {
                if ($segment['end'] <= $segment['start']) {
                    continue;
                }

                $rows[] = [
                    'id' => (int) ($activeLog['id'] ?? 0),
                    'user_id' => (int) ($activeLog['user_id'] ?? 0),
                    'time_entry_id' => (int) ($activeLog['time_entry_id'] ?? 0),
                    'type' => (string) ($activeLog['type'] ?? 'app'),
                    'raw_name' => (string) ($activeLog['raw_name'] ?? ''),
                    'label' => (string) ($activeLog['label'] ?? 'unknown'),
                    'tool_type' => (string) ($activeLog['tool_type'] ?? 'software'),
                    'start_at' => Carbon::createFromTimestamp($segment['start']),
                    'end_at' => Carbon::createFromTimestamp($segment['end']),
                    'start_timestamp' => $segment['start'],
                    'end_timestamp' => $segment['end'],
                    'duration' => $segment['end'] - $segment['start'],
                    'recorded_at' => $activeLog['recorded_at'] instanceof Carbon ? $activeLog['recorded_at']->copy() : Carbon::createFromTimestamp((int) ($activeLog['end_timestamp'] ?? $segment['end'])),
                    'raw_events_count' => (int) ($activeLog['raw_events_count'] ?? 1),
                    'source_ids' => (array) ($activeLog['source_ids'] ?? []),
                    'source_recorded_timestamps' => (array) ($activeLog['source_recorded_timestamps'] ?? []),
                ];
            }
        }

        return $this->mergeAdjacentSegments(collect($rows));
    }

    private function inferIdleIntervals(Collection $activeLogs, iterable $activityEvents): Collection
    {
        $activityEventCollection = collect($activityEvents)
            ->map(fn ($event) => $this->resolveCarbon(data_get($event, 'recorded_at', data_get($event, 'at'))))
            ->filter()
            ->sortBy(fn (Carbon $timestamp) => $timestamp->getTimestamp())
            ->values();

        if ($activityEventCollection->isNotEmpty()) {
            return $this->inferIdleFromActivityEvents($activeLogs, $activityEventCollection);
        }

        return $this->inferIdleFromSourceSilence($activeLogs);
    }

    private function inferIdleFromActivityEvents(Collection $activeLogs, Collection $activityEvents): Collection
    {
        $threshold = $this->resolveIdleThresholdSeconds();
        $rows = [];

        foreach ($activeLogs as $activeLog) {
            $activityTimes = $activityEvents
                ->filter(fn (Carbon $timestamp) => $timestamp->getTimestamp() >= (int) ($activeLog['start_timestamp'] ?? 0) && $timestamp->getTimestamp() <= (int) ($activeLog['end_timestamp'] ?? 0))
                ->values();

            if ($activityTimes->count() < 2) {
                continue;
            }

            for ($index = 0; $index < $activityTimes->count() - 1; $index++) {
                $left = $activityTimes[$index];
                $right = $activityTimes[$index + 1];
                $delta = $right->getTimestamp() - $left->getTimestamp();

                if ($delta <= $threshold) {
                    continue;
                }

                $idleStart = $left->copy()->addSeconds($threshold);
                $idleEnd = $right->copy();
                if ($idleEnd->lessThanOrEqualTo($idleStart)) {
                    continue;
                }

                $rows[] = $this->makeIdleRowFromRange($activeLog, $idleStart->getTimestamp(), $idleEnd->getTimestamp());
            }
        }

        return collect($rows)->filter()->values();
    }

    private function resolveIdleThresholdSeconds(): int
    {
        $legacyThreshold = (int) config('usage_processing.normalization.idle_threshold_seconds', 180);
        $trackingThreshold = (int) config('time_tracking.idle_track_threshold_seconds', $legacyThreshold);

        return max(30, $trackingThreshold);
    }

    private function inferIdleFromSourceSilence(Collection $activeLogs): Collection
    {
        $threshold = $this->resolveIdleThresholdSeconds();
        $rows = [];

        foreach ($activeLogs as $activeLog) {
            $timestamps = collect((array) ($activeLog['source_recorded_timestamps'] ?? []))
                ->map(fn ($timestamp) => (int) $timestamp)
                ->filter(fn ($timestamp) => $timestamp > 0)
                ->unique()
                ->sort()
                ->values();

            if ($timestamps->count() < 2) {
                continue;
            }

            for ($index = 0; $index < $timestamps->count() - 1; $index++) {
                $left = (int) $timestamps[$index];
                $right = (int) $timestamps[$index + 1];
                if (($right - $left) <= $threshold) {
                    continue;
                }

                $idleStart = max((int) ($activeLog['start_timestamp'] ?? 0), $left + $threshold);
                $idleEnd = min((int) ($activeLog['end_timestamp'] ?? 0), $right);
                if ($idleEnd <= $idleStart) {
                    continue;
                }

                $rows[] = $this->makeIdleRowFromRange($activeLog, $idleStart, $idleEnd);
            }
        }

        return collect($rows)->filter()->values();
    }

    private function makeIdleRowFromRange(array $sourceRow, int $startTimestamp, int $endTimestamp): ?array
    {
        if ($endTimestamp <= $startTimestamp) {
            return null;
        }

        return [
            'id' => (int) ($sourceRow['id'] ?? 0),
            'user_id' => (int) ($sourceRow['user_id'] ?? 0),
            'time_entry_id' => (int) ($sourceRow['time_entry_id'] ?? 0),
            'type' => 'idle',
            'raw_name' => 'Inferred Idle',
            'label' => 'idle',
            'tool_type' => 'idle',
            'start_at' => Carbon::createFromTimestamp($startTimestamp),
            'end_at' => Carbon::createFromTimestamp($endTimestamp),
            'start_timestamp' => $startTimestamp,
            'end_timestamp' => $endTimestamp,
            'duration' => $endTimestamp - $startTimestamp,
            'recorded_at' => Carbon::createFromTimestamp($endTimestamp),
            'raw_events_count' => 1,
            'source_ids' => (array) ($sourceRow['source_ids'] ?? []),
            'source_recorded_timestamps' => [],
        ];
    }

    private function aggregateToolRows(Collection $rows): array
    {
        $tools = $rows
            ->groupBy(fn (array $row) => strtolower(implode('|', [
                (string) ($row['classification'] ?? 'neutral'),
                (string) ($row['tool_type'] ?? 'software'),
                (string) ($row['label'] ?? 'unknown'),
            ])))
            ->map(function (Collection $group) {
                $first = $group->first();

                return [
                    'label' => (string) ($first['label'] ?? 'unknown'),
                    'type' => (string) ($first['tool_type'] ?? 'software'),
                    'classification' => (string) ($first['classification'] ?? 'neutral'),
                    'total_duration' => (int) $group->sum('duration'),
                    'total_events' => (int) $group->sum(fn (array $row) => max(1, (int) ($row['raw_events_count'] ?? 1))),
                ];
            })
            ->sortByDesc('total_duration')
            ->values();

        return [
            'productive' => $tools->where('classification', 'productive')->values()->all(),
            'unproductive' => $tools->where('classification', 'unproductive')->values()->all(),
            'neutral' => $tools->where('classification', 'neutral')->values()->all(),
            'context_dependent' => $tools->where('classification', 'context_dependent')->values()->all(),
        ];
    }

    private function resolveToolType(string $activityType, string $rawName, string $label): string
    {
        $normalizedType = strtolower(trim($activityType));
        if ($normalizedType === 'idle') {
            return 'idle';
        }

        $normalizedRaw = strtolower(trim($rawName));
        $normalizedLabel = strtolower(trim($label));
        $browserKeywords = [
            'google chrome',
            'chrome',
            'microsoft edge',
            'edge',
            'mozilla firefox',
            'firefox',
            'brave',
            'opera',
            'safari',
            'vivaldi',
        ];

        $isBrowserContext = collect($browserKeywords)->contains(
            fn (string $keyword) => $normalizedRaw !== '' && str_contains($normalizedRaw, $keyword)
        );
        $isBrowserLabel = collect($browserKeywords)->contains(
            fn (string $keyword) => $normalizedLabel === $keyword
        );
        $looksLikeWebsite = (bool) preg_match('/([a-z0-9-]+\.)+[a-z]{2,}$/i', $normalizedLabel);

        if ($normalizedType === 'url') {
            if (! $isBrowserContext && ! $looksLikeWebsite) {
                return $this->activityProductivityService->guessToolType('app');
            }

            return 'website';
        }

        if ($looksLikeWebsite || ($isBrowserContext && $normalizedLabel !== '' && ! $isBrowserLabel)) {
            return 'website';
        }

        return $this->activityProductivityService->guessToolType($normalizedType);
    }

    private function canonicalizeToolLabel(string $tool, string $activityType): string
    {
        $baseLabel = strtolower(trim($this->activityProductivityService->normalizeToolLabel($tool, $activityType)));
        if ($baseLabel === '') {
            return $activityType === 'url' ? 'unknown-site' : 'unknown-app';
        }

        $candidates = [$baseLabel, strtolower(trim($tool))];
        foreach ((array) config('usage_processing.canonical_labels', []) as $canonicalLabel => $patterns) {
            foreach ((array) $patterns as $pattern) {
                $normalizedPattern = strtolower(trim((string) $pattern));
                if ($normalizedPattern === '') {
                    continue;
                }

                foreach ($candidates as $candidate) {
                    if ($candidate !== '' && str_contains($candidate, $normalizedPattern)) {
                        return strtolower(trim((string) $canonicalLabel));
                    }
                }
            }
        }

        return $baseLabel;
    }

    private function isNoiseLabel(string $label, string $rawName): bool
    {
        $patterns = [
            '/^file\s*\(\d+\s*[x×]\s*\d+\)$/iu',
            '/^screenshot\s*\(\d+\s*[x×]\s*\d+\)$/iu',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $label) || preg_match($pattern, strtolower($rawName))) {
                return true;
            }
        }

        return false;
    }

    private function isLikelyDuplicate(array $left, array $right, int $mergeGap): bool
    {
        $leftStart = (int) ($left['start_timestamp'] ?? 0);
        $leftEnd = (int) ($left['end_timestamp'] ?? 0);
        $rightStart = (int) ($right['start_timestamp'] ?? 0);
        $rightEnd = (int) ($right['end_timestamp'] ?? 0);

        if (($leftStart <= $rightStart && $leftEnd >= $rightEnd) || ($rightStart <= $leftStart && $rightEnd >= $leftEnd)) {
            return true;
        }

        $overlapStart = max($leftStart, $rightStart);
        $overlapEnd = min($leftEnd, $rightEnd);
        $overlap = max(0, $overlapEnd - $overlapStart);
        $smallerDuration = min(max(1, $leftEnd - $leftStart), max(1, $rightEnd - $rightStart));
        $overlapRatio = $overlap / $smallerDuration;

        return $overlapRatio >= 0.9 && abs($rightEnd - $leftEnd) <= ($mergeGap * 2);
    }

    private function preferWiderInterval(array $left, array $right): array
    {
        $leftSpan = (int) ($left['end_timestamp'] ?? 0) - (int) ($left['start_timestamp'] ?? 0);
        $rightSpan = (int) ($right['end_timestamp'] ?? 0) - (int) ($right['start_timestamp'] ?? 0);
        $preferred = $rightSpan >= $leftSpan ? $right : $left;
        $other = $preferred === $right ? $left : $right;
        $merged = $this->mergeMetadata($preferred, $other);
        $startTimestamp = (int) ($preferred['start_timestamp'] ?? 0);
        $endTimestamp = (int) ($preferred['end_timestamp'] ?? 0);

        $merged['start_at'] = $preferred['start_at'] instanceof Carbon ? $preferred['start_at']->copy() : Carbon::createFromTimestamp($startTimestamp);
        $merged['end_at'] = $preferred['end_at'] instanceof Carbon ? $preferred['end_at']->copy() : Carbon::createFromTimestamp($endTimestamp);
        $merged['start_timestamp'] = $startTimestamp;
        $merged['end_timestamp'] = $endTimestamp;
        $merged['duration'] = max(0, $endTimestamp - $startTimestamp);

        return $merged;
    }

    private function mergeRows(array $left, array $right): array
    {
        $merged = $this->mergeMetadata($left, $right);
        $startTimestamp = min((int) ($left['start_timestamp'] ?? 0), (int) ($right['start_timestamp'] ?? 0));
        $endTimestamp = max((int) ($left['end_timestamp'] ?? 0), (int) ($right['end_timestamp'] ?? 0));

        $merged['start_at'] = Carbon::createFromTimestamp($startTimestamp);
        $merged['end_at'] = Carbon::createFromTimestamp($endTimestamp);
        $merged['start_timestamp'] = $startTimestamp;
        $merged['end_timestamp'] = $endTimestamp;
        $merged['duration'] = max(0, $endTimestamp - $startTimestamp);

        return $merged;
    }

    private function mergeMetadata(array $primary, array $secondary): array
    {
        $recordedAt = $primary['recorded_at'] instanceof Carbon ? $primary['recorded_at']->copy() : Carbon::createFromTimestamp((int) ($primary['end_timestamp'] ?? 0));
        $secondaryRecordedAt = $secondary['recorded_at'] instanceof Carbon ? $secondary['recorded_at']->copy() : Carbon::createFromTimestamp((int) ($secondary['end_timestamp'] ?? 0));
        if ($secondaryRecordedAt->greaterThan($recordedAt)) {
            $recordedAt = $secondaryRecordedAt;
        }

        return [
            'id' => max((int) ($primary['id'] ?? 0), (int) ($secondary['id'] ?? 0)),
            'user_id' => (int) ($primary['user_id'] ?? 0),
            'time_entry_id' => (int) ($primary['time_entry_id'] ?? 0),
            'type' => (string) ($primary['type'] ?? 'app'),
            'raw_name' => strlen((string) ($secondary['raw_name'] ?? '')) > strlen((string) ($primary['raw_name'] ?? ''))
                ? (string) ($secondary['raw_name'] ?? '')
                : (string) ($primary['raw_name'] ?? ''),
            'label' => (string) ($primary['label'] ?? 'unknown'),
            'tool_type' => (string) ($primary['tool_type'] ?? 'software'),
            'recorded_at' => $recordedAt,
            'raw_events_count' => (int) ($primary['raw_events_count'] ?? 1) + (int) ($secondary['raw_events_count'] ?? 1),
            'source_ids' => array_values(array_unique(array_merge(
                array_map('intval', (array) ($primary['source_ids'] ?? [])),
                array_map('intval', (array) ($secondary['source_ids'] ?? []))
            ))),
            'source_recorded_timestamps' => array_values(array_unique(array_merge(
                array_map('intval', (array) ($primary['source_recorded_timestamps'] ?? [])),
                array_map('intval', (array) ($secondary['source_recorded_timestamps'] ?? []))
            ))),
        ];
    }

    private function compareRowsForPriority(array $left, array $right): int
    {
        return [
            $left['recorded_at'] instanceof Carbon ? $left['recorded_at']->getTimestamp() : 0,
            (int) ($left['start_timestamp'] ?? 0),
            (int) ($left['end_timestamp'] ?? 0),
            (int) ($left['id'] ?? 0),
        ] <=> [
            $right['recorded_at'] instanceof Carbon ? $right['recorded_at']->getTimestamp() : 0,
            (int) ($right['start_timestamp'] ?? 0),
            (int) ($right['end_timestamp'] ?? 0),
            (int) ($right['id'] ?? 0),
        ];
    }

    private function resolveCarbon(mixed $value): ?Carbon
    {
        if ($value instanceof Carbon) {
            return $value->copy();
        }

        if (is_string($value) && trim($value) !== '') {
            return Carbon::parse($value);
        }

        return null;
    }
}
