<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * An activity cannot last longer than the window it happened in.
 *
 * The OS idle clock counts straight through a suspend: `getSystemIdleTime()`
 * reports seconds since the last input, and a sleeping laptop receives none. So
 * a machine closed at 18:00 and reopened at 09:00 wakes reporting fifteen hours
 * of idle, and the tracker writes it as ONE row stamped with the moment of
 * waking.
 *
 * Found on production 25 Aug 2026: a single idle row of 54,522 seconds recorded
 * at 09:54, on a day that was eight hours old. It then dominated every idle
 * figure that person had — TimeBreakdownService clamps idle to tracked time, so
 * it pinned the monitoring badge to "idle 100%" beside a bar showing four hours
 * of productive work. Two numbers on one screen that could not both be true.
 *
 * Bounded at the WRITE because the readers disagree: the timeline already caps
 * a row at four hours, the productivity metrics do not, and a bound applied in
 * one reader is a bound the next reader does not have.
 */
class IdleDurationIsBoundedTest extends TestCase
{
    use RefreshDatabase;

    private User $user;

    protected function setUp(): void
    {
        parent::setUp();

        config(['usage_processing.normalization.max_log_duration_seconds' => 14400]);

        $organization = Organization::factory()->create();
        $this->user = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'employee',
        ]);
    }

    public function test_idle_cannot_outlast_the_session_it_happened_in(): void
    {
        // A two-hour session reporting fifteen hours of idle. The extra thirteen
        // hours did not happen while this timer was running; they happened while
        // the machine was asleep.
        $entry = $this->runningTimerStartedMinutesAgo(120);

        $this->actingAs($this->user)
            ->postJson('/api/activities', [
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'Idle',
                'duration' => 54522,
                'recorded_at' => now()->toIso8601String(),
            ])
            ->assertSuccessful();

        $stored = (int) \DB::table('activities')->where('user_id', $this->user->id)->value('duration');

        $this->assertLessThanOrEqual(
            7300,
            $stored,
            'idle must be bounded by the session span, not stored as reported'
        );
        $this->assertGreaterThan(0, $stored, 'bounding must not erase the idle entirely');
    }

    public function test_an_honest_idle_span_is_stored_untouched(): void
    {
        // Ten minutes idle inside a two-hour session is entirely possible, and
        // the guard must not round it, clamp it or otherwise improve on it.
        $entry = $this->runningTimerStartedMinutesAgo(120);

        $this->actingAs($this->user)
            ->postJson('/api/activities', [
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'Idle',
                'duration' => 600,
                'recorded_at' => now()->toIso8601String(),
            ])
            ->assertSuccessful();

        $this->assertSame(
            600,
            (int) \DB::table('activities')->where('user_id', $this->user->id)->value('duration')
        );
    }

    public function test_an_unattached_idle_report_is_still_bounded(): void
    {
        // No session to measure against. Without the configured ceiling this is
        // unbounded, which is how one row came to claim fifteen hours.
        $this->actingAs($this->user)
            ->postJson('/api/activities', [
                'type' => 'idle',
                'name' => 'Idle',
                'duration' => 54522,
                'recorded_at' => now()->toIso8601String(),
            ])
            ->assertSuccessful();

        $this->assertSame(
            14400,
            (int) \DB::table('activities')->where('user_id', $this->user->id)->value('duration')
        );
    }

    public function test_app_activity_is_not_bounded_by_the_session(): void
    {
        /*
         * Only idle is bounded this way. An app row legitimately carries a span
         * measured before its timer started — the tracker watches the
         * foreground window continuously — and clamping those would erase real
         * work, which is a far worse error than an overstated idle figure.
         */
        $entry = $this->runningTimerStartedMinutesAgo(5);

        $this->actingAs($this->user)
            ->postJson('/api/activities', [
                'time_entry_id' => $entry->id,
                'type' => 'app',
                'name' => 'Visual Studio Code',
                'duration' => 3600,
                'recorded_at' => now()->toIso8601String(),
            ])
            ->assertSuccessful();

        $this->assertSame(
            3600,
            (int) \DB::table('activities')->where('user_id', $this->user->id)->value('duration')
        );
    }

    private function runningTimerStartedMinutesAgo(int $minutes): TimeEntry
    {
        return TimeEntry::create([
            'organization_id' => $this->user->organization_id,
            'user_id' => $this->user->id,
            'start_time' => now()->subMinutes($minutes),
            'end_time' => null,
            'is_break' => false,
        ]);
    }
}
