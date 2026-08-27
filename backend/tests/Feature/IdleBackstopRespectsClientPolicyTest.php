<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The server-side sweep is a BACKSTOP, not a second opinion.
 *
 * It exists for a tracker that could not act — closed, asleep, crashed,
 * offline. It holds strictly worse information than the client: the desktop app
 * watches the OS input clock, while this can only see how long ago an activity
 * row reached the server. A person typing into a form is plainly active to the
 * app and looks silent from here.
 *
 * Enabled on production 25 Aug 2026, it closed three timers within two hours at
 * 301s, 342s and 357s of trailing idle — because the server read
 * IDLE_AUTO_STOP_THRESHOLD_SECONDS=300 from .env while every client was on its
 * organization's policy of 900s. Somebody completing his profile in the app had
 * his timer stopped and marked idle underneath him. He was working.
 *
 * So the sweep now reads the SAME policy the client reads, and waits longer
 * still. A backstop that fires before the thing it backs up is not a backstop —
 * it is a competing implementation with worse data, and it takes time off
 * somebody's timesheet.
 */
class IdleBackstopRespectsClientPolicyTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        /*
         * The production mismatch, reproduced exactly: the SERVER reads 300
         * from config (.env had IDLE_AUTO_STOP_THRESHOLD_SECONDS=300) while the
         * CLIENT obeys its organization's own policy of 900. Without the
         * org-level setting both sides read the same config and the bug cannot
         * happen at all, which is what made it invisible until production.
         */
        config(['time_tracking.idle_auto_stop_threshold_seconds' => 300]);

        $this->organization = Organization::factory()->create([
            'settings' => ['idle_auto_stop_threshold_seconds' => 900],
        ]);
    }

    public function test_it_leaves_a_timer_alone_inside_the_clients_own_threshold(): void
    {
        // 400s idle: past the server's 300s config, well inside the client's
        // 900s policy. The client is still watching and has not acted, which
        // means it does not consider this person idle yet.
        $entry = $this->runningTimerLastActive(400);

        $this->artisan('timers:close-idle')->assertExitCode(0);

        $this->assertNull(
            $entry->fresh()->end_time,
            'the sweep must not pre-empt a tracker that is still deciding'
        );
    }

    public function test_it_leaves_a_timer_alone_even_at_the_clients_threshold(): void
    {
        // Exactly at 900s. The client acts here; the server must still hold,
        // or the two race and the one with worse information sometimes wins.
        $entry = $this->runningTimerLastActive(900);

        $this->artisan('timers:close-idle')->assertExitCode(0);

        $this->assertNull($entry->fresh()->end_time);
    }

    public function test_it_closes_once_the_client_has_demonstrably_failed_to_act(): void
    {
        // 900s policy + 300s grace = 1200s. Past that, the tracker has had its
        // chance and did not take it — closed, asleep or gone.
        $entry = $this->runningTimerLastActive(1400);

        $this->artisan('timers:close-idle')->assertExitCode(0);

        $fresh = $entry->fresh();

        $this->assertNotNull($fresh->end_time, 'a tracker that never acted must not bill all night');
        $this->assertTrue((bool) $fresh->auto_stopped_for_idle);
    }

    public function test_the_idle_tail_is_never_billed(): void
    {
        $entry = $this->runningTimerLastActive(1400);

        $this->artisan('timers:close-idle')->assertExitCode(0);

        $fresh = $entry->fresh();

        // end_time rewinds to the last real activity, and the tail is recorded
        // separately — a late stop must never charge for the silence.
        $this->assertGreaterThan(0, $fresh->trailing_idle_seconds);
        $this->assertLessThan(
            (int) $entry->start_time->diffInSeconds(now()),
            (int) $fresh->duration,
            'the billed duration must exclude the idle tail'
        );
    }

    private function runningTimerLastActive(int $secondsAgo): TimeEntry
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $entry = TimeEntry::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'start_time' => now()->subSeconds($secondsAgo + 600),
            'end_time' => null,
            'is_break' => false,
        ]);

        // The activity ledger is what the server reads to decide "last active".
        Activity::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Profile form',
            'duration' => 60,
            'recorded_at' => now()->subSeconds($secondsAgo),
        ]);

        return $entry;
    }
}
