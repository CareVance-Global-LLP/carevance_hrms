<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\AppNotification;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A TIMER THAT STOPS ITSELF HAS TO SAY SO.
 *
 * The client says it: `notifyIdleAutoStop` in useDesktopTracker raises an OS
 * toast whenever the tracker stops itself. The SERVER said nothing at all. Both
 * sweeps wrote a `Log::info` nobody reads and moved on.
 *
 * Production, the 30 days to 1 Sep 2026: of 214 stops, 59 came from the server
 * — 36 stale_close, 17 idle_auto_stop_cron, 6 idle_auto_stop_server — and
 * `app_notifications` held not one row of any timer-stop kind. Twenty-eight per
 * cent of all stops were silent, and the people they happened to reported it as
 * "the tracker just stops and we do not know".
 *
 * A toast is also not enough on its own. It is gone in seconds, and the whole
 * point of these sweeps is that they fire when nobody is watching the screen —
 * the machine is asleep, locked, or the app is shut. So this is a stored row,
 * which survives until it is read, and which arrives over the socket if a
 * client happens to be open.
 */
class ServerStoppedTimerIsAnnouncedTest extends TestCase
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

    public function test_the_idle_sweep_tells_the_person_it_stopped_their_timer(): void
    {
        [$user, $entry] = $this->runningTimer(startedSecondsAgo: 3000, lastActiveSecondsAgo: 1400);

        $this->artisan('timers:close-idle')->assertExitCode(0);

        $notification = AppNotification::where('user_id', $user->id)
            ->where('type', 'timer_auto_stopped')
            ->first();

        $this->assertNotNull($notification, 'a server-side stop must leave a record the person can find');
        $this->assertSame($this->organization->id, (int) $notification->organization_id);
    }

    public function test_the_stale_sweep_tells_the_person_too(): void
    {
        // Silent for longer than the 120-minute cap, which is what that sweep
        // requires before it will treat a timer as abandoned rather than long.
        [$user, $entry] = $this->runningTimer(startedSecondsAgo: 21600, lastActiveSecondsAgo: 10800);

        $this->artisan('timers:close-stale')->assertExitCode(0);

        $this->assertNotNull(
            AppNotification::where('user_id', $user->id)->where('type', 'timer_auto_stopped')->first(),
            'the stale sweep was the largest silent bucket on production'
        );
    }

    public function test_the_message_says_how_long_they_were_away(): void
    {
        [$user] = $this->runningTimer(startedSecondsAgo: 3000, lastActiveSecondsAgo: 1400);

        $this->artisan('timers:close-idle')->assertExitCode(0);

        $notification = AppNotification::where('user_id', $user->id)
            ->where('type', 'timer_auto_stopped')->first();

        // "Your timer was stopped" alone invites the next question. The number
        // is what lets somebody recognise it as their lunch and move on, or
        // notice it was not and come and ask.
        $this->assertMatchesRegularExpression(
            '/\d+\s*(minute|hour)/i',
            (string) $notification->message,
            'the message must quantify the silence, not just announce the stop'
        );
    }

    public function test_the_record_points_at_the_entry_it_closed(): void
    {
        [$user, $entry] = $this->runningTimer(startedSecondsAgo: 3000, lastActiveSecondsAgo: 1400);

        $this->artisan('timers:close-idle')->assertExitCode(0);

        $notification = AppNotification::where('user_id', $user->id)
            ->where('type', 'timer_auto_stopped')->first();

        $meta = is_array($notification->meta) ? $notification->meta : json_decode((string) $notification->meta, true);

        // Which timer, and why. A person disputing an entry needs to be able to
        // get from the notification to the row, and "idle" and "stale" are
        // different enough stories to be worth keeping apart.
        $this->assertSame($entry->id, (int) ($meta['time_entry_id'] ?? 0));
        $this->assertSame(TimeEntry::STOP_IDLE_CRON, $meta['stop_reason'] ?? null);
        $this->assertNotEmpty($meta['route'] ?? null);
    }

    public function test_a_timer_left_running_is_not_announced(): void
    {
        // Active a moment ago. Nothing happened, so there is nothing to say —
        // a notification here would train people to ignore the real ones.
        [$user] = $this->runningTimer(startedSecondsAgo: 10800, lastActiveSecondsAgo: 5);

        $this->artisan('timers:close-idle')->assertExitCode(0);
        $this->artisan('timers:close-stale')->assertExitCode(0);

        $this->assertSame(
            0,
            AppNotification::where('user_id', $user->id)->where('type', 'timer_auto_stopped')->count()
        );
    }

    public function test_a_dry_run_announces_nothing(): void
    {
        [$user] = $this->runningTimer(startedSecondsAgo: 10800, lastActiveSecondsAgo: 4000);

        $this->artisan('timers:close-stale', ['--dry-run' => true])->assertExitCode(0);

        $this->assertSame(
            0,
            AppNotification::where('user_id', $user->id)->where('type', 'timer_auto_stopped')->count(),
            'a preview must not tell somebody their timer was stopped'
        );
    }

    public function test_each_person_is_told_only_about_their_own_timer(): void
    {
        [$alice] = $this->runningTimer(startedSecondsAgo: 3000, lastActiveSecondsAgo: 1400);
        [$bob] = $this->runningTimer(startedSecondsAgo: 3000, lastActiveSecondsAgo: 1400);

        $this->artisan('timers:close-idle')->assertExitCode(0);

        $this->assertSame(1, AppNotification::where('user_id', $alice->id)->where('type', 'timer_auto_stopped')->count());
        $this->assertSame(1, AppNotification::where('user_id', $bob->id)->where('type', 'timer_auto_stopped')->count());
    }

    /**
     * The THIRD silent path, and the easiest to miss.
     *
     * TimeEntryController::closeIdleRunningEntry closes a timer during an
     * ordinary request rather than from the scheduler, and it logged and said
     * nothing exactly as the two sweeps did. Six of these on production in 30
     * days - small, but a person whose timer stopped this way was told just as
     * little as the other 53.
     *
     * Reached by reflection, which is how TimerScopeRegressionTest already
     * exercises the private closers in this controller.
     */
    public function test_the_in_request_idle_check_tells_the_person_too(): void
    {
        [$user, $entry] = $this->runningTimer(startedSecondsAgo: 3000, lastActiveSecondsAgo: 1400);

        $this->actingAs($user);

        $controller = app(\App\Http\Controllers\Api\TimeEntryController::class);
        $method = new \ReflectionMethod($controller, 'closeIdleRunningEntry');
        $method->setAccessible(true);
        $method->invoke($controller, $user->id);

        $this->assertNotNull($entry->fresh()->end_time, 'the in-request check should have closed it');
        $this->assertNotNull(
            AppNotification::where('user_id', $user->id)->where('type', 'timer_auto_stopped')->first(),
            'closing a timer inside a request is still closing somebody timer'
        );
    }
    /** @return array{0: User, 1: TimeEntry} */
    private function runningTimer(int $startedSecondsAgo, int $lastActiveSecondsAgo): array
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

        return [$user, $entry];
    }
}
