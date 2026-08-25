<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\TimeEntry;
use App\Services\Monitoring\ProductivityClassifier;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Artisan::command('screenshots:health-check', function () {
    $diskName = 'screenshots';
    $ttlMinutes = max(1, (int) config('screenshots.url_ttl_minutes', 30));
    $appUrl = (string) config('app.url', '');
    $isProduction = app()->environment('production');

    $this->line('Screenshot pipeline health check');
    $this->line('APP_URL: '.$appUrl);
    $this->line('TTL minutes: '.$ttlMinutes);

    if ($isProduction && Str::contains(Str::lower($appUrl), ['localhost', '127.0.0.1'])) {
        $this->error('APP_URL points to localhost in production. Update it before continuing.');

        return 1;
    }

    if ($ttlMinutes < 5) {
        $this->warn('SCREENSHOT_URL_TTL_MINUTES is below 5. Consider using at least 30.');
    }

    try {
        $disk = Storage::disk($diskName);
        $probePath = '__health/'.Str::uuid().'.txt';
        $probeBody = 'ok';

        $disk->put($probePath, $probeBody);
        $canReadBack = $disk->exists($probePath) && $disk->get($probePath) === $probeBody;
        $disk->delete($probePath);

        if (! $canReadBack) {
            $this->error('Screenshot disk write/read check failed.');

            return 1;
        }
    } catch (\Throwable $e) {
        $this->error('Screenshot disk check failed: '.$e->getMessage());

        return 1;
    }

    $signedPath = URL::temporarySignedRoute(
        'screenshots.file',
        now()->addMinutes($ttlMinutes),
        ['screenshot' => 1],
        absolute: false
    );

    if (! Str::contains($signedPath, ['expires=', 'signature='])) {
        $this->error('Signed URL generation check failed.');

        return 1;
    }

    $this->info('OK: screenshot storage and signed URL checks passed.');

    return 0;
})->purpose('Validate screenshot storage and signed URL configuration');

Artisan::command('idle:health-check', function () {
    $idleTrackThreshold = max(30, (int) config('time_tracking.idle_track_threshold_seconds', 180));
    $idleAutoStopThreshold = max(60, (int) config('time_tracking.idle_auto_stop_threshold_seconds', 300));
    $queueDriver = (string) config('queue.default', 'sync');
    $cacheStore = (string) config('cache.default', 'file');

    $this->line('Idle pipeline health check');
    $this->line('Idle track threshold: '.$idleTrackThreshold.' seconds');
    $this->line('Idle auto-stop threshold: '.$idleAutoStopThreshold.' seconds');
    $this->line('Queue driver: '.$queueDriver);
    $this->line('Cache store: '.$cacheStore);

    if ($idleAutoStopThreshold < $idleTrackThreshold) {
        $this->error('Idle auto-stop threshold cannot be lower than idle track threshold.');

        return 1;
    }

    if (app()->environment('production') && $queueDriver === 'sync') {
        $this->warn('Queue driver is sync in production. Idle auto-stop emails will run inline.');
    }

    try {
        $probeKey = 'idle-health-check:'.Str::uuid();
        Cache::put($probeKey, true, now()->addMinute());
        Cache::forget($probeKey);
    } catch (\Throwable $exception) {
        $this->warn('Cache smoke test failed. Idle stop still works, but email dedupe may be weaker.');
        $this->warn($exception->getMessage());
    }

    $this->info('OK: idle threshold and dependency checks passed.');

    return 0;
})->purpose('Validate idle auto-stop configuration and dependencies');

Artisan::command('monitoring:reclassify-activities {--user_id=} {--from_id=} {--chunk=500}', function (ProductivityClassifier $classifier) {
    $chunkSize = max(50, (int) $this->option('chunk'));
    $fromId = max(0, (int) $this->option('from_id'));
    $userId = max(0, (int) $this->option('user_id'));

    $query = Activity::query()
        ->with('user.groups:id')
        ->when($fromId > 0, fn ($builder) => $builder->where('id', '>=', $fromId))
        ->when($userId > 0, fn ($builder) => $builder->where('user_id', $userId))
        ->orderBy('id');

    $processed = 0;

    $query->chunkById($chunkSize, function ($activities) use ($classifier, &$processed) {
        foreach ($activities as $activity) {
            $classifier->stampActivity($activity);
            $activity->saveQuietly();
            $processed++;
        }
    });

    $this->info("Reclassified {$processed} activities.");

    return 0;
})->purpose('Backfill normalized productivity classification fields on activity records');

