<?php

namespace App\Services\Reports;

use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Idle Monitoring Service
 *
 * Logs suspicious idle patterns for admin review without modifying data.
 * All idle time corrections are handled by TimeBreakdownService (pro-rata) alone.
 */
class IdleValidationService
{
    private const SUSPICIOUS_IDLE_RATIO = 0.95;

    public function validateIdleTime(
        int $userId,
        int $trackedDuration,
        int $idleDuration,
        int $nonIdleActivityDuration = 0,
        array $context = []
    ): array {
        $trackedDuration = max(0, $trackedDuration);
        $idleDuration = max(0, $idleDuration);
        $workingDuration = max(0, $trackedDuration - $idleDuration);

        // Log suspicious patterns for monitoring without modifying data
        $idleRatio = $trackedDuration > 0 ? $idleDuration / $trackedDuration : 0;
        if ($idleRatio >= self::SUSPICIOUS_IDLE_RATIO && $trackedDuration >= 300) {
            Log::info('High idle ratio detected (monitoring only)', [
                'user_id' => $userId,
                'tracked' => $trackedDuration,
                'idle' => $idleDuration,
                'idle_ratio' => round($idleRatio, 2),
                'non_idle_activity' => $nonIdleActivityDuration,
                'source' => $context['source'] ?? 'unknown',
            ]);
        }

        return [
            'idle_duration' => $idleDuration,
            'working_duration' => $workingDuration,
            'corrected' => false,
            'reason' => 'No corrections needed',
            'original_idle' => $idleDuration,
            'idle_ratio' => round($idleRatio, 2),
        ];
    }

    public function bulkValidateIdleTimes(
        array $userData,
        Carbon $startDate,
        Carbon $endDate
    ): array {
        $results = [];
        foreach ($userData as $data) {
            $userId = $data['user_id'];
            $results[$userId] = $this->validateIdleTime(
                $userId,
                $data['tracked_duration'],
                $data['idle_duration'],
                $data['non_idle_activity_duration'] ?? 0,
                [
                    'source' => 'bulk_validation',
                    'start_date' => $startDate->toDateTimeString(),
                    'end_date' => $endDate->toDateTimeString(),
                ]
            );
        }
        return $results;
    }
}
