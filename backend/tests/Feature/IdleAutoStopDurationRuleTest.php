<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\TimeEntries\TimeEntryDurationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The specified idle rule: idle under 3:00 records nothing, 5:00 of idle
 * triggers a stop, and the entry ends at the last keypress with the idle
 * recorded separately.
 *
 * All three stop paths — the client stop, the in-request server fallback, and
 * timers:close-idle — must agree on that rule. They previously did not: the
 * client billed the idle tail, the server fallback excluded it, and the cron
 * billed it, all writing the same flag so nothing downstream could tell which
 * had happened.
 */
class IdleAutoStopDurationRuleTest extends TestCase
{
    use RefreshDatabase;

    /**
     * These scenarios are written around a 5-minute auto-stop, which was the
     * system default when the rule was specified. The default has since moved
     * to 15 minutes, so the threshold is pinned here rather than inherited.
     *
     * What this class is actually about is the duration arithmetic — bill to
     * the last keypress, record the idle separately, and have all three stop
     * paths agree. That arithmetic must hold at any threshold, so depending on
     * the ambient default only made the tests break when the default moved,
     * which is precisely what happened.
     */
    private const AUTO_STOP_SECONDS = 300;

    protected function setUp(): void
    {
        parent::setUp();

        config(['time_tracking.idle_auto_stop_threshold_seconds' => self::AUTO_STOP_SECONDS]);

        /*
         * Every scenario here asserts an exact second count — 3300 billed, 300
         * idle — while building its timestamps from separate now() calls. On an
         * unfrozen clock a tick between two of those calls shifts the span by a
         * second, and the test fails with "301 is identical to 300" for no
         * reason connected to the rule it is checking. It flaked on load rather
         * than on logic, which is the worst kind: it points at the wrong code.
         *
         * The arithmetic being tested does not depend on time passing, so the
         * clock is pinned.
         */
        $this->freezeTime();
    }

    private function makeUser(string $email): User
    {
        $organization = Organization::firstOrCreate(
            ['slug' => 'org-idle-rule'],
            ['name' => 'Org Idle Rule']
        );

        $user = User::create([
            'name' => 'Employee',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        // Stamps organization_id on fixtures the test creates directly after
        // this call, the same way BelongsToOrganization would from a real
        // authenticated request.
        Auth::setUser($user);

        return $user;
    }

    public function test_client_idle_stop_bills_to_the_last_keypress_and_records_the_idle_separately(): void
    {
        // The specified example: a 60 minute session whose last 5 minutes were
        // idle bills 55 minutes and records 5 minutes of idle.
        $user = $this->makeUser('idle-spec-client@example.com');
        $headers = $this->apiHeadersFor($user);

        $entryId = (int) $this->postJson('/api/time-entries/start', [
            'timer_slot' => 'primary',
        ], $headers)->assertCreated()->json('id');

        $start = now()->subMinutes(60);
        $lastKeypress = now()->subMinutes(5);
        TimeEntry::query()->whereKey($entryId)->update(['start_time' => $start]);

        // The newest non-idle activity row sits at 4 minutes ago, which is what
        // keeps the in-request server fallback from closing this entry first —
        // both paths use the same 5 minute threshold, so a scenario idle enough
        // for the client is normally idle enough for the fallback to win the
        // race. The client's OS idle API is the more accurate signal here and
        // reports the real last keypress at 5 minutes ago.
        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entryId,
            'type' => 'app',
            'name' => 'Visual Studio Code',
            'duration' => 3300,
            'recorded_at' => now()->subMinutes(4),
        ]);

        $this->postJson('/api/time-entries/stop', [
            'timer_slot' => 'primary',
            'auto_stopped_for_idle' => true,
            'idle_seconds' => 300,
            'last_activity_at' => $lastKeypress->toIso8601String(),
        ], $headers)->assertOk();

        $entry = TimeEntry::findOrFail($entryId);

        $this->assertSame(3300, (int) $entry->duration, '55 minutes billed');
        $this->assertSame(300, (int) $entry->trailing_idle_seconds, '5 minutes of idle recorded');
        $this->assertSame(
            $lastKeypress->startOfSecond()->toIso8601String(),
            $entry->end_time->startOfSecond()->toIso8601String(),
            'The entry ends at the last keypress'
        );
        $this->assertTrue((bool) $entry->auto_stopped_for_idle);
        $this->assertSame(TimeEntry::STOP_IDLE_CLIENT, $entry->stop_reason);
        $this->assertNotNull($entry->duration_reconciled_at);

        // The reconciliation marker is what stops effectiveDuration() from
        // raising the billed duration back up to the raw span.
        $this->assertSame(3300, app(TimeEntryDurationService::class)->effectiveDuration($entry));
    }

