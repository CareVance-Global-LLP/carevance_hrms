<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The operational surface.
 *
 * Two processes in this system are mandatory and both fail silently. Without
 * the queue worker, payroll processing returns 202 and never happens. Without
 * the scheduler, idle timers never close — a measured case ran from 17:59 to
 * midday the following day. Nothing in the product said either had stopped.
 */
class PlatformHealthTest extends TestCase
{
    use RefreshDatabase;

    public function test_liveness_stays_trivial(): void
    {
        // The container healthcheck polls this. It reports whether PHP is
        // executing and must not flap every time Postgres blinks.
        $this->getJson('/api/health/simple')
            ->assertOk()
            ->assertExactJson(['status' => 'ok']);
    }

    public function test_readiness_reports_the_database_and_cache(): void
    {
        $this->getJson('/api/health')
            ->assertOk()
            ->assertJsonPath('services.database', 'up')
            ->assertJsonPath('services.cache', 'up')
            ->assertJsonStructure(['status', 'timestamp', 'services', 'queue', 'scheduler']);
    }

    public function test_a_healthy_queue_is_reported_as_up(): void
    {
        config(['queue.default' => 'database']);

        $this->getJson('/api/health')
            ->assertOk()
            ->assertJsonPath('queue.state', 'up')
            ->assertJsonPath('queue.pending', 0);
    }

    /**
     * The signature of a deployment that followed .env.example — which sets
     * QUEUE_CONNECTION=database — without ever starting `queue:work`.
     */
    public function test_a_queue_nobody_is_consuming_is_reported_as_stalled(): void
    {
        config(['queue.default' => 'database']);

        DB::table('jobs')->insert([
            'queue' => 'default',
            'payload' => '{}',
            'attempts' => 0,
            'reserved_at' => null,
            'available_at' => now()->subHour()->timestamp,
            'created_at' => now()->subHour()->timestamp,
        ]);

        $response = $this->getJson('/api/health')->assertOk();

        $this->assertSame('stalled', $response->json('queue.state'));
        $this->assertSame('degraded', $response->json('status'));
        $this->assertStringContainsString('queue:work', $response->json('queue.note'));
    }

    public function test_a_stopped_scheduler_is_visible(): void
    {
        Cache::put('scheduler:last-run-at', now()->subHour()->toIso8601String(), 3600);

        $response = $this->getJson('/api/health')->assertOk();

        $this->assertSame('stalled', $response->json('scheduler.state'));
        $this->assertSame('degraded', $response->json('status'));
        $this->assertStringContainsString('Idle timers', $response->json('scheduler.note'));
    }

    public function test_a_running_scheduler_is_reported_as_up(): void
    {
        Cache::put('scheduler:last-run-at', now()->toIso8601String(), 3600);

        $this->getJson('/api/health')
            ->assertOk()
            ->assertJsonPath('scheduler.state', 'up')
            ->assertJsonPath('status', 'healthy');
    }

    public function test_a_scheduler_that_has_never_checked_in_says_so_rather_than_claiming_health(): void
    {
        Cache::forget('scheduler:last-run-at');

        $this->getJson('/api/health')
            ->assertOk()
            ->assertJsonPath('scheduler.state', 'unknown');
    }

    public function test_failed_jobs_degrade_the_report(): void
    {
        config(['queue.default' => 'database']);

        DB::table('failed_jobs')->insert([
            'uuid' => (string) \Illuminate\Support\Str::uuid(),
            'connection' => 'database',
            'queue' => 'default',
            'payload' => '{}',
            'exception' => 'boom',
            'failed_at' => now(),
        ]);

        $response = $this->getJson('/api/health')->assertOk();

        $this->assertSame(1, $response->json('queue.failed'));
        $this->assertSame('degraded', $response->json('status'));
    }

    /**
     * A driver this endpoint cannot inspect must say so, not guess.
     */
    public function test_a_non_database_queue_is_reported_as_not_inspectable(): void
    {
        config(['queue.default' => 'redis']);

        $this->getJson('/api/health')
            ->assertOk()
            ->assertJsonPath('queue.state', 'not_inspectable');
    }

    /**
     * The scheduler heartbeat is what makes a stopped scheduler visible at all.
     */
    public function test_the_scheduler_heartbeat_is_registered_every_minute(): void
    {
        $source = file_get_contents(base_path('routes/console.php'));

        $this->assertStringContainsString('schedule:heartbeat', $source);
        $this->assertStringContainsString('scheduler:last-run-at', $source);
    }
}
