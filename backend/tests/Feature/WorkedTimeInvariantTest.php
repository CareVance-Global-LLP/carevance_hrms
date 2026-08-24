<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Reports\WorkedTimeService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Invariants for worked time.
 *
 * The reported bug was a "Shift Remaining" countdown that went UP on refresh —
 * 07:53 to 07:54. A countdown moving backwards is impossible if worked time is
 * computed one way; it happened because the client counted wall clock through an
 * idle period while the server netted the idle out, and refreshing swapped one
 * number for the other.
 *
 * These assert the properties that make that class of bug impossible, rather
 * than checking one scenario's arithmetic.
 */
class WorkedTimeInvariantTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(string $email = 'worked-time@example.com'): User
    {
        $organization = Organization::firstOrCreate(
            ['slug' => 'org-worked-time'],
            ['name' => 'Org Worked Time']
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

    private function workedTime(User $user, Carbon $at): array
    {
        return app(WorkedTimeService::class)->forUserToday($user, $at);
    }

    public function test_shift_remaining_never_increases_while_a_timer_runs_through_idle(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 09:00:00'));

        try {
            $user = $this->makeUser();

            $entry = TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'primary',
                'start_time' => '2026-05-10 09:00:00',
                'billable' => true,
                'is_break' => false,
            ]);

            // Two minutes of real work, then the user walks away.
            Activity::create([
                'user_id' => $user->id,
                'time_entry_id' => $entry->id,
                'type' => 'app',
                'name' => 'Visual Studio Code',
                'duration' => 120,
                'recorded_at' => '2026-05-10 09:02:00',
            ]);

            $previousRemaining = PHP_INT_MAX;
            $previousWorked = -1;
            $previousWorkedTruthful = 0;

            // Walk the clock forward one minute at a time across the idle
            // period, growing the rolling idle row exactly as the tracker does.
            for ($minute = 0; $minute <= 10; $minute++) {
                $now = Carbon::parse('2026-05-10 09:02:00')->addMinutes($minute);
                Carbon::setTestNow($now);

                if ($minute >= 3) {
                    Activity::updateOrCreate(
                        [
                            'user_id' => $user->id,
                            'time_entry_id' => $entry->id,
                            'type' => 'idle',
                        ],
                        [
                            'name' => 'System Idle',
                            'duration' => $minute * 60,
                            'recorded_at' => $now,
                        ],
                    );
                }

                $snapshot = $this->workedTime($user, $now);

                $this->assertLessThanOrEqual(
                    $previousRemaining,
                    $snapshot['remaining_seconds'],
                    sprintf(
                        'Shift Remaining increased at minute %d (%d -> %d). A countdown must never run backwards.',
                        $minute,
                        $previousRemaining,
                        $snapshot['remaining_seconds'],
                    ),
                );

                // billed_seconds is the high-water figure the countdown uses, so
                // it must never regress.
                $this->assertGreaterThanOrEqual(
                    $previousWorked,
                    $snapshot['billed_seconds'],
                    sprintf('Billed time decreased at minute %d. The countdown basis must never go down.', $minute),
                );

                // worked_seconds MAY correct downward — idle is only knowable
                // once the detection threshold has passed, at which point
                // provisionally-worked time is reclassified. That correction is
                // right, but it must be bounded by the threshold; a larger drop
                // means idle is being counted from outside the entry window.
                $maxCorrection = (int) config('time_tracking.idle_track_threshold_seconds', 180);
                $this->assertGreaterThanOrEqual(
                    $previousWorkedTruthful - $maxCorrection,
                    $snapshot['worked_seconds'],
                    sprintf(
                        'Worked time dropped by more than the idle threshold at minute %d (%d -> %d).',
                        $minute,
                        $previousWorkedTruthful,
                        $snapshot['worked_seconds'],
                    ),
                );

                $previousRemaining = $snapshot['remaining_seconds'];
                $previousWorked = $snapshot['billed_seconds'];
                $previousWorkedTruthful = $snapshot['worked_seconds'];
            }
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_worked_plus_idle_equals_track(): void
    {
        // The reconciliation identity. If this drifts, some consumer is adding
        // or subtracting a number nobody else knows about.
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00'));

        try {
            $user = $this->makeUser('worked-time-identity@example.com');

            $entry = TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'primary',
                'start_time' => '2026-05-10 09:00:00',
                'end_time' => '2026-05-10 11:00:00',
                'duration' => 7200,
                'billable' => true,
                'is_break' => false,
            ]);

            Activity::create([
                'user_id' => $user->id,
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'System Idle',
                'duration' => 1800,
                'recorded_at' => '2026-05-10 10:00:00',
            ]);

            $snapshot = $this->workedTime($user, Carbon::parse('2026-05-10 12:00:00'));

            $this->assertSame(7200, $snapshot['track_seconds']);
            $this->assertSame(1800, $snapshot['idle_seconds']);
            $this->assertSame(5400, $snapshot['worked_seconds']);
            $this->assertSame(
                $snapshot['track_seconds'],
                ($snapshot['worked_seconds'] - $snapshot['paid_break_seconds']) + $snapshot['idle_seconds'],
                'track must equal (worked - paid breaks) + idle',
            );
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_remaining_and_overtime_are_derived_from_the_same_worked_figure(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 21:00:00'));

        try {
            $user = $this->makeUser('worked-time-overtime@example.com');

            // A nine-hour day against an eight-hour shift.
            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'primary',
                'start_time' => '2026-05-10 09:00:00',
                'end_time' => '2026-05-10 18:00:00',
                'duration' => 32400,
                'billable' => true,
                'is_break' => false,
            ]);

            $snapshot = $this->workedTime($user, Carbon::parse('2026-05-10 21:00:00'));

            $this->assertSame(32400, $snapshot['worked_seconds']);
            $this->assertSame(0, $snapshot['remaining_seconds'], 'No shift left after nine hours');
            $this->assertSame(
                $snapshot['worked_seconds'] - $snapshot['shift_target_seconds'],
                $snapshot['overtime_seconds'],
                'Overtime must be worked minus target, from the same worked figure',
            );
            // Never both at once.
            $this->assertTrue(
                $snapshot['remaining_seconds'] === 0 || $snapshot['overtime_seconds'] === 0,
                'Remaining and overtime cannot both be non-zero',
            );
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_breaks_are_excluded_from_worked_time_and_not_double_counted(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-05-10 13:00:00'));

        try {
            $user = $this->makeUser('worked-time-break@example.com');

            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'primary',
                'start_time' => '2026-05-10 09:00:00',
                'end_time' => '2026-05-10 11:00:00',
                'duration' => 7200,
                'billable' => true,
                'is_break' => false,
            ]);

            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'break',
                'start_time' => '2026-05-10 11:00:00',
                'end_time' => '2026-05-10 11:30:00',
                'duration' => 1800,
                'billable' => false,
                'is_break' => true,
            ]);

            $snapshot = $this->workedTime($user, Carbon::parse('2026-05-10 13:00:00'));

            $this->assertSame(7200, $snapshot['worked_seconds'], 'The break must not count as worked');
            $this->assertSame(1800, $snapshot['break_seconds']);
            $this->assertSame(7200, $snapshot['track_seconds'], 'Track excludes breaks too');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_today_endpoint_serves_the_same_numbers_as_the_service(): void
    {
        // Guards against the endpoint quietly growing its own arithmetic again.
        Carbon::setTestNow(Carbon::parse('2026-05-10 12:00:00'));

        try {
            $user = $this->makeUser('worked-time-endpoint@example.com');

            TimeEntry::create([
                'user_id' => $user->id,
                'timer_slot' => 'primary',
                'start_time' => '2026-05-10 09:00:00',
                'end_time' => '2026-05-10 10:00:00',
                'duration' => 3600,
                'billable' => true,
                'is_break' => false,
            ]);

            $expected = $this->workedTime($user, Carbon::parse('2026-05-10 12:00:00'));

            $response = $this->getJson('/api/time-entries/today', $this->apiHeadersFor($user))->assertOk();

            $this->assertSame($expected['worked_seconds'], $response->json('worked_time.worked_seconds'));
            $this->assertSame($expected['remaining_seconds'], $response->json('worked_time.remaining_seconds'));
            $this->assertSame($expected['shift_target_seconds'], $response->json('worked_time.shift_target_seconds'));
        } finally {
            Carbon::setTestNow();
        }
    }
}
