<?php

namespace App\Console\Commands;

use App\Models\Activity;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * How much tracked time was discarded as idle, and how much of that was wrong.
 *
 * READ-ONLY. It writes nothing. Deciding what to give back is a separate act,
 * and it needs a human who has seen these numbers first.
 *
 * WHY THIS EXISTS. Until Sep 2026 an idle reading was the operating system's
 * clock -- it measures the MACHINE and keeps counting while no timer is
 * running. A timer started on a machine somebody had walked away from was
 * therefore born minutes idle, and the auto-stop rewound `end_time` to a moment
 * before the entry existed. The signature in the data is an entry whose
 * `last_activity_at` sits at or before its own `start_time`: nothing billed,
 * and the whole span discarded as a trailing tail.
 *
 * Two findings are reported, and they are different claims:
 *
 *   IMPOSSIBLE    `last_activity_at` <= `start_time`. The timer was declared
 *                 idle at or before it started. Nothing legitimate produces
 *                 this, so it needs no corroboration.
 *
 *   CONTRADICTED  Real non-idle activity -- an app or a URL -- was recorded
 *                 INSIDE the window that was discarded. The person was
 *                 demonstrably at the keyboard while the timesheet says they
 *                 were away.
 *
 * Everything else is reported as UNPROVEN and deliberately not counted as
 * recoverable. An absence with no activity in it looks identical whether
 * somebody stepped out or sat reading a document, and this command will not
 * guess on a question that decides somebody's pay.
 */
class AuditDiscardedIdleTime extends Command
{
    protected $signature = 'timers:audit-discarded-idle
        {--days=30 : How far back to look}
        {--user= : Restrict to one user id}
        {--csv= : Also write the affected entries to this path}';

    protected $description = 'Report how much time was discarded as idle, and how much was provably wrong (read-only)';

    public function handle(): int
    {
        $since = Carbon::now()->subDays((int) $this->option('days'))->startOfDay();

        $query = TimeEntry::query()
            ->where('start_time', '>=', $since)
            ->where('trailing_idle_seconds', '>', 0)
            ->orderBy('user_id')
            ->orderBy('start_time');

        if ($this->option('user')) {
            $query->where('user_id', (int) $this->option('user'));
        }

        $entries = $query->get();

        if ($entries->isEmpty()) {
            $this->info('No entries with discarded idle time in this window.');

            return self::SUCCESS;
        }

        $names = User::query()
            ->whereIn('id', $entries->pluck('user_id')->unique())
            ->pluck('name', 'id');

        $rows = [];
        $totals = ['discarded' => 0, 'impossible' => 0, 'contradicted' => 0, 'unproven' => 0];
        $perUser = [];

        foreach ($entries as $entry) {
            $discarded = (int) $entry->trailing_idle_seconds;
            $start = $entry->start_time ? Carbon::parse($entry->start_time) : null;
            $end = $entry->end_time ? Carbon::parse($entry->end_time) : null;
            $lastActive = $entry->last_activity_at ? Carbon::parse($entry->last_activity_at) : null;

            $verdict = 'unproven';

            if ($start && $lastActive && $lastActive->lessThanOrEqualTo($start)) {
                $verdict = 'impossible';
            } elseif ($end) {
                /*
                 * Anything non-idle recorded inside the span that was thrown
                 * away is direct evidence the person worked through it. The
                 * window runs from where the entry was rewound to, forward by
                 * the amount that was discarded.
                 */
                $windowEnd = $end->copy()->addSeconds($discarded);

                $evidence = Activity::query()
                    ->where('time_entry_id', $entry->id)
                    ->where('type', '!=', 'idle')
                    ->whereBetween('recorded_at', [$end, $windowEnd])
                    ->count();

                if ($evidence > 0) {
                    $verdict = 'contradicted';
                }
            }

            $totals['discarded'] += $discarded;
            $totals[$verdict] += $discarded;

            $uid = (int) $entry->user_id;

            if (! isset($perUser[$uid])) {
                $perUser[$uid] = ['discarded' => 0, 'recoverable' => 0, 'entries' => 0];
            }

            $perUser[$uid]['discarded'] += $discarded;
            $perUser[$uid]['entries']++;

            if ($verdict !== 'unproven') {
                $perUser[$uid]['recoverable'] += $discarded;

                $rows[] = [
                    $entry->id,
                    $uid,
                    (string) ($names[$uid] ?? '?'),
                    $start ? $start->toDateTimeString() : '-',
                    (int) $entry->duration,
                    $discarded,
                    strtoupper($verdict),
                ];
            }
        }

        $recoverable = $totals['impossible'] + $totals['contradicted'];

        $this->newLine();
        $this->info('Discarded idle time since '.$since->toDateString());
        $this->line(str_repeat('-', 74));
        $this->line(sprintf('  entries examined       %d', $entries->count()));
        $this->line(sprintf('  total discarded        %s', $this->hm($totals['discarded'])));
        $this->line(sprintf('  provably impossible    %s', $this->hm($totals['impossible'])));
        $this->line(sprintf('  contradicted by work   %s', $this->hm($totals['contradicted'])));
        $this->line(sprintf('  unproven (left alone)  %s', $this->hm($totals['unproven'])));
        $this->newLine();
        $this->line(sprintf(
            '  RECOVERABLE            %s   across %d entries',
            $this->hm($recoverable),
            count($rows)
        ));

        if ($perUser !== []) {
            $this->newLine();

            $table = collect($perUser)
                ->map(fn (array $v, $uid) => [
                    'user' => $uid,
                    'name' => (string) ($names[$uid] ?? '?'),
                    'entries' => $v['entries'],
                    'discarded' => $this->hm($v['discarded']),
                    'recoverable' => $this->hm($v['recoverable']),
                    'sort' => $v['recoverable'],
                ])
                ->sortByDesc('sort')
                ->map(fn (array $r) => [$r['user'], $r['name'], $r['entries'], $r['discarded'], $r['recoverable']])
                ->values()
                ->all();

            $this->table(['user', 'name', 'entries', 'discarded', 'recoverable'], $table);
        }

        if ($rows !== [] && $this->option('csv')) {
            $handle = fopen((string) $this->option('csv'), 'w');
            fputcsv($handle, ['entry_id', 'user_id', 'name', 'start_time', 'billed_seconds', 'discarded_seconds', 'verdict']);

            foreach ($rows as $row) {
                fputcsv($handle, $row);
            }

            fclose($handle);

            $this->newLine();
            $this->info(sprintf('Wrote %d affected entries to %s', count($rows), $this->option('csv')));
        }

        $this->newLine();
        $this->comment('Read-only. Nothing was changed.');

        return self::SUCCESS;
    }

    private function hm(int $seconds): string
    {
        return sprintf('%dh %02dm', intdiv($seconds, 3600), intdiv($seconds % 3600, 60));
    }
}
