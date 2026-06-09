<?php

namespace App\Services\Reports;

use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Enhanced Idle Validation Service
 * 
 * Provides stricter idle time validation for large-scale deployments (200+ users).
 * Automatically detects and corrects suspicious idle patterns.
 */
class IdleValidationService
{
    /**
     * Maximum allowed idle ratio (95% - ensures at least 5% working time)
     * This prevents cases where desktop app reports 100% idle due to lock screen
     */
    private const MAX_IDLE_RATIO = 0.95;
    
    /**
     * Minimum tracked time before validation applies (5 minutes)
     * Prevents false positives for very short tracking sessions
     */
    private const MIN_TRACKED_SECONDS = 300;
    
    /**
     * Suspicious idle threshold (90% - triggers investigation)
     */
    private const SUSPICIOUS_IDLE_RATIO = 0.90;
    
    /**
     * Cache TTL for suspicious user detection (5 minutes)
     */
    private const CACHE_TTL_MINUTES = 5;

    /**
     * Validate and correct idle time for a user
     * 
     * @param int $userId User ID
     * @param int $trackedDuration Total tracked time in seconds
     * @param int $idleDuration Reported idle time in seconds
     * @param int $activityDuration Total activity duration from logs
     * @param array $context Additional context (source, timestamp, etc.)
     * @return array Validated idle data with corrections
     */
    public function validateIdleTime(
        int $userId,
        int $trackedDuration,
        int $idleDuration,
        int $activityDuration = 0,
        array $context = []
    ): array {
        $trackedDuration = max(0, $trackedDuration);
        $idleDuration = max(0, $idleDuration);
        
        // Don't validate very short sessions
        if ($trackedDuration < self::MIN_TRACKED_SECONDS) {
            return [
                'idle_duration' => $idleDuration,
                'working_duration' => max(0, $trackedDuration - $idleDuration),
                'corrected' => false,
                'reason' => 'Session too short for validation',
                'original_idle' => $idleDuration,
            ];
        }
        
        $idleRatio = $trackedDuration > 0 ? $idleDuration / $trackedDuration : 0;
        $corrections = [];
        
        // Check 1: Cap idle at maximum ratio
        if ($idleRatio > self::MAX_IDLE_RATIO) {
            $originalIdle = $idleDuration;
            $idleDuration = (int) ($trackedDuration * self::MAX_IDLE_RATIO);
            $corrections[] = sprintf(
                'Idle capped from %ds to %ds (%.1f%% of tracked)',
                $originalIdle,
                $idleDuration,
                self::MAX_IDLE_RATIO * 100
            );
        }
        
        // Check 2: If idle equals tracked but activity exists, reduce idle
        if ($idleDuration >= $trackedDuration && $activityDuration > 0) {
            $originalIdle = $idleDuration;
            // Assume at least 5% working time if there's any activity
            $idleDuration = (int) ($trackedDuration * self::MAX_IDLE_RATIO);
            $corrections[] = sprintf(
                'Idle reduced from %ds to %ds due to activity presence (activity_duration=%ds)',
                $originalIdle,
                $idleDuration,
                $activityDuration
            );
        }
        
        // Check 3: Detect lock screen idle pattern
        if ($this->isLockScreenPattern($userId, $trackedDuration, $idleDuration, $context)) {
            $originalIdle = $idleDuration;
            $idleDuration = (int) ($trackedDuration * self::MAX_IDLE_RATIO);
            $corrections[] = sprintf(
                'Idle capped from %ds to %ds (lock screen pattern detected)',
                $originalIdle,
                $idleDuration
            );
            $this->flagSuspiciousUser($userId, 'lock_screen_pattern', $context);
        }
        
        // Check 4: Validate against historical patterns
        $historicalCheck = $this->validateAgainstHistory($userId, $trackedDuration, $idleDuration);
        if ($historicalCheck['corrected']) {
            $idleDuration = $historicalCheck['idle_duration'];
            $corrections[] = $historicalCheck['reason'];
        }
        
        // Calculate working duration
        $workingDuration = max(0, $trackedDuration - $idleDuration);
        
        // Log corrections for monitoring
        if (!empty($corrections)) {
            Log::warning('Idle time corrected', [
                'user_id' => $userId,
                'tracked' => $trackedDuration,
                'original_idle' => $context['original_idle'] ?? $idleDuration,
                'corrected_idle' => $idleDuration,
                'working' => $workingDuration,
                'corrections' => $corrections,
                'source' => $context['source'] ?? 'unknown',
            ]);
        }
        
        return [
            'idle_duration' => $idleDuration,
            'working_duration' => $workingDuration,
            'corrected' => !empty($corrections),
            'reason' => implode('; ', $corrections) ?: 'No corrections needed',
            'original_idle' => $context['original_idle'] ?? $idleDuration,
            'idle_ratio' => $trackedDuration > 0 ? round($idleDuration / $trackedDuration, 2) : 0,
        ];
    }
    
    /**
     * Check if this appears to be a lock screen idle pattern
     */
    private function isLockScreenPattern(int $userId, int $trackedDuration, int $idleDuration, array $context): bool
    {
        // If idle is 100% of tracked time, likely lock screen
        if ($trackedDuration > 0 && $idleDuration >= $trackedDuration) {
            // Check if there was any recent non-idle activity
            $hasRecentActivity = $this->checkRecentNonIdleActivity($userId, $context);
            
            if ($hasRecentActivity) {
                // User had activity recently but now showing 100% idle
                // This is suspicious - likely lock screen
                return true;
            }
        }
        
        return false;
    }
    
