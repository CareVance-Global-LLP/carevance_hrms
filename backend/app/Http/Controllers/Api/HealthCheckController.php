<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Is this installation actually working?
 *
 * Two endpoints with deliberately different jobs:
 *
 *   /health/simple  liveness. Reports whether PHP is executing. The container
 *                   healthcheck polls this, so it must not flap every time
 *                   Postgres blinks.
 *   /health         readiness and operational truth. This is what a status
 *                   page and an on-call alert should read.
 *
 * The queue and scheduler checks matter more than they look. Both processes
 * are mandatory and both fail silently: without the worker, payroll
 * processing queues and never happens; without the scheduler, idle timers
 * never close — a measured case ran from 17:59 to midday the following day.
 * Nothing in the product previously said either had stopped.
 */
class HealthCheckController extends Controller
{
    /**
     * A queue this deep means the worker is dead or hopelessly behind.
     * Payroll runs dispatch one job per batch, so a healthy queue is short.
     */
    private const QUEUE_DEPTH_WARNING = 100;

    /** The scheduler runs every minute; five is generous. */
    private const SCHEDULER_STALE_MINUTES = 5;

    public function index()
    {
        $checks = [
            'status' => 'healthy',
            'timestamp' => now()->toIso8601String(),
            'version' => config('app.version', '1.0.0'),
            'services' => [],
        ];

        $degrade = function (string $level) use (&$checks): void {
            // 'unhealthy' outranks 'degraded' and must not be downgraded by a
            // later check that merely warns.
            if ($checks['status'] === 'unhealthy') {
                return;
            }

            $checks['status'] = $level;
        };

        // ------------------------------------------------------------ database
        try {
            DB::connection()->getPdo();
            $checks['services']['database'] = 'up';
        } catch (\Throwable $e) {
            $checks['services']['database'] = 'down';
            $checks['status'] = 'unhealthy';
        }

        // --------------------------------------------------------------- cache
        try {
            Cache::put('health_check', 'ok', 10);
            $checks['services']['cache'] = Cache::get('health_check') === 'ok' ? 'up' : 'down';

            if ($checks['services']['cache'] === 'down') {
                $checks['status'] = 'unhealthy';
            }
        } catch (\Throwable $e) {
            $checks['services']['cache'] = 'down';
            $checks['status'] = 'unhealthy';
        }

        $checks['services']['cache_driver'] = (string) config('cache.default');

        // --------------------------------------------------------------- queue
        $checks['queue'] = $this->queueHealth($degrade);

        // ----------------------------------------------------------- scheduler
        $checks['scheduler'] = $this->schedulerHealth($degrade);

        $statusCode = $checks['status'] === 'unhealthy' ? 503 : 200;

        return response()->json($checks, $statusCode);
    }

    /**
     * Depth, age of the oldest waiting job, and the failed pile.
     *
     * Depth alone is a poor signal: a queue of 5 that has not moved in an hour
     * is far worse than a queue of 500 draining steadily. The oldest job's age
     * is what actually distinguishes "busy" from "dead".
     *
     * @param  callable(string):void  $degrade
     * @return array<string, mixed>
     */
    private function queueHealth(callable $degrade): array
    {
        $driver = (string) config('queue.default');

        $health = [
            'driver' => $driver,
            'state' => 'unknown',
        ];

        // Only the database driver can be inspected from here. Redis and SQS
        // report through their own tooling, and guessing would be worse than
        // saying so.
        if ($driver !== 'database') {
            $health['state'] = 'not_inspectable';
            $health['note'] = "Queue depth is not readable for the '{$driver}' driver from this endpoint.";

            return $health;
        }

        try {
            if (! Schema::hasTable('jobs')) {
                $health['state'] = 'not_inspectable';
                $health['note'] = 'The jobs table does not exist. Run migrations.';

                return $health;
            }

            $pending = (int) DB::table('jobs')->count();
            $oldest = DB::table('jobs')->min('available_at');
            $failed = Schema::hasTable('failed_jobs') ? (int) DB::table('failed_jobs')->count() : 0;

            $oldestAgeSeconds = $oldest === null ? 0 : max(0, now()->timestamp - (int) $oldest);

            $health['state'] = 'up';
            $health['pending'] = $pending;
            $health['failed'] = $failed;
            $health['oldest_pending_age_seconds'] = $oldestAgeSeconds;

            /*
             * A job older than its own timeout means nothing is consuming the
             * queue. That is the signature of a deployment that followed
             * .env.example — which sets QUEUE_CONNECTION=database — without
             * running `php artisan queue:work`. Payroll processing returns 202
             * and then simply never happens.
             */
            if ($oldestAgeSeconds > 900) {
                $health['state'] = 'stalled';
                $health['note'] = 'The oldest job has waited over 15 minutes. Is `php artisan queue:work` running?';
                $degrade('degraded');
            } elseif ($pending > self::QUEUE_DEPTH_WARNING) {
                $health['state'] = 'backed_up';
                $health['note'] = "More than ".self::QUEUE_DEPTH_WARNING." jobs are waiting.";
                $degrade('degraded');
            }

            if ($failed > 0) {
                $health['note'] = ($health['note'] ?? '')." {$failed} job(s) have failed and need a human.";
                $degrade('degraded');
            }
        } catch (\Throwable $e) {
            $health['state'] = 'down';
            $degrade('degraded');
        }

        return $health;
    }

    /**
     * When the scheduler last ran.
     *
     * Nothing recorded this before, so a stopped scheduler was invisible: the
     * only thing that closes an idle timer is `timers:close-idle`, scheduled
     * every minute, and without it a timer runs until someone notices by hand.
     *
     * @param  callable(string):void  $degrade
     * @return array<string, mixed>
     */
    private function schedulerHealth(callable $degrade): array
    {
        try {
            $lastRun = Cache::get('scheduler:last-run-at');

            if (! $lastRun) {
                return [
                    'state' => 'unknown',
                    'note' => 'The scheduler has not checked in yet. It records a heartbeat every minute once '
                        .'`php artisan schedule:work` (dev) or a cron calling `schedule:run` (production) is running.',
                ];
            }

            $ranAt = \Carbon\Carbon::parse($lastRun);
            $ageMinutes = $ranAt->diffInMinutes(now());

            if ($ageMinutes > self::SCHEDULER_STALE_MINUTES) {
                $degrade('degraded');

                return [
                    'state' => 'stalled',
                    'last_run_at' => $ranAt->toIso8601String(),
                    'age_minutes' => $ageMinutes,
                    'note' => 'The scheduler has not run for '.$ageMinutes.' minutes. Idle timers will not close, '
                        .'screenshots will not be purged, and subscription cycles will not roll.',
                ];
            }

            return [
                'state' => 'up',
                'last_run_at' => $ranAt->toIso8601String(),
                'age_minutes' => $ageMinutes,
            ];
        } catch (\Throwable $e) {
            return ['state' => 'unknown'];
        }
    }

    public function simple()
    {
        return response()->json(['status' => 'ok']);
    }
}