    public function test_cron_idle_stop_produces_the_same_duration_as_the_client_path(): void
    {
        $user = $this->makeUser('idle-spec-cron@example.com');

        /*
         * Twenty-five minutes idle, not five.
         *
         * The sweep is a backstop and now waits for the CLIENT's own threshold
         * plus five minutes of grace before acting — a five-minute fixture no
         * longer reaches it, and should not: on production the old five-minute
         * rule stopped a timer under somebody who was actively filling in a
         * form. See IdleBackstopRespectsClientPolicyTest.
         *
         * What this test is actually about is unchanged: however long it waits,
         * the cron must produce the SAME duration as the client path — billing
         * to the last real activity and recording the tail separately.
         */
        $start = now()->subMinutes(80);
        $lastKeypress = now()->subMinutes(25);

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'timer_slot' => 'primary',
            'start_time' => $start,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Visual Studio Code',
            'duration' => 3300,
            'recorded_at' => $lastKeypress,
        ]);

        $this->artisan('timers:close-idle')->assertExitCode(0);

        $entry->refresh();

        // The cron used to bill start -> now, charging the whole idle tail.
        // 80 minutes running, last keypress at 25 minutes ago: 55 minutes
        // billed, 25 minutes recorded as idle and NOT billed.
        $this->assertSame(3300, (int) $entry->duration);
        $this->assertSame(1500, (int) $entry->trailing_idle_seconds);
        $this->assertSame(TimeEntry::STOP_IDLE_CRON, $entry->stop_reason);
    }

    public function test_idle_stop_with_only_an_activity_session_does_not_lose_the_work(): void
    {
        // The Electron foreground-window bridge writes activity_sessions and no
        // `activities` row at all. Anchoring on `activities` alone found
        // nothing, fell back to start_time, and closed the entry at duration 0 —
        // losing the whole session. It was build-dependent, which is why it
        // came and went.
        $user = $this->makeUser('idle-spec-bridge@example.com');
        $headers = $this->apiHeadersFor($user);

        $start = now()->subMinutes(60);
        $lastKeypress = now()->subMinutes(6);

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'timer_slot' => 'primary',
            'start_time' => $start,
            'billable' => true,
        ]);

        ActivitySession::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'app',
            'tool_type' => 'editor',
            'display_name' => 'Visual Studio Code',
            'started_at' => $start,
            'ended_at' => $lastKeypress,
            'duration_seconds' => 3240,
        ]);

        // The in-request server fallback runs on every active poll.
        $this->getJson('/api/time-entries/active?timer_slot=primary', $headers)->assertOk();

        $entry->refresh();

        $this->assertNotNull($entry->end_time, 'The idle fallback should have closed the entry');
        $this->assertSame(3240, (int) $entry->duration, '54 minutes of real work must survive');
        $this->assertSame(TimeEntry::STOP_IDLE_SERVER, $entry->stop_reason);
    }

    public function test_a_running_break_is_never_force_closed_by_the_idle_or_stale_crons(): void
    {
        // A break has no activity rows, so it always looked maximally idle. The
        // crons force-closed it and left the paired break_times row open
        // forever, which permanently 409'd the user out of break tracking.
        $user = $this->makeUser('idle-spec-break@example.com');
        $headers = $this->apiHeadersFor($user);

        $this->postJson('/api/time-entries/start', ['timer_slot' => 'primary'], $headers)->assertCreated();
        $this->postJson('/api/breaks/start', [], $headers)->assertCreated();

        $breakEntry = TimeEntry::where('user_id', $user->id)->where('is_break', true)->firstOrFail();
        TimeEntry::query()->whereKey($breakEntry->id)->update(['start_time' => now()->subHours(3)]);

        $this->artisan('timers:close-idle')->assertExitCode(0);
        $this->artisan('timers:close-stale')->assertExitCode(0);

        $breakEntry->refresh();
        $this->assertNull($breakEntry->end_time, 'A running break must survive both crons');

        // And the user can still end the break normally.
        $this->postJson('/api/breaks/end', [], $headers)->assertOk();
    }

    public function test_a_break_orphaned_before_the_fix_no_longer_locks_the_user_out(): void
    {
        // Simulates the legacy state: a break_times row left open on a previous
        // day. today() filters by date so it was invisible in the UI, while
        // start() did not, so it 409'd forever with no End button to press.
        $user = $this->makeUser('idle-spec-lockout@example.com');
        $headers = $this->apiHeadersFor($user);

        \App\Models\BreakTime::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'break_date' => now()->subDays(3)->toDateString(),
            'start_at' => now()->subDays(3)->setTime(12, 0),
            'reason' => 'Orphaned by a cron',
        ]);

        $this->postJson('/api/breaks/start', [], $headers)->assertCreated();

        $this->assertSame(
            0,
            \App\Models\BreakTime::where('user_id', $user->id)
                ->whereNull('end_at')
                ->where('break_date', '<', now()->toDateString())
                ->count(),
            'The stale break should have been healed, not left to block new breaks'
        );
    }

    public function test_break_start_links_both_halves_and_end_closes_the_linked_entry(): void
    {
        $user = $this->makeUser('idle-spec-link@example.com');
        $headers = $this->apiHeadersFor($user);

        $this->postJson('/api/time-entries/start', ['timer_slot' => 'primary'], $headers)->assertCreated();
        $breakEntryId = (int) $this->postJson('/api/breaks/start', [], $headers)
            ->assertCreated()
            ->json('break_entry_id');

        $break = \App\Models\BreakTime::where('user_id', $user->id)->whereNull('end_at')->firstOrFail();
        $this->assertSame($breakEntryId, (int) $break->time_entry_id, 'The two halves must be linked');

        $this->postJson('/api/breaks/end', [], $headers)->assertOk();

        $this->assertNotNull(TimeEntry::findOrFail($breakEntryId)->end_time);
        $this->assertNotNull($break->fresh()->end_at);
    }

    public function test_deleting_a_break_removes_both_halves(): void
    {
        $user = $this->makeUser('idle-spec-delete@example.com');
        $headers = $this->apiHeadersFor($user);

        $this->postJson('/api/breaks/start', [], $headers)->assertCreated();
        $this->postJson('/api/breaks/end', [], $headers)->assertOk();

        $break = \App\Models\BreakTime::where('user_id', $user->id)->firstOrFail();
        $breakEntryId = (int) $break->time_entry_id;

        $this->deleteJson("/api/breaks/{$break->id}", [], $headers)->assertOk();

        $this->assertDatabaseMissing('break_times', ['id' => $break->id]);
        $this->assertDatabaseMissing('time_entries', ['id' => $breakEntryId]);
    }
}
