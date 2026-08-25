<?php

namespace App\Console\Commands;

use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\TimeEntry;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

class CloseStaleTimers extends Command
{
    protected $signature = 'timers:close-stale
        {--max-minutes= : Max minutes a timer can run without activity before being auto-closed}
        {--dry-run : Preview timers that would be closed without saving}';

    protected $description = 'Auto-close time entries that are still running past the max allowed duration';

    public function handle(): int
    {
        $maxMinutes = (int) ($this->option('max-minutes')
            ?: config('time_tracking.stale_timer_max_minutes', 120));

        $dryRun = (bool) $this->option('dry-run');
        $cutoff = now()->subMinutes($maxMinutes);

        $this->line("Closing running timers started before {$cutoff->toIso8601String()} (max {$maxMinutes} minutes)");
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

        $this->line("Found {$staleEntries->count()} stale timer(s) to close.");
        $now = now();
        $closed = 0;

        foreach ($staleEntries as $entry) {
            if ($dryRun) {
                $this->line("[DRY-RUN] Would close entry #{$entry->id} for user #{$entry->user_id} started at {$entry->start_time}");

                continue;
            }

            $startTime = Carbon::parse($entry->start_time);
            $duration = (int) max(0, $startTime->diffInSeconds($now));

            $entry->timestamps = false;
            $entry->update([
                'end_time' => $now,
                'duration' => $duration,
                // Without this these rows are indistinguishable from a real
                // manual stop, even though the user never stopped anything.
                'stop_reason' => TimeEntry::STOP_STALE_CLOSE,
            ]);

            $this->closeOpenAttendancePunches((int) $entry->user_id, $now);

            Log::info('Stale timer auto-closed by scheduled command', [
                'time_entry_id' => $entry->id,
                'user_id' => $entry->user_id,
                'start_time' => $entry->start_time,
                'end_time' => $now->toIso8601String(),
                'duration' => $duration,
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
