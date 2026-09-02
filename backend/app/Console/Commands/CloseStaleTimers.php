<?php

namespace App\Console\Commands;

use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Monitoring\TimerAutoStopNotifier;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

class CloseStaleTimers extends Command
{
    protected $signature = 'timers:close-stale
        {--max-minutes= : Max minutes a timer can run without activity before being auto-closed}
        {--dry-run : Preview timers that would be closed without saving}';

    protected $description = 'Auto-close time entries that are still running past the max allowed duration';

    public function handle(TimerAutoStopNotifier $notifier): int
    {
        $maxMinutes = (int) ($this->option('max-minutes')
            ?: config('time_tracking.stale_timer_max_minutes', 120));

        $dryRun = (bool) $this->option('dry-run');
        $cutoff = now()->subMinutes($maxMinutes);

        $this->line("Closing running timers with no activity since {$cutoff->toIso8601String()} (max {$maxMinutes} minutes)");
        $this->line("Mode: " . ($dryRun ? 'dry-run' : 'apply'));

        // withoutOrganizationScope() is explicit on purpose — see
        // CloseIdleTimers. This is the same kind of system-wide backstop and
        // must reach every tenant's running timers, not just whichever one an
        // ambient Auth::user() happens to belong to.
        //
        // is_break is excluded deliberately — see CloseIdleTimers. Force-closing
        // the is_break entry orphans the paired break_times row, which this
        // command cannot close, and that orphan permanently locks the user out
        // of break tracking once the date rolls over.
        $candidates = TimeEntry::withoutOrganizationScope()
            ->whereNull('end_time')
            ->where('is_break', false)
            ->where('start_time', '<', $cutoff)
            ->orderBy('start_time')
            ->get();

        if ($candidates->isEmpty()) {
            $this->info('No stale running timers found.');

            return 0;
        }

        /*
         * STALE MEANS ABANDONED, NOT LONG.
         *
         * The query above can only ask how long ago a timer STARTED, and that
         * was the whole test: every timer running past the cap was closed,
         * every fifteen minutes, whether or not the person was at their desk.
         * Somebody who auto-started at 09:30 and worked straight through had
         * their timer stopped between 11:30 and 11:45 - silently, because this
         * path does not set `auto_stopped_for_idle`, and that flag is what the
         * desktop client reads to decide whether to say anything at all.
         *
         * The command's own description, and the config key it reads, have
         * always said "without any activity". This is where that gets
         * implemented. Both ledgers are consulted for the same reason
         * CloseIdleTimers consults both: the Electron foreground-window bridge
         * writes `activity_sessions` and no `activities` row at all, so reading
         * only one of them is blind to a whole class of live tracker.
         */
        $entryIds = $candidates->pluck('id')->all();

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

        $lastActiveAtFor = function (TimeEntry $entry) use ($latestActivityByEntry, $latestSessionByEntry): Carbon {
            $lastActiveAt = Carbon::parse($entry->start_time);

            foreach ([$latestActivityByEntry[$entry->id] ?? null, $latestSessionByEntry[$entry->id] ?? null] as $candidate) {
                if ($candidate && Carbon::parse($candidate)->gt($lastActiveAt)) {
                    $lastActiveAt = Carbon::parse($candidate);
                }
            }

            return $lastActiveAt;
        };

        $staleEntries = $candidates->filter(
            fn (TimeEntry $entry) => $lastActiveAtFor($entry)->lt($cutoff)
        )->values();

        $stillWorking = $candidates->count() - $staleEntries->count();
        if ($stillWorking > 0) {
            $this->line("Skipped {$stillWorking} long-running timer(s) still reporting activity.");
        }

        if ($staleEntries->isEmpty()) {
            $this->info('No stale running timers found.');

            return 0;
        }

        $this->line("Found {$staleEntries->count()} stale timer(s) to close.");
        $now = now();
        $closed = 0;

        foreach ($staleEntries as $entry) {
            if ($dryRun) {
                $this->line("[DRY-RUN] Would close entry #{$entry->id} for user #{$entry->user_id} started at {$entry->start_time}");

                continue;
            }

            $startTime = Carbon::parse($entry->start_time);

            /*
             * End AT the last activity, never at `now`.
             *
             * Every other auto-stop path rewinds to the last real moment of
             * work and records the silence separately. This one billed
             * start->now, so an app that died at 10:00 and was swept at 12:15
             * charged two and a quarter hours of a closed laptop.
             */
            $lastActiveAt = $lastActiveAtFor($entry);
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
                // Marks `duration` as deliberately computed so effectiveDuration()
                // does not raise it back to the raw start->end span.
                'duration_reconciled_at' => $now,
            ]);

            $this->closeOpenAttendancePunches((int) $entry->user_id, $endTime);

            /*
             * Say so.
             *
             * Closing the timer correctly is only half of it. Of 214 stops
             * on production in 30 days, 59 came from the server and not one
             * left a row in app_notifications - the people it happened to
             * could only describe it as "the tracker just stops". A toast is
             * no use either, because this sweep runs precisely when nobody
             * is watching the screen.
             */
            $closedUser = User::withoutGlobalScopes()->find($entry->user_id);
            if ($closedUser) {
                $notifier->announce(
                    $closedUser,
                    $entry,
                    (int) $lastActiveAt->diffInSeconds($now),
                    TimeEntry::STOP_STALE_CLOSE,
                    $endTime
                );
            }

            Log::info('Stale timer auto-closed by scheduled command', [
                'time_entry_id' => $entry->id,
                'user_id' => $entry->user_id,
                'start_time' => $entry->start_time,
                'end_time' => $endTime->toIso8601String(),
                'duration' => $duration,
                'last_activity_at' => $lastActiveAt->toIso8601String(),
                'trailing_idle_seconds' => $trailingIdleSeconds,
                'max_minutes' => $maxMinutes,
            ]);

            $closed++;
        }

        $this->info("Closed {$closed} stale timer(s) successfully.");

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