Artisan::command('timestamps:repair-local
    {--since= : Shift records on or after this timestamp. Defaults to today 00:00 in app timezone.}
    {--until= : Shift records on or before this timestamp. Defaults to now in app timezone.}
    {--shift=330 : Number of minutes to add to affected timestamps.}
    {--include-time-entries : Also shift time entry start/end timestamps in the selected window.}
    {--include-attendance : Also shift attendance record and punch timestamps in the selected window.}
    {--dry-run : Preview the number of rows that would be updated without saving changes.}', function () {
    $timezone = (string) config('app.timezone', 'UTC');
    $since = $this->option('since')
        ? Carbon::parse((string) $this->option('since'), $timezone)
        : Carbon::now($timezone)->startOfDay();
    $until = $this->option('until')
        ? Carbon::parse((string) $this->option('until'), $timezone)
        : Carbon::now($timezone);
    $shiftMinutes = (int) $this->option('shift');
    $dryRun = (bool) $this->option('dry-run');

    if ($shiftMinutes === 0) {
        $this->warn('Shift is 0 minutes. Nothing to do.');

        return 0;
    }

    if ($since->greaterThan($until)) {
        [$since, $until] = [$until->copy(), $since->copy()];
    }

    $targets = [
        [
            'label' => 'activities',
            'model' => Activity::class,
            'date_field' => 'recorded_at',
            'columns' => ['recorded_at', 'started_at', 'last_seen_at', 'ended_at'],
        ],
        [
            'label' => 'activity_sessions',
            'model' => ActivitySession::class,
            'date_field' => 'started_at',
            'columns' => ['started_at', 'ended_at'],
        ],
    ];

    if ($this->option('include-time-entries')) {
        $targets[] = [
            'label' => 'time_entries',
            'model' => TimeEntry::class,
            'date_field' => 'start_time',
            'columns' => ['start_time', 'end_time'],
        ];
    }

    if ($this->option('include-attendance')) {
        $targets[] = [
            'label' => 'attendance_records',
            'model' => AttendanceRecord::class,
            'date_field' => 'check_in_at',
            'columns' => ['check_in_at', 'check_out_at'],
        ];
        $targets[] = [
            'label' => 'attendance_punches',
            'model' => AttendancePunch::class,
            'date_field' => 'punch_in_at',
            'columns' => ['punch_in_at', 'punch_out_at'],
        ];
    }

    $this->line('Repairing local timestamps');
    $this->line('Timezone: '.$timezone);
    $this->line('Window: '.$since->toDateTimeString().' -> '.$until->toDateTimeString());
    $this->line('Shift: '.$shiftMinutes.' minutes');
    $this->line('Mode: '.($dryRun ? 'dry-run' : 'apply'));

    $totalUpdated = 0;

    foreach ($targets as $target) {
        $modelClass = $target['model'];
        $dateField = $target['date_field'];
        $columns = $target['columns'];

        $query = $modelClass::query()
            ->whereNotNull($dateField)
            ->whereBetween($dateField, [$since, $until])
            ->orderBy('id');

        $count = (clone $query)->count();
        $this->line(sprintf('- %s: %d row(s)', $target['label'], $count));

        if ($dryRun || $count === 0) {
            continue;
        }

        $query->chunkById(200, function ($rows) use ($columns, $shiftMinutes, &$totalUpdated) {
            foreach ($rows as $row) {
                $updates = [];

                foreach ($columns as $column) {
                    if (! $row->{$column}) {
                        continue;
                    }

                    $updates[$column] = Carbon::parse($row->{$column})->addMinutes($shiftMinutes);
                }

                if ($updates === []) {
                    continue;
                }

                $row->timestamps = false;
                $row->forceFill($updates)->saveQuietly();
                $totalUpdated++;
            }
        });
    }

    $this->info($dryRun
        ? 'Dry run completed.'
        : sprintf('Timestamp repair completed. Updated %d row(s).', $totalUpdated));

    return 0;
})->purpose('Shift affected telemetry timestamps into the correct local time window after a bad deployment');

/*
 * Scheduler heartbeat.
 *
 * The scheduler is mandatory and fails silently. `timers:close-idle` is the
 * only server-side backstop for desktop idle detection, and without something
 * driving the schedule the only thing that can stop an idle timer is the
 * desktop app itself — which cannot act once it is closed, asleep or crashed.
 * Measured with no scheduler running: time entry #2114 started at 17:59 and
 * was still open at midday the next day.
 *
 * Nothing recorded that the scheduler had stopped. This does, and
 * /api/health reads it, so a dead scheduler is now visible rather than
 * discovered a day later in the timesheets.
 */
