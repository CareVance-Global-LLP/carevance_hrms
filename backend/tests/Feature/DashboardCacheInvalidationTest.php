<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * GET /dashboard is cached per user for 30 seconds, and that payload carries
 * both the running timer and the shift countdown (`worked_time`). Nothing ever
 * called DashboardSummaryService::clearCache() — it had no callers at all — so
 * for up to half a minute after a start or a stop the endpoint answered with
 * the state from before the change.
 *
 * That is what let the desktop dashboard show a full 8-hour shift immediately
 * after stopping a timer (19 Aug 2026): the client refreshed, and the server
 * handed back the snapshot taken before any time had been worked.
 */
class DashboardCacheInvalidationTest extends TestCase
{
    use RefreshDatabase;

    public function test_starting_a_timer_is_visible_on_the_dashboard_immediately(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-08-19 10:00:00'));

        try {
            [, $headers] = $this->createAuthenticatedEmployee();

            // Prime the cache with the "no timer running" state.
            $this->getJson('/api/dashboard', $headers)
                ->assertOk()
                ->assertJsonPath('active_timer', null);

            $this->postJson('/api/time-entries/start', ['timer_slot' => 'primary'], $headers)
                ->assertCreated();

            // Well inside the 30s TTL: without invalidation this still reported
            // no running timer.
            Carbon::setTestNow(Carbon::parse('2026-08-19 10:00:05'));

            $this->getJson('/api/dashboard', $headers)
                ->assertOk()
                ->assertJsonPath('active_timer.timer_slot', 'primary');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_stopping_a_timer_is_visible_on_the_dashboard_immediately(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-08-19 10:00:00'));

        try {
            [, $headers] = $this->createAuthenticatedEmployee();

            $this->postJson('/api/time-entries/start', ['timer_slot' => 'primary'], $headers)
                ->assertCreated();

            // Prime the cache while the timer is running.
            Carbon::setTestNow(Carbon::parse('2026-08-19 10:00:11'));
            $this->getJson('/api/dashboard', $headers)
                ->assertOk()
                ->assertJsonPath('active_timer.timer_slot', 'primary');

            Carbon::setTestNow(Carbon::parse('2026-08-19 10:00:19'));
            $this->postJson('/api/time-entries/stop', ['timer_slot' => 'primary'], $headers)
                ->assertOk();

            // The client refreshes right after stopping. It must not be told
            // the timer is still running, and the worked figure must include
            // the session that just ended.
            $response = $this->getJson('/api/dashboard', $headers)->assertOk();

            $response->assertJsonPath('active_timer', null);
            $this->assertGreaterThan(
                0,
                (int) $response->json('worked_time.billed_seconds'),
                'The finished session must be inside the worked figure the countdown is derived from.',
            );
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_a_stop_that_finds_nothing_running_still_clears_the_cache(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-08-19 10:00:00'));

        try {
            [$user, $headers] = $this->createAuthenticatedEmployee();

            $this->postJson('/api/time-entries/start', ['timer_slot' => 'primary'], $headers)
                ->assertCreated();

            // Prime the cache while the timer is running.
            Carbon::setTestNow(Carbon::parse('2026-08-19 10:00:11'));
            $this->getJson('/api/dashboard', $headers)
                ->assertOk()
                ->assertJsonPath('active_timer.timer_slot', 'primary');

            /*
             * Something other than this request closes the entry — the
             * timers:close-idle cron, or the same person stopping from a second
             * device. The desktop app's stop then arrives with nothing left to
             * stop and returns 404, taking an early return that never reaches
             * the success path's cache clear.
             */
            TimeEntry::query()
                ->where('user_id', $user->id)
                ->whereNull('end_time')
                ->update(['end_time' => now(), 'duration' => 11]);

            Carbon::setTestNow(Carbon::parse('2026-08-19 10:00:19'));
            $this->postJson('/api/time-entries/stop', ['timer_slot' => 'primary'], $headers)
                ->assertNotFound();

            // Still inside the 30s TTL. The client that just failed to stop is
            // exactly the one that must not be told the timer is still going.
            $this->getJson('/api/dashboard', $headers)
                ->assertOk()
                ->assertJsonPath('active_timer', null);
        } finally {
            Carbon::setTestNow();
        }
    }

    private function createAuthenticatedEmployee(): array
    {
        $organization = Organization::create([
            'name' => 'CareVance Org',
            'slug' => 'carevance-org',
        ]);

        $user = User::create([
            'name' => 'Employee',
            'email' => 'employee@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        return [$user, $this->apiHeadersFor($user)];
    }
}