    /**
     * Check for recent non-idle activity
     */
    private function checkRecentNonIdleActivity(int $userId, array $context): bool
    {
        $timeRange = $context['start_date'] ?? Carbon::now()->subDay()->toDateTimeString();
        $endRange = $context['end_date'] ?? Carbon::now()->toDateTimeString();
        
        try {
            $count = DB::table('activities')
                ->where('user_id', $userId)
                ->where('type', '!=', 'idle')
                ->whereBetween('recorded_at', [$timeRange, $endRange])
                ->limit(1)
                ->count();
                
            return $count > 0;
        } catch (\Exception $e) {
            Log::error('Failed to check recent activity', [
                'user_id' => $userId,
                'error' => $e->getMessage(),
            ]);
            return false;
        }
    }
    
    /**
     * Validate against user's historical idle patterns
     */
    private function validateAgainstHistory(int $userId, int $trackedDuration, int $idleDuration): array
    {
        $cacheKey = "idle_validation.history:{$userId}";
        $historicalData = Cache::get($cacheKey, []);
        
        // If we have enough historical data
        if (count($historicalData) >= 3) {
            $avgIdleRatio = collect($historicalData)->avg('idle_ratio');
            $currentRatio = $trackedDuration > 0 ? $idleDuration / $trackedDuration : 0;
            
            // If current idle is significantly higher than average (2x), it's suspicious
            if ($currentRatio > 0 && $avgIdleRatio > 0 && $currentRatio > ($avgIdleRatio * 2)) {
                // Cap at historical average + 20%
                $maxAllowedIdle = (int) ($trackedDuration * min($avgIdleRatio * 1.2, self::MAX_IDLE_RATIO));
                
                return [
                    'idle_duration' => $maxAllowedIdle,
                    'corrected' => true,
                    'reason' => sprintf(
                        'Idle capped from %ds to %ds (%.1f%% deviation from historical avg %.1f%%)',
                        $idleDuration,
                        $maxAllowedIdle,
                        $currentRatio * 100,
                        $avgIdleRatio * 100
                    ),
                ];
            }
        }
        
        // Store current data for future validation
        $this->updateHistoricalData($userId, $trackedDuration, $idleDuration);
        
        return ['idle_duration' => $idleDuration, 'corrected' => false, 'reason' => 'No historical data'];
    }
    
    /**
     * Update historical idle data for a user
     */
    private function updateHistoricalData(int $userId, int $trackedDuration, int $idleDuration): void
    {
        $cacheKey = "idle_validation.history:{$userId}";
        $data = Cache::get($cacheKey, []);
        
        // Only store reasonable data points (exclude 100% idle sessions)
        $idleRatio = $trackedDuration > 0 ? $idleDuration / $trackedDuration : 0;
        if ($idleRatio < self::SUSPICIOUS_IDLE_RATIO && $trackedDuration >= self::MIN_TRACKED_SECONDS) {
            $data[] = [
                'timestamp' => now()->toIso8601String(),
                'tracked' => $trackedDuration,
                'idle' => $idleDuration,
                'idle_ratio' => $idleRatio,
            ];
            
            // Keep only last 10 entries
            $data = array_slice($data, -10);
            Cache::put($cacheKey, $data, now()->addDays(7));
        }
    }
    
    /**
     * Flag a user as having suspicious idle patterns
     */
    private function flagSuspiciousUser(int $userId, string $pattern, array $context): void
    {
        $cacheKey = "idle_validation.suspicious:{$userId}";
        $flags = Cache::get($cacheKey, []);
        
        $flags[] = [
            'pattern' => $pattern,
            'timestamp' => now()->toIso8601String(),
            'context' => $context,
        ];
        
        // Keep only last 5 flags
        $flags = array_slice($flags, -5);
        Cache::put($cacheKey, $flags, now()->addHours(24));
        
        // Log for admin review
        Log::warning('Suspicious idle pattern detected', [
            'user_id' => $userId,
            'pattern' => $pattern,
            'flags_count' => count($flags),
            'context' => $context,
        ]);
    }
    
    /**
     * Get suspicious users report for admin review
     */
    public function getSuspiciousUsersReport(): array
    {
        // This would be implemented to scan cache keys and return suspicious users
        // For now, just return empty - can be enhanced later
        return [];
    }
    
    /**
     * Bulk validate idle times for multiple users
     * Used for efficiency when processing 200+ users
     */
    public function bulkValidateIdleTimes(
        array $userData,
        Carbon $startDate,
        Carbon $endDate
    ): array {
        $results = [];
        
        // Pre-fetch activity data for all users
        $userIds = collect($userData)->pluck('user_id')->unique()->values()->all();
        
        $activityData = DB::table('activities')
            ->selectRaw('user_id, SUM(duration) as total_duration, COUNT(*) as count')
            ->whereIn('user_id', $userIds)
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->groupBy('user_id')
            ->pluck('total_duration', 'user_id')
            ->all();
            
        foreach ($userData as $data) {
            $userId = $data['user_id'];
            $activityDuration = $activityData[$userId] ?? 0;
            
            $results[$userId] = $this->validateIdleTime(
                $userId,
                $data['tracked_duration'],
                $data['idle_duration'],
                $activityDuration,
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
