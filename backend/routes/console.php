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
use App\Models\BrowserTrackingConnection;
use App\Models\TimeEntry;
use App\Services\Monitoring\ProductivityClassifier;
use Database\Seeders\ProductivityRuleSeeder;

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

Artisan::command('monitoring:seed-productivity-rules', function () {
    $this->call('db:seed', ['--class' => ProductivityRuleSeeder::class, '--force' => true]);
    $this->info('Default productivity rules seeded successfully.');

    return 0;
})->purpose('Seed default productivity rules used by monitoring classification');

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
        [
            'label' => 'browser_tracking_connections',
            'model' => BrowserTrackingConnection::class,
            'date_field' => 'last_seen_at',
            'columns' => ['connected_at', 'last_seen_at', 'last_sync_at', 'disconnected_at'],
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
