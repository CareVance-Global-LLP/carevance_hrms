<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * `timers:close-stale` is a backstop for an ABANDONED timer, not a shift cap.
 *
 * Its own description says "without any activity", and config/time_tracking.php
 * documents stale_timer_max_minutes as "maximum minutes a running timer is
 * allowed to exist WITHOUT ANY ACTIVITY". The query implements neither: it
 * matches on start_time alone, so the sweep — scheduled every fifteen minutes —
 * closes every timer that has been running longer than two hours, including one
 * belonging to somebody who is typing at that exact moment.
 *
 * It is the silent variant of the bug IdleBackstopRespectsClientPolicyTest
 * covers, and worse in two ways. It ignores the activity ledger entirely rather
 * than merely reading it against the wrong threshold, so no amount of working
 * defends against it. And it does not set `auto_stopped_for_idle`, which is the
 * flag the desktop client reads to decide whether to tell the person anything —
 * so the timer stops with no notice, no popup and no explanation.
 */
class StaleSweepRespectsActivityTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;

    protected function setUp(): void
    {
        parent::setUp();

        config(['time_tracking.stale_timer_max_minutes' => 120]);

        $this->organization = Organization::factory()->create();
    }

    public function test_it_leaves_a_long_but_actively_worked_timer_running(): void
    {
        // Three hours in, and the tracker reported activity thirty seconds ago.
        // This person is at their desk working.
        $entry = $this->runningTimer(startedMinutesAgo: 180, lastActivitySecondsAgo: 30);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $this->assertNull(
            $entry->fresh()->end_time,
            'a timer with activity thirty seconds ago is not stale — somebody is working'
        );
    }

    public function test_it_leaves_a_long_timer_running_when_only_activity_sessions_report(): void
    {
        // The Electron foreground-window bridge writes activity_sessions and no
        // `activities` row at all, so a sweep that consults only one ledger is
        // blind to a whole class of live tracker.
        $entry = $this->runningTimer(startedMinutesAgo: 240, lastActivitySecondsAgo: null);

        ActivitySession::create([
            'organization_id' => $this->organization->id,
            'user_id' => $entry->user_id,
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Visual Studio Code',
            'app_name' => 'Code.exe',
            'started_at' => now()->subMinutes(2),
            'ended_at' => now()->subSeconds(20),
        ]);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $this->assertNull(
            $entry->fresh()->end_time,
            'the foreground-window ledger counts as activity too'
        );
    }

    public function test_it_still_closes_a_timer_the_tracker_abandoned(): void
    {
        // Three hours running, nothing reported for three hours: the app is
        // closed, asleep or crashed. This is what the sweep exists for.
        $entry = $this->runningTimer(startedMinutesAgo: 180, lastActivitySecondsAgo: 180 * 60);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $this->assertNotNull(
            $entry->fresh()->end_time,
            'an abandoned timer must still be closed, or it bills all night'
        );
    }

    private function runningTimer(int $startedMinutesAgo, ?int $lastActivitySecondsAgo): TimeEntry
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        $entry = TimeEntry::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'start_time' => now()->subMinutes($startedMinutesAgo),
            'end_time' => null,
            'is_break' => false,
        ]);

        if ($lastActivitySecondsAgo !== null) {
            Activity::create([
                'organization_id' => $this->organization->id,
                'user_id' => $user->id,
                'time_entry_id' => $entry->id,
                'type' => 'app',
                'name' => 'Visual Studio Code',
                'duration' => 60,
                'recorded_at' => now()->subSeconds($lastActivitySecondsAgo),
            ]);
        }

        return $entry;
    }
}
