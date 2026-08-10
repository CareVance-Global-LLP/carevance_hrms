<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Reports\WorkTimeSummaryService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Reproduces the exact reported scenario:
 *
 *   work for 2 minutes, then sit completely untouched for 5 minutes.
 *
 * Expected under the agreed rule: 2 minutes worked, 5 minutes idle. The report
 * was showing roughly 3 minutes of idle and putting the rest into work time.
 */
class IdleAccountingScenarioTest extends TestCase
{
    use RefreshDatabase;

    private const SESSION_START = '2026-05-10 09:00:00';
    private const LAST_KEYPRESS = '2026-05-10 09:02:00';
    private const IDLE_STOP_AT  = '2026-05-10 09:07:00';

    private function makeUser(): User
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org-idle-scenario']);

        return User::create([
            'name' => 'Employee',
            'email' => 'idle-scenario@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    /**
     * Builds the rows the desktop tracker actually writes for this scenario.
     * Verified against useDesktopTracker.test.tsx, which asserts the client
     * creates an idle activity at duration 180 and updates it to 300.
     */
    private function seedScenario(
        User $user,
        bool $rewindEndTimeToLastKeypress,
        int $persistedIdleSeconds = 300,
    ): TimeEntry {
        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'timer_slot' => 'primary',
            'start_time' => self::SESSION_START,
            'end_time' => $rewindEndTimeToLastKeypress ? self::LAST_KEYPRESS : self::IDLE_STOP_AT,
            'duration' => $rewindEndTimeToLastKeypress ? 120 : 420,
            'billable' => true,
            'is_break' => false,
            'auto_stopped_for_idle' => true,
        ]);

        // The 2 minutes of real work.
        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Visual Studio Code',
            'duration' => 120,
            'recorded_at' => self::LAST_KEYPRESS,
        ]);

        // The rolling idle row. recorded_at is the window END and duration its
        // length, so the reconstructed window is [recorded_at - duration, recorded_at].
        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'System Idle - Visual Studio Code',
            'duration' => $persistedIdleSeconds,
            'recorded_at' => Carbon::parse(self::LAST_KEYPRESS)->addSeconds($persistedIdleSeconds),
        ]);

        return $entry;
    }

    private function summarize(User $user): array
    {
        return app(WorkTimeSummaryService::class)->forUserRange(
            $user->id,
            Carbon::parse('2026-05-10 00:00:00'),
            Carbon::parse('2026-05-10 23:59:59'),
        );
    }

    public function test_reported_scenario_is_accounted_correctly(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 09:10:00'));

        try {
            $user = $this->makeUser();
            $this->seedScenario($user, rewindEndTimeToLastKeypress: true);

            $summary = $this->summarize($user);

            fwrite(STDERR, sprintf(
                "\n[AFTER FIX] track=%ds work=%ds idle=%ds\n",
                $summary['track_time'],
                $summary['work_time'],
                $summary['idle_time'],
            ));

            $this->assertSame(120, $summary['track_time'], 'Only the 2 real minutes are tracked');
            $this->assertSame(120, $summary['work_time'], '2 minutes worked');
            $this->assertSame(0, $summary['idle_time'], 'The idle tail sits outside the entry, so it is not double-subtracted');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_legacy_shape_shows_the_reported_symptom(): void
    {
        // The pre-change shape: the entry was closed at now() rather than at the
        // last keypress, so the idle tail lived INSIDE the billed span.
        Carbon::setTestNow(Carbon::parse('2026-05-10 09:10:00'));

        try {
            $user = $this->makeUser();
            $this->seedScenario($user, rewindEndTimeToLastKeypress: false);

            $summary = $this->summarize($user);

            fwrite(STDERR, sprintf(
                "[LEGACY SHAPE] track=%ds work=%ds idle=%ds\n",
                $summary['track_time'],
                $summary['work_time'],
                $summary['idle_time'],
            ));

            $this->assertSame(420, $summary['track_time']);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_legacy_shape_with_a_stalled_idle_row_reproduces_the_report(): void
    {
        // The reported symptom. The idle Activity row is a ROLLING record the 1s
        // tick keeps updating (180 -> 181 -> ... -> 300). When the dedicated 15s
        // idle check stops the timer instead, it never touches that row, so it
        // is left frozen at whatever the last tick wrote — typically the 180s it
        // was created with, because OS timers are throttled hard once the
        // machine is actually idle.
        Carbon::setTestNow(Carbon::parse('2026-05-10 09:10:00'));

        try {
            $user = $this->makeUser();
            $this->seedScenario($user, rewindEndTimeToLastKeypress: false, persistedIdleSeconds: 180);

            $summary = $this->summarize($user);

            fwrite(STDERR, sprintf(
                "[LEGACY + STALLED IDLE ROW] track=%ds work=%ds idle=%ds\n",
                $summary['track_time'],
                $summary['work_time'],
                $summary['idle_time'],
            ));

            // 7 minutes tracked, only 3 recorded as idle, so 4 minutes read as
            // "worked" when only 2 were.
            $this->assertSame(420, $summary['track_time']);
            $this->assertSame(180, $summary['idle_time'], 'Only 3 of the 5 idle minutes are recorded');
            $this->assertSame(240, $summary['work_time'], 'Reports 4 minutes worked instead of 2');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_the_fix_is_immune_to_a_stalled_idle_row(): void
    {
        // The same stalled row, but with end_time rewound to the last keypress.
        // Billing no longer depends on the idle row being accurate at all,
        // because the idle tail is outside the entry's own span.
        Carbon::setTestNow(Carbon::parse('2026-05-10 09:10:00'));

        try {
            $user = $this->makeUser();
            $this->seedScenario($user, rewindEndTimeToLastKeypress: true, persistedIdleSeconds: 180);

            $summary = $this->summarize($user);

            fwrite(STDERR, sprintf(
                "[AFTER FIX + STALLED IDLE ROW] track=%ds work=%ds idle=%ds\n",
                $summary['track_time'],
                $summary['work_time'],
                $summary['idle_time'],
            ));

            $this->assertSame(120, $summary['work_time'], 'Still exactly the 2 minutes actually worked');
        } finally {
            Carbon::setTestNow();
        }
    }
}
