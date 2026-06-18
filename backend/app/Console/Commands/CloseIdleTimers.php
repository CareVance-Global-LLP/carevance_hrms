<?php

namespace App\Console\Commands;

use App\Models\TimeEntry;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CloseIdleTimers extends Command
{
    protected $signature = 'timers:close-idle
        {--dry-run : Preview timers that would be closed without saving}
        {--idle-minutes= : Minutes of inactivity before auto-stop (default: idle_auto_stop_threshold_seconds/60)}';

    protected $description = 'Auto-stop running timers where no non-idle activity was detected for the idle threshold';

    public function handle(): int
    {
        $idleThresholdSeconds = max(60, (int) config('time_tracking.idle_auto_stop_threshold_seconds', 300));
        $idleMinutes = (int) ($this->option('idle-minutes')
            ?: max(1, (int) round($idleThresholdSeconds / 60)));

        $dryRun = (bool) $this->option('dry-run');
        $cutoff = now()->subMinutes($idleMinutes);

        $this->line("Checking running timers idle since before {$cutoff->toIso8601String()} ({$idleMinutes} min threshold)");

        // Get all currently running timers
        $runningTimers = TimeEntry::query()
            ->whereNull('end_time')
            ->where('start_time', '<', $cutoff)
            ->orderBy('start_time')
            ->get(['id', 'user_id', 'start_time']);

        if ($runningTimers->isEmpty()) {
            $this->info('No running timers to check.');
            return 0;
        }

        $this->line("Found {$runningTimers->count()} running timer(s) to evaluate.");

        // Batch-fetch latest non-idle activity time per user
        $userIds = $runningTimers->pluck('user_id')->unique()->values()->all();
        $latestActivityByUser = DB::table('activities')
            ->selectRaw('user_id, MAX(recorded_at) as last_active_at')
            ->whereIn('user_id', $userIds)
            ->where('type', '!=', 'idle')
            ->groupBy('user_id')
            ->pluck('last_active_at', 'user_id')
            ->all();

        // Also batch-fetch latest idle activity per user (for logging)
        $latestIdleByUser = DB::table('activities')
            ->selectRaw('user_id, MAX(recorded_at) as last_idle_at, MAX(duration) as max_idle_duration')
            ->whereIn('user_id', $userIds)
            ->where('type', 'idle')
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        $now = now();
        $closed = 0;

        foreach ($runningTimers as $entry) {
            $lastActiveAt = isset($latestActivityByUser[$entry->user_id])
                ? Carbon::parse($latestActivityByUser[$entry->user_id])
                : Carbon::parse($entry->start_time);

            $idleSeconds = (int) $lastActiveAt->diffInSeconds($now);

            // Skip if there's been recent activity within the threshold
            if ($idleSeconds < $idleThresholdSeconds) {
                continue;
            }

            if ($dryRun) {
                $this->line(sprintf(
                    '[DRY-RUN] Would close entry #%d for user #%d (idle %ds since %s)',
                    $entry->id,
                    $entry->user_id,
                    $idleSeconds,
                    $lastActiveAt->toIso8601String()
                ));
                continue;
            }

            $startTime = Carbon::parse($entry->start_time);
            $duration = (int) max(0, $startTime->diffInSeconds($now));

            $entry->timestamps = false;
            $entry->update([
                'end_time' => $now,
                'duration' => $duration,
                'auto_stopped_for_idle' => true,
            ]);

            $this->closeOpenAttendancePunches((int) $entry->user_id, $now);

            $idleInfo = $latestIdleByUser->get($entry->user_id);
            Log::info('Running timer auto-stopped by idle check', [
                'time_entry_id' => $entry->id,
                'user_id' => $entry->user_id,
                'start_time' => $entry->start_time->toIso8601String(),
                'end_time' => $now->toIso8601String(),
                'idle_seconds' => $idleSeconds,
                'threshold_seconds' => $idleThresholdSeconds,
                'last_activity_at' => $lastActiveAt->toIso8601String(),
                'last_idle_duration' => (int) ($idleInfo->max_idle_duration ?? 0),
                'auto_stopped_for_idle' => true,
            ]);

            $closed++;
        }

        $this->info("Auto-stopped {$closed} idle timer(s).");
        return 0;
    }

    private function closeOpenAttendancePunches(int $userId, Carbon $cutoff): void
    {
        $today = now()->toDateString();
        $record = DB::table('attendance_records')
            ->where('user_id', $userId)
            ->whereDate('attendance_date', $today)
            ->first();

        if (! $record) {
            return;
        }

        $openPunches = DB::table('attendance_punches')
            ->where('attendance_record_id', $record->id)
            ->whereNull('punch_out_at')
            ->get();

        foreach ($openPunches as $punch) {
            DB::table('attendance_punches')
                ->where('id', $punch->id)
                ->update(['punch_out_at' => $cutoff]);
        }

        if ($openPunches->isNotEmpty()) {
            DB::table('attendance_records')
                ->where('id', $record->id)
                ->update(['check_out_at' => $cutoff]);
        }
    }
}
