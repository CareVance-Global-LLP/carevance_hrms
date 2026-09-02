<?php

namespace App\Console\Commands;

use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Monitoring\TimerAutoStopNotifier;
use App\Services\Monitoring\TrackerPolicyResolver;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CloseStaleTimers extends Command
{
    protected $signature = 'timers:close-stale
        {--max-minutes= : Max minutes a timer can run without activity before being auto-closed}
        {--dry-run : Preview timers that would be closed without saving}';

    protected $description = 'Auto-close time entries still running past the max duration with no activity arriving';

    /**
     * How much longer than the CLIENT's own threshold this waits before acting.
     *
     * Identical to CloseIdleTimers::CLIENT_GRACE_SECONDS and for the same
     * reason: this is a backstop for a tracker that could not act, and it holds
     * worse information than the client does. See that command for the full
     * account of what pre-empting the app cost on 25 Aug 2026.
     */
    private const CLIENT_GRACE_SECONDS = 300;

    public function handle(TimerAutoStopNotifier $notifier): int
    {
        $maxMinutes = (int) ($this->option('max-minutes')
            ?: config('time_tracking.stale_timer_max_minutes', 120));

        $dryRun = (bool) $this->option('dry-run');
        $cutoff = now()->subMinutes($maxMinutes);

        $this->line("Closing running timers started before {$cutoff->toIso8601String()} (max {$maxMinutes} minutes)");
        $this->line('Mode: ' . ($dryRun ? 'dry-run' : 'apply'));

        // withoutOrganizationScope() is explicit on purpose — see
        // CloseIdleTimers. This is the same kind of system-wide backstop and
        // must reach every tenant's running timers, not just whichever one an
        // ambient Auth::user() happens to belong to.
        //
        // is_break is excluded deliberately — see CloseIdleTimers. Force-closing
        // the is_break entry orphans the paired break_times row, which this
        // command cannot close, and that orphan permanently locks the user out
        // of break tracking once the date rolls over.
        $staleEntries = TimeEntry::withoutOrganizationScope()
            ->whereNull('end_time')
            ->where('is_break', false)
            ->where('start_time', '<', $cutoff)
            ->orderBy('start_time')
            ->get();

        if ($staleEntries->isEmpty()) {
            $this->info('No stale running timers found.');

            return 0;
        }

        $this->line("Found {$staleEntries->count()} stale timer(s) to evaluate.");

        /*
         * AGE IS NOT ABANDONMENT.
         *
         * This command used to close every timer older than max-minutes on the
         * age test alone, without ever consulting the activity ledger. Somebody
         * working steadily for two hours had their timer killed underneath
         * them, and the sweep runs every fifteen minutes, so it happened again
         * and again for as long as they kept working.
         *
         * Production, the fortnight to 1 Sep 2026: thirty closes, every one
         * between 120 and 135 minutes, and in each case the last activity row
         * landed between 0 and 3 seconds before the kill. They were at the
         * keyboard when it fired.
         *
         * Both ledgers are read, exactly as CloseIdleTimers reads them: the
         * Electron foreground-window bridge writes activity_sessions and no
         * activities row at all, so consulting only the first would call a real
         * working session silent.
         */
        $entryIds = $staleEntries->pluck('id')->all();
        $userIds = $staleEntries->pluck('user_id')->unique()->values()->all();

        $latestActivityByEntry = DB::table('activities')
            ->selectRaw('time_entry_id, MAX(recorded_at) as last_active_at')
            ->whereIn('time_entry_id', $entryIds)
            ->where('type', '!=', 'idle')
            ->groupBy('time_entry_id')
            ->pluck('last_active_at', 'time_entry_id')
            ->all();

        $latestSessionByEntry = DB::table('activity_sessions')
            ->selectRaw('time_entry_id, MAX(COALESCE(ended_at, started_at)) as last_active_at')
            ->whereIn('time_entry_id', $entryIds)
            ->groupBy('time_entry_id')
            ->pluck('last_active_at', 'time_entry_id')
            ->all();

        /*
         * The threshold each user's own tracker is obeying, resolved through the
         * same resolver the client reads via the tracker-policy endpoint. One
         * global number from .env is what made the idle sweep fire three times
         * too early on production; this command must not repeat it.
         */
        $configuredSeconds = max(60, (int) config('time_tracking.idle_auto_stop_threshold_seconds', 300));
        $policyResolver = app(TrackerPolicyResolver::class);
        $usersById = User::withoutGlobalScopes()->whereIn('id', $userIds)->get()->keyBy('id');

        $thresholdForUser = function (int $userId) use ($policyResolver, $usersById, $configuredSeconds): int {
            $user = $usersById->get($userId);

            $clientThreshold = $user
                ? (int) ($policyResolver->resolveForUser($user)['idle_auto_stop_threshold_seconds'] ?? $configuredSeconds)
                : $configuredSeconds;

            return max($configuredSeconds, $clientThreshold) + self::CLIENT_GRACE_SECONDS;
        };

        $now = now();
        $closed = 0;
        $stillWorking = 0;

        foreach ($staleEntries as $entry) {
            $startTime = Carbon::parse($entry->start_time);
            $lastActiveAt = $startTime;

            foreach ([$latestActivityByEntry[$entry->id] ?? null, $latestSessionByEntry[$entry->id] ?? null] as $candidate) {
                if ($candidate && Carbon::parse($candidate)->gt($lastActiveAt)) {
                    $lastActiveAt = Carbon::parse($candidate);
                }
            }

            $silentSeconds = (int) $lastActiveAt->diffInSeconds($now);
            $silenceRequired = $thresholdForUser((int) $entry->user_id);

            // Somebody is at this keyboard. Being old is not a reason to stop.
            if ($silentSeconds < $silenceRequired) {
                $stillWorking++;
                $this->line(sprintf(
                    'Leaving entry #%d alone for user #%d — active %ds ago (needs %ds of silence)',
                    $entry->id,
                    $entry->user_id,
                    $silentSeconds,
                    $silenceRequired
                ));

                continue;
            }

            if ($dryRun) {
                $this->line("[DRY-RUN] Would close entry #{$entry->id} for user #{$entry->user_id} started at {$entry->start_time}");

                continue;
            }

            /*
             * End at the last real activity, not at `now`.
             *
             * CloseIdleTimers already rewinds this way. Billing to `now` here
             * meant one abandoned timer cost a different amount depending on
             * which sweep happened to reach it first — the exact inconsistency
             * that was fixed on the idle side and left standing on this one.
             */
            $endTime = $lastActiveAt->lt($startTime) ? $startTime->copy() : $lastActiveAt->copy();
            $duration = (int) max(0, $startTime->diffInSeconds($endTime));
            $trailingIdleSeconds = (int) max(0, $endTime->diffInSeconds($now));

            $entry->timestamps = false;
            $entry->update([
                'end_time' => $endTime,
                'duration' => $duration,
                // Without this these rows are indistinguishable from a real
                // manual stop, even though the user never stopped anything.
                'stop_reason' => TimeEntry::STOP_STALE_CLOSE,
                'last_activity_at' => $lastActiveAt,
                'trailing_idle_seconds' => $trailingIdleSeconds,
                'duration_reconciled_at' => $now,
            ]);

            $this->closeOpenAttendancePunches((int) $entry->user_id, $endTime);

            // Say so. A stop nobody is told about is the whole complaint.
            if ($closedUser = $usersById->get($entry->user_id)) {
                $notifier->announce($closedUser, $entry, $silentSeconds, TimeEntry::STOP_STALE_CLOSE, $endTime);
            }

            Log::info('Stale timer auto-closed by scheduled command', [
                'time_entry_id' => $entry->id,
                'user_id' => $entry->user_id,
                'start_time' => $entry->start_time,
                'end_time' => $endTime->toIso8601String(),
                'duration' => $duration,
                'silent_seconds' => $silentSeconds,
                'trailing_idle_seconds' => $trailingIdleSeconds,
                'silence_required_seconds' => $silenceRequired,
                'max_minutes' => $maxMinutes,
                'stop_reason' => TimeEntry::STOP_STALE_CLOSE,
            ]);

            $closed++;
        }

        $this->info("Closed {$closed} stale timer(s). Left {$stillWorking} alone (still active).");

        return 0;
    }

    private function closeOpenAttendancePunches(int $userId, Carbon $cutoff): void
    {
        $todayRecord = AttendanceRecord::where('user_id', $userId)
            ->whereDate('attendance_date', now()->toDateString())
            ->first();

        if (! $todayRecord) {
            return;
        }

        $openPunches = AttendancePunch::where('attendance_record_id', $todayRecord->id)
            ->whereNull('punch_out_at')
            ->get();

        // worked_seconds has to be written here, not just punch_out_at. Closing
        // the punch without it left the session at 0 and never recomputed the
        // record total, so a cron-closed day silently reported no work.
        foreach ($openPunches as $punch) {
            $punch->timestamps = false;
            $punch->update([
                'punch_out_at' => $cutoff,
                'worked_seconds' => (int) max(0, Carbon::parse($punch->punch_in_at)->diffInSeconds($cutoff)),
            ]);
        }

        if ($openPunches->isNotEmpty()) {
            $closedWorked = (int) AttendancePunch::where('attendance_record_id', $todayRecord->id)
                ->whereNotNull('punch_out_at')
                ->sum('worked_seconds');

            $todayRecord->timestamps = false;
            $todayRecord->update([
                'check_out_at' => $cutoff,
                'worked_seconds' => $closedWorked,
            ]);
        }
    }
}
