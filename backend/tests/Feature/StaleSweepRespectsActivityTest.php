<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * "Stale" has to mean NOTHING IS ARRIVING, not merely OLD.
 *
 * `timers:close-stale` tested one thing — `start_time < now - 120 minutes` —
 * and closed every match. It never looked at the activity ledger at all, so a
 * person who had been working steadily for two hours had their timer killed
 * underneath them, every fifteen minutes, forever.
 *
 * Production, 14 days to 1 Sep 2026: 30 closes, every one between 120 and 135
 * minutes, and the last activity row landed 0-3 SECONDS before the kill. They
 * were typing at the instant it fired. Vishwa, SAMARTH JAYSWAL, kajal patil,
 * Nisha Goswami and Vansh Mistry each lost a timer roughly twice a day.
 *
 * The age filter stays — this is still the backstop of last resort for a timer
 * far older than anything `timers:close-idle` should have left behind. It is
 * the second condition that was missing: age AND silence, never age alone.
 */
class StaleSweepRespectsActivityTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        config(['time_tracking.stale_timer_max_minutes' => 120]);
        config(['time_tracking.idle_auto_stop_threshold_seconds' => 300]);

        $this->organization = Organization::factory()->create([
            'settings' => ['idle_auto_stop_threshold_seconds' => 900],
        ]);
    }

    /** THE PRODUCTION BUG. A long day is not an abandoned timer. */
    public function test_a_timer_running_past_the_cap_is_left_alone_while_the_person_is_working(): void
    {
        // Three hours in — well past the 120-minute cap — and active a moment
        // ago. This is entry #1615 (Vishwa, 1 Sep, 127 min, gap 0s).
        $entry = $this->runningTimer(startedSecondsAgo: 10800, lastActiveSecondsAgo: 5);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $this->assertNull(
            $entry->fresh()->end_time,
            'a timer with activity arriving must never be closed for being old'
        );
    }

    public function test_a_timer_active_within_the_clients_threshold_is_left_alone(): void
    {
        // 400s silent: past the server's 300s config floor, inside the client's
        // own 900s policy. The tracker is still deciding; the sweep must hold.
        $entry = $this->runningTimer(startedSecondsAgo: 10800, lastActiveSecondsAgo: 400);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $this->assertNull($entry->fresh()->end_time);
    }

    public function test_a_genuinely_abandoned_timer_is_still_closed(): void
    {
        // Old AND silent for longer than the client's policy plus its grace.
        // This is what the command is actually for.
        $entry = $this->runningTimer(startedSecondsAgo: 10800, lastActiveSecondsAgo: 4000);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $fresh = $entry->fresh();
        $this->assertNotNull($fresh->end_time, 'an abandoned timer must not bill all night');
        $this->assertSame(TimeEntry::STOP_STALE_CLOSE, $fresh->stop_reason);
    }

    public function test_a_young_timer_is_still_ignored(): void
    {
        // Inside the cap. Unchanged behaviour — close-idle owns this case.
        $entry = $this->runningTimer(startedSecondsAgo: 600, lastActiveSecondsAgo: 4000);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $this->assertNull($entry->fresh()->end_time);
    }

    public function test_the_silent_tail_is_not_billed(): void
    {
        $entry = $this->runningTimer(startedSecondsAgo: 10800, lastActiveSecondsAgo: 4000);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $fresh = $entry->fresh();

        // Consistent with close-idle, which already rewinds to the last real
        // activity. Billing to `now` here meant the same abandoned timer cost
        // a different amount depending on which sweep reached it first.
        $this->assertGreaterThan(0, (int) $fresh->trailing_idle_seconds);
        $this->assertLessThan(
            (int) $entry->start_time->diffInSeconds(now()),
            (int) $fresh->duration,
            'the billed duration must exclude the silent tail'
        );
    }

    public function test_a_timer_with_no_activity_at_all_anchors_on_its_start(): void
    {
        // Nothing was ever recorded against it. There is no last-activity
        // instant to rewind to, so it is worth nothing, not three hours.
        $user = User::factory()->create(['organization_id' => $this->organization->id, 'role' => 'employee']);

        $entry = TimeEntry::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'start_time' => now()->subSeconds(10800),
            'end_time' => null,
            'is_break' => false,
        ]);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $fresh = $entry->fresh();
        $this->assertNotNull($fresh->end_time);
        $this->assertSame(0, (int) $fresh->duration);
    }

    public function test_dry_run_still_changes_nothing(): void
    {
        $entry = $this->runningTimer(startedSecondsAgo: 10800, lastActiveSecondsAgo: 4000);

        $this->artisan('timers:close-stale', ['--dry-run' => true])->assertExitCode(0);

        $this->assertNull($entry->fresh()->end_time);
    }

    private function runningTimer(int $startedSecondsAgo, int $lastActiveSecondsAgo): TimeEntry
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $entry = TimeEntry::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'start_time' => now()->subSeconds($startedSecondsAgo),
            'end_time' => null,
            'is_break' => false,
        ]);

        Activity::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Editor',
            'duration' => 60,
            'recorded_at' => now()->subSeconds($lastActiveSecondsAgo),
        ]);

        return $entry;
    }
}
