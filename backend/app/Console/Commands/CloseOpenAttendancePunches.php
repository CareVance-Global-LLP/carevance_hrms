<?php

namespace App\Console\Commands;

use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Services\Attendance\AttendanceService;
use App\Services\Attendance\ShiftResolver;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;

/**
 * Close attendance punches nobody checked out of.
 *
 * Until recently a punch was closed as a side effect of `timers:close-idle`,
 * because checking in also started a timer. That coupling was wrong — a phone
 * emits no keyboard activity, so the idle sweep killed a mobile punch after
 * five minutes with zero seconds — and removing it left a gap: nothing closed a
 * forgotten check-out at all, so the punch stayed open and the day never
 * totalled.
 *
 * The end time is the deliberate part. It is the person's SHIFT END, never
 * `now()`. Somebody who forgets to check out at 18:00 must not be credited
 * until this command happens to run at 02:30, and must not be zeroed either —
 * both of those are wrong by a full working day in opposite directions. Where
 * no shift is known, a configured cap from the punch-in is the fallback.
 *
 * Every close is marked `auto_closed_reason`, so a manager reviewing a
 * disputed day can tell a real check-out from an assumed one.
 */
class CloseOpenAttendancePunches extends Command
{
    protected $signature = 'attendance:close-open-punches
        {--dry-run : Preview the punches that would be closed without saving}
        {--max-hours= : Fallback cap from punch-in when no shift is known (default: attendance.auto_close_max_hours)}';

    protected $description = 'Close attendance punches left open when nobody checked out, at shift end';

    public const REASON_SHIFT_END = 'shift_end';
    public const REASON_MAX_HOURS = 'max_hours';

    public function handle(ShiftResolver $shifts, AttendanceService $attendance): int
    {
        $maxHours = (int) ($this->option('max-hours')
            ?: config('attendance.auto_close_max_hours', 16));
        $dryRun = (bool) $this->option('dry-run');

        /*
         * Only punches whose shift has plausibly ended. Sweeping everything
         * open would close somebody who checked in twenty minutes ago on a
         * night shift, which is the failure mode this replaces.
         */
        $cutoff = now()->subHours(max(1, $maxHours));

        $open = AttendancePunch::query()
            ->with(['user', 'attendanceRecord'])
            ->whereNull('punch_out_at')
            ->where('punch_in_at', '<', now()->subMinutes(30))
            ->orderBy('punch_in_at')
            ->get();

        if ($open->isEmpty()) {
            $this->info('No open attendance punches to close.');

            return self::SUCCESS;
        }

        $this->line("Evaluating {$open->count()} open punch(es).");

        $closed = 0;

        foreach ($open as $punch) {
            $punchInAt = Carbon::parse($punch->punch_in_at);
            $user = $punch->user;

            if (! $user) {
                continue;
            }

            [$endAt, $reason] = $this->resolveCloseTime($shifts, $punch, $punchInAt, $maxHours);

            // Not due yet. A shift that has not finished is not a forgotten
            // check-out — the person may still be working.
            if ($endAt->greaterThan(now())) {
                continue;
            }

            // A close can never predate its own punch-in, and never precede the
            // hard cap either, or a short shift definition would silently
            // truncate a genuinely long day.
            if ($endAt->lessThan($punchInAt)) {
                $endAt = $punchInAt->copy();
            }

            $workedSeconds = (int) max(0, $punchInAt->diffInSeconds($endAt));

            if ($dryRun) {
                $this->line(sprintf(
                    '[DRY-RUN] Would close punch #%d for user #%d at %s (%s, %ds)',
                    $punch->id,
                    $user->id,
                    $endAt->toIso8601String(),
                    $reason,
                    $workedSeconds
                ));
                continue;
            }

            $punch->update([
                'punch_out_at' => $endAt,
                'worked_seconds' => $workedSeconds,
                'auto_closed_reason' => $reason,
            ]);

            $this->recomputeRecord($attendance, $punch, $endAt);

            Log::info('Attendance punch auto-closed', [
                'punch_id' => $punch->id,
                'user_id' => $user->id,
                'punch_in_at' => $punchInAt->toIso8601String(),
                'closed_at' => $endAt->toIso8601String(),
                'worked_seconds' => $workedSeconds,
                'reason' => $reason,
            ]);

            $closed++;
        }

        $this->info($dryRun ? 'Dry run complete.' : "Closed {$closed} punch(es).");

        return self::SUCCESS;
    }

    /**
     * When this punch should be treated as having ended, and why.
     *
     * @return array{0: Carbon, 1: string}
     */
    private function resolveCloseTime(
        ShiftResolver $shifts,
        AttendancePunch $punch,
        Carbon $punchInAt,
        int $maxHours
    ): array {
        $cap = $punchInAt->copy()->addHours($maxHours);

        $attendanceDate = $punch->attendanceRecord?->attendance_date
            ? Carbon::parse($punch->attendanceRecord->attendance_date)
            : $punchInAt->copy();

        $resolved = $shifts->resolve($punch->user, $attendanceDate);
        $shiftEnd = $resolved?->endsAt;

        if (! $shiftEnd) {
            return [$cap, self::REASON_MAX_HOURS];
        }

        $shiftEnd = Carbon::parse($shiftEnd);

        /*
         * The cap still wins if the shift end is somehow later — a
         * misconfigured shift should not be able to credit an unbounded day.
         * And a shift end before the punch-in means the person clocked in after
         * their shift finished, where only the cap is meaningful.
         */
        if ($shiftEnd->lessThanOrEqualTo($punchInAt) || $shiftEnd->greaterThan($cap)) {
            return [$cap, self::REASON_MAX_HOURS];
        }

        return [$shiftEnd, self::REASON_SHIFT_END];
    }

    /**
     * Roll the closed punch up into its day.
     *
     * Writing the punch alone is not enough: the record carries its own
     * `worked_seconds`, and leaving it stale is how a cron-closed day
     * previously reported no work at all.
     */
    private function recomputeRecord(AttendanceService $attendance, AttendancePunch $punch, Carbon $endAt): void
    {
        $record = $punch->attendanceRecord instanceof AttendanceRecord
            ? $punch->attendanceRecord->fresh('punches')
            : null;

        if (! $record) {
            return;
        }

        $record->update([
            'check_out_at' => $record->check_out_at ?: $endAt,
            'worked_seconds' => $attendance->calculateClosedWorkedSeconds($record),
            'status' => 'present',
        ]);
    }
}