Artisan::command('schedule:heartbeat', function () {
    Cache::put('scheduler:last-run-at', now()->toIso8601String(), now()->addHours(6));
})->everyMinute();

// Schedule: send task reminders every 5 minutes
Artisan::command('schedule:tasks-reminders', function () {
    $this->call('tasks:process-reminders');
})->everyFiveMinutes();

// Schedule: send overdue task notifications daily
Artisan::command('schedule:tasks-overdue', function () {
    $this->call('tasks:process-overdue');
})->dailyAt('08:00');

// Schedule: generate recurring tasks daily at midnight
Artisan::command('schedule:tasks-recurrences', function () {
    $this->call('tasks:process-recurrences');
})->dailyAt('00:00');

// Schedule: auto-close stale running timers every 15 minutes
Artisan::command('schedule:timers-close-stale', function () {
    $this->call('timers:close-stale');
})->everyFifteenMinutes();

/*
 * Monitoring alerts, once a day, for the day that just finished.
 *
 * Deliberately after the working day rather than at midnight sharp: a timer
 * stopped at 23:55 should be counted before the day it belongs to is judged.
 */
Artisan::command('schedule:monitoring-alerts', function () {
    $this->call('monitoring:evaluate-alerts');
})->dailyAt('07:00');

// Schedule: auto-stop idle timers every minute (server-side fallback for desktop idle detection)
Artisan::command('schedule:timers-close-idle', function () {
    $this->call('timers:close-idle');
})->everyMinute();

/*
 * Abandoned chunked uploads.
 *
 * People close the tab mid-upload — that is the normal case, not the
 * exception — and each abandoned session leaves its pieces on disk. These are
 * the largest files the system handles (up to 200 MB each), so without a sweep
 * the chunk directory grows until something else breaks.
 *
 * Hourly rather than nightly, unlike its neighbours: the cost of deleting a
 * few directories is trivial, and the cost of NOT deleting them for another
 * twenty hours is measured in gigabytes.
 */
Artisan::command('schedule:uploads-purge', function () {
    $purged = app(\App\Services\Uploads\ChunkedUploadService::class)->purgeExpired();
    $this->info(sprintf('Purged %d expired upload session(s).', $purged));
})->hourly();

/*
 * Screenshot retention. Runs nightly, off-peak: the purge deletes image files
 * as well as rows, and there is no reason for that I/O to compete with a
 * working day. Before this existed nothing ever deleted a screenshot.
 */
Artisan::command('schedule:screenshots-purge', function () {
    $this->call('screenshots:purge');
})->dailyAt('02:30');

/*
 * Biometric punches into attendance.
 *
 * Every five minutes rather than daily. A punch that has not become attendance
 * is invisible to the person who made it, and somebody standing at a terminal
 * watching nothing happen will punch again - which then pairs as an immediate
 * check-out and takes their morning with it.
 *
 * Each punch is claimed by stamping processed_at, so an overlapping run picks
 * up only what the previous one did not reach.
 */
Artisan::command('schedule:biometric-process', function () {
    $this->call('biometric:process');
})->everyFiveMinutes();

/*
 * Leave accrual, and mirroring approved leave into the ledger.
 *
 * Daily rather than monthly on purpose. A monthly job that fails on the 1st is
 * a month of missing entitlement nobody notices until somebody is refused leave
 * they had actually earned; a daily job that fails simply catches up tomorrow.
 *
 * Runs at 01:00, after the midnight lifecycle sweep has closed any leavers, so
 * nobody accrues on a day they were deactivated.
 *
 * Safe to run repeatedly: accrual is unique on (user, type, period) at the
 * database level and consumption is keyed on the leave request.
 */
Artisan::command('schedule:leave-accrue', function () {
    $this->call('leave:accrue');
})->dailyAt('01:00');

// Schedule: revoke access past the last working day, and advance onboarding
// stages by date. Runs shortly after midnight so a last working day is fully
// over before the account is closed.
Artisan::command('schedule:lifecycle-process', function () {
    $this->call('lifecycle:process');
})->dailyAt('00:30');

/*
 * Subscription cycle. Runs early so a renewal date that passed overnight is
 * reflected before the working day starts, and so reminders land in the morning
 * rather than at midnight.
 *
 * The middleware re-checks the same dates on every request, so a day this job
 * misses cannot hand out free access — the job exists to make the transition
 * visible and to send the reminders, not to be the only thing enforcing it.
 */
Artisan::command('schedule:billing-roll-cycle', function () {
    $this->call('billing:roll-cycle');
})->dailyAt('06:00');
