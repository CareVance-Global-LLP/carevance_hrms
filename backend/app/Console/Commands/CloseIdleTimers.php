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

    /**
     * How much longer than the CLIENT's own threshold this waits before acting.
     *
     * This is a backstop for a tracker that could not act — closed, asleep,
     * crashed, offline. It is not a second opinion on whether somebody is idle,
     * and it holds worse information than the client does: the client watches
     * the OS input clock, while this can only see how long ago the last
     * activity row reached the server.
     *
     * Without a margin it PRE-EMPTS the app. Found 25 Aug 2026, within two
     * hours of this sweep first being enabled: three timers closed at 301s,
     * 342s and 357s of trailing idle, because the server read
     * IDLE_AUTO_STOP_THRESHOLD_SECONDS=300 from .env while the desktop app was
     * on its organization's policy of 900s. Somebody filling in his profile in
     * the app had his timer stopped and marked idle underneath him.
     *
     * Five minutes on top of the client's own threshold. Long enough that a
     * running tracker always wins the race; short enough that a machine that
     * went to sleep at lunch is not still billing at five past.
     */
    private const CLIENT_GRACE_SECONDS = 300;

    public function handle(): int
    {
        /*
         * The FLOOR, not the threshold. The real threshold is per user, because
         * the policy the client obeys is per organization — resolved below.
         */
        $configuredSeconds = max(60, (int) config('time_tracking.idle_auto_stop_threshold_seconds', 300));
        $idleMinutes = (int) ($this->option('idle-minutes')
            ?: max(1, (int) round($configuredSeconds / 60)));

        $dryRun = (bool) $this->option('dry-run');
        $cutoff = now()->subMinutes($idleMinutes);

        $this->line("Checking running timers idle since before {$cutoff->toIso8601String()} ({$idleMinutes} min threshold)");

        // Get all currently running timers, across every organization.
        //
        // withoutOrganizationScope() is explicit on purpose: this is the
        // system-wide idle backstop the scheduler runs every minute (see
        // routes/console.php), and it must see every tenant's running timers,
        // not just one. It would already do that as an unauthenticated
        // console command — BelongsToOrganization's scope is a no-op with no
        // Auth::user() — but leaving it implicit means it would silently start
        // filtering to one tenant the moment anything in this process sets an
        // authenticated user. Cross-tenant access stays greppable instead.
        //
        // is_break is excluded deliberately. A break has no activity rows, so it
        // always looked maximally idle and got force-closed and stamped
        // auto_stopped_for_idle — while the paired break_times row, which this
        // command knows nothing about, stayed open forever and permanently 409'd
        // the user out of break tracking.
        $runningTimers = TimeEntry::withoutOrganizationScope()
            ->whereNull('end_time')
            ->where('is_break', false)
            ->where('start_time', '<', $cutoff)
            ->orderBy('start_time')
            ->get(['id', 'user_id', 'start_time']);

        if ($runningTimers->isEmpty()) {
            $this->info('No running timers to check.');
            return 0;
        }

        $this->line("Found {$runningTimers->count()} running timer(s) to evaluate.");

        $userIds = $runningTimers->pluck('user_id')->unique()->values()->all();
        $entryIds = $runningTimers->pluck('id')->all();

        // Batch-fetch the latest non-idle activity PER TIME ENTRY, not per user.
        // Keyed by user, activity belonging to a different (earlier) entry kept
        // a stale entry alive and, conversely, anchored the wrong instant.
        // TimeEntryController::closeIdleRunningEntry already scopes per entry;
        // this now matches it.
        $latestActivityByEntry = DB::table('activities')
            ->selectRaw('time_entry_id, MAX(recorded_at) as last_active_at')
            ->whereIn('time_entry_id', $entryIds)
            ->where('type', '!=', 'idle')
            ->groupBy('time_entry_id')
            ->pluck('last_active_at', 'time_entry_id')
            ->all();

        // The Electron foreground-window bridge writes activity_sessions and no
        // activities row at all, so this second ledger has to be consulted or a
        // real working session anchors on start_time and closes with duration 0.
        $latestSessionByEntry = DB::table('activity_sessions')
            ->selectRaw('time_entry_id, MAX(COALESCE(ended_at, started_at)) as last_active_at')
            ->whereIn('time_entry_id', $entryIds)
            ->groupBy('time_entry_id')
            ->pluck('last_active_at', 'time_entry_id')
            ->all();

        // Also batch-fetch latest idle activity per user (for logging)
        $latestIdleByUser = DB::table('activities')
            ->selectRaw('user_id, MAX(recorded_at) as last_idle_at, MAX(duration) as max_idle_duration')
            ->whereIn('user_id', $userIds)
            ->where('type', 'idle')
            ->groupBy('user_id')
            ->get()
            ->keyBy('user_id');

        /*
         * The threshold each user's own tracker is obeying.
         *
         * Resolved per user because the policy is per organization, and read
         * from the SAME resolver the client reads through `/tracker-policy`.
         * The previous code used one global number from .env, which on
         * production was 300 while every client was on 900 — so this sweep
         * stopped timers three times sooner than the app it exists to back up.
         */
        $policyResolver = app(\App\Services\Monitoring\TrackerPolicyResolver::class);
        $usersById = \App\Models\User::withoutGlobalScopes()
            ->whereIn('id', $userIds)
            ->get()
            ->keyBy('id');

        $thresholdForUser = function (int $userId) use ($policyResolver, $usersById, $configuredSeconds): int {
            $user = $usersById->get($userId);

            $clientThreshold = $user
                ? (int) ($policyResolver->resolveForUser($user)['idle_auto_stop_threshold_seconds'] ?? $configuredSeconds)
                : $configuredSeconds;

            // Never below the configured floor, and always the client's own
            // threshold plus the grace — whichever is later.
            return max($configuredSeconds, $clientThreshold) + self::CLIENT_GRACE_SECONDS;
        };

        $now = now();
        $closed = 0;

        foreach ($runningTimers as $entry) {
            $startTime = Carbon::parse($entry->start_time);
            $lastActiveAt = $startTime;

            foreach ([$latestActivityByEntry[$entry->id] ?? null, $latestSessionByEntry[$entry->id] ?? null] as $candidate) {
                if ($candidate && Carbon::parse($candidate)->gt($lastActiveAt)) {
                    $lastActiveAt = Carbon::parse($candidate);
                }
            }

            $idleSeconds = (int) $lastActiveAt->diffInSeconds($now);
            $idleThresholdSeconds = $thresholdForUser((int) $entry->user_id);

            // Skip if there's been recent activity within this user's threshold
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

            // End the entry AT the last activity so the idle tail is excluded,
            // matching TimeEntryController::closeIdleRunningEntry. This used to
            // bill start->now, so the same idle period was charged by the cron
            // and excluded by the in-request fallback depending on which fired.
            $endTime = $lastActiveAt->lt($startTime) ? $startTime->copy() : $lastActiveAt->copy();
            $duration = (int) max(0, $startTime->diffInSeconds($endTime));
            $trailingIdleSeconds = (int) max(0, $endTime->diffInSeconds($now));

            $entry->timestamps = false;
            $entry->update([
                'end_time' => $endTime,
                'duration' => $duration,
                'auto_stopped_for_idle' => true,
                'stop_reason' => TimeEntry::STOP_IDLE_CRON,
                'last_activity_at' => $lastActiveAt,
                'trailing_idle_seconds' => $trailingIdleSeconds,
                'duration_reconciled_at' => $now,
            ]);

            $this->closeOpenAttendancePunches((int) $entry->user_id, $endTime);

            $idleInfo = $latestIdleByUser->get($entry->user_id);
            Log::info('Running timer auto-stopped by idle check', [
                'time_entry_id' => $entry->id,
                'user_id' => $entry->user_id,
                'start_time' => $entry->start_time->toIso8601String(),
                'end_time' => $endTime->toIso8601String(),
                'worked_seconds' => $duration,
                'idle_seconds' => $idleSeconds,
                'trailing_idle_seconds' => $trailingIdleSeconds,
                'threshold_seconds' => $idleThresholdSeconds,
                'last_activity_at' => $lastActiveAt->toIso8601String(),
                'last_idle_duration' => (int) ($idleInfo->max_idle_duration ?? 0),
                'auto_stopped_for_idle' => true,
                'stop_reason' => TimeEntry::STOP_IDLE_CRON,
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

        // worked_seconds has to be written here, not just punch_out_at. Closing
        // the punch without it left the session at 0 and never recomputed the
        // record total, so a cron-closed day silently reported no work.
        foreach ($openPunches as $punch) {
            DB::table('attendance_punches')
                ->where('id', $punch->id)
                ->update([
                    'punch_out_at' => $cutoff,
                    'worked_seconds' => (int) max(0, Carbon::parse($punch->punch_in_at)->diffInSeconds($cutoff)),
                ]);
        }

        if ($openPunches->isNotEmpty()) {
            $closedWorked = (int) DB::table('attendance_punches')
                ->where('attendance_record_id', $record->id)
                ->whereNotNull('punch_out_at')
                ->sum('worked_seconds');

            DB::table('attendance_records')
                ->where('id', $record->id)
                ->update([
                    'check_out_at' => $cutoff,
                    'worked_seconds' => $closedWorked,
                ]);
        }
    }
}
