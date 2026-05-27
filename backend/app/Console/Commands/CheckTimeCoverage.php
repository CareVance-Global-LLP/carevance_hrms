<?php

namespace App\Console\Commands;

use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class CheckTimeCoverage extends Command
{
    protected $signature = 'check:time-coverage {--user_id=} {--start=} {--end=}';
    protected $description = 'Compare TimeEntry total vs activity coverage to find gaps';

    public function handle()
    {
        $userId = $this->option('user_id');
        $start = $this->option('start') ? Carbon::parse($this->option('start')) : now()->startOfMonth();
        $end = $this->option('end') ? Carbon::parse($this->option('end')) : now()->endOfDay();

        $users = $userId
            ? User::where('id', $userId)->get()
            : User::where(function ($q) {
                $q->whereHas('customRole', fn ($cr) => $cr->where('hierarchy_level', '>=', 100))
                    ->orWhere('role', 'employee');
            })->orderBy('name')->get();

        if ($users->isEmpty()) {
            $this->error('No users found');
            return 1;
        }

        $this->output->writeln(str_pad('User', 30) . str_pad('Timer (h)', 12) . str_pad('Activity (h)', 14) . str_pad('Gap (h)', 10) . str_pad('Gap %', 10) . 'Activity Rows');
        $this->output->writeln(str_repeat('-', 100));

        $totalTimer = 0;
        $totalActivity = 0;

        foreach ($users as $user) {
            $timeEntries = TimeEntry::where('user_id', $user->id)
                ->whereBetween('start_time', [$start, $end])
                ->get();

            $timerSeconds = 0;
            foreach ($timeEntries as $entry) {
                $startTime = $entry->start_time ? Carbon::parse($entry->start_time) : null;
                $endTime = $entry->end_time ? Carbon::parse($entry->end_time) : ($startTime ? now() : null);
                if ($startTime && $endTime) {
                    $timerSeconds += max(0, (int) $entry->duration, $startTime->diffInSeconds($endTime));
                }
            }

            $activitySeconds = (int) Activity::where('user_id', $user->id)
                ->where('type', '!=', 'idle')
                ->whereBetween('recorded_at', [$start, $end])
                ->sum('duration');

            $sessionSeconds = (int) DB::selectOne("
                SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (COALESCE(ended_at, NOW()) - started_at))), 0) AS total
                FROM activity_sessions
                WHERE user_id = ?
                  AND activity_kind NOT IN ('desktop_idle', 'idle')
                  AND started_at >= ?
                  AND started_at <= ?
            ", [$user->id, $start, $end])->total;

            $totalCovered = $activitySeconds + $sessionSeconds;
            $gap = max(0, $timerSeconds - $totalCovered);
            $gapPct = $timerSeconds > 0 ? round(($gap / $timerSeconds) * 100, 1) : 0;

            $activityRowCount = Activity::where('user_id', $user->id)
                ->where('type', '!=', 'idle')
                ->whereBetween('recorded_at', [$start, $end])
                ->count();

            $this->output->writeln(
                str_pad(limitStr($user->name, 28), 30)
                . str_pad(round($timerSeconds / 3600, 2) . 'h', 12)
                . str_pad(round($totalCovered / 3600, 2) . 'h', 14)
                . str_pad(round($gap / 3600, 2) . 'h', 10)
                . str_pad($gapPct . '%', 10)
                . $activityRowCount
            );

            $totalTimer += $timerSeconds;
            $totalActivity += $totalCovered;

            if ($gap > 300 && $userId) {
                $this->output->writeln('');
                $this->line('--- Gap breakdown for ' . $user->name . ' ---');
                foreach ($timeEntries as $entry) {
                    $s = $entry->start_time ? Carbon::parse($entry->start_time) : null;
                    $e = $entry->end_time ? Carbon::parse($entry->end_time) : null;
                    if (!$s) continue;
                    $dur = $e ? $s->diffInSeconds($e) : $s->diffInSeconds(now());
                    $entryCovered = (int) Activity::where('user_id', $user->id)
                        ->where('time_entry_id', $entry->id)
                        ->where('type', '!=', 'idle')
                        ->sum('duration');
                    $entryGap = max(0, $dur - $entryCovered);
                    if ($entryGap > 60) {
                        $this->line(sprintf('  [%s - %s] timer=%s covered=%s gap=%s',
                            $s->format('m-d H:i'),
                            ($e ?? now())->format('H:i'),
                            secondsToHuman($dur),
                            secondsToHuman($entryCovered),
                            secondsToHuman($entryGap)
                        ));
                    }
                }
            }
        }

        $this->output->writeln(str_repeat('-', 100));
        $totalGap = max(0, $totalTimer - $totalActivity);
        $totalGapPct = $totalTimer > 0 ? round(($totalGap / $totalTimer) * 100, 1) : 0;
        $this->output->writeln(
            str_pad('TOTAL', 30)
            . str_pad(round($totalTimer / 3600, 2) . 'h', 12)
            . str_pad(round($totalActivity / 3600, 2) . 'h', 14)
            . str_pad(round($totalGap / 3600, 2) . 'h', 10)
            . str_pad($totalGapPct . '%', 10)
            . ''
        );

        return 0;
    }
}

function limitStr(string $s, int $len): string
{
    return mb_strlen($s) > $len ? mb_substr($s, 0, $len - 3) . '...' : $s;
}

function secondsToHuman(int $seconds): string
{
    $h = intdiv($seconds, 3600);
    $m = intdiv($seconds % 3600, 60);
    $s = $seconds % 60;
    return ($h ? "{$h}h " : '') . ($m ? "{$m}m " : '') . "{$s}s";
}
