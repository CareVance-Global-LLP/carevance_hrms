<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Reports\UsageProcessingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Inferred idle must obey the organization's "mark as idle after" setting.
 *
 * The reporting side used a flat 180 seconds from config — not settable per
 * organization, not even by environment: one literal in a file for every
 * tenant. So an organization that had chosen ten minutes still had its reports
 * treat any four-minute silence as idle, while the desktop tracker correctly
 * waited the full ten. The settings screen therefore described behaviour only
 * half the system followed.
 *
 * That is not confined to a report. Inferred idle is subtracted from worked
 * time, and worked time is what payroll pays against.
 */
class IdleThresholdRespectsOrganizationTest extends TestCase
{
    use RefreshDatabase;

    private function userWithIdleThreshold(?int $seconds, string $slug): User
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => $slug,
            'settings' => $seconds === null ? [] : ['idle_track_threshold_seconds' => $seconds],
        ]);

        return User::create([
            'name' => 'Employee',
            'email' => $slug.'@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    /**
     * One tracked hour containing a single six-minute silence.
     *
     * Six minutes sits deliberately between the old fixed threshold (3 min) and
     * a ten-minute setting, so the two answers differ. It is measured between
     * the END of one heartbeat's window and the START of the next, which is
     * what the gap check compares — each heartbeat covers the minute BEFORE its
     * recorded_at, so a hole of N minutes in the timestamps is a gap of N-1.
     */
    private function logsWithASixMinuteSilence(User $user): array
    {
        $start = now()->copy()->subHour()->startOfMinute();

        TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => $start->copy(),
            'end_time' => $start->copy()->addHour(),
            'duration' => 3600,
            'is_break' => false,
        ]);

        // Heartbeats every minute, with a hole from +5 to +12 — a six-minute
        // gap once each heartbeat's own minute-long window is accounted for.
        $minutes = array_merge(range(0, 5), range(12, 20));
        foreach ($minutes as $minute) {
            Activity::create([
                'user_id' => $user->id,
                'type' => 'app',
                'name' => 'Visual Studio Code',
                'app_name' => 'Visual Studio Code',
                'duration' => 60,
                'recorded_at' => $start->copy()->addMinutes($minute),
            ]);
        }

        return [$user, $start];
    }

    public function test_a_ten_minute_setting_does_not_call_a_six_minute_gap_idle(): void
    {
        $user = $this->userWithIdleThreshold(600, 'carevance-ten-minute');
        $this->logsWithASixMinuteSilence($user);

        $activities = Activity::where('user_id', $user->id)->get();
        $idle = app(UsageProcessingService::class)->calculateIdleTime($activities);

        $this->assertSame(
            0,
            $idle,
            'a six-minute gap was reported as idle even though the organization asks for ten minutes',
        );
    }

    public function test_a_three_minute_setting_does(): void
    {
        // The same data, the same code path — only the organization's setting
        // differs. This is what proves the setting is being read at all rather
        // than the first assertion passing for some unrelated reason.
        $user = $this->userWithIdleThreshold(180, 'carevance-three-minute');
        $this->logsWithASixMinuteSilence($user);

        $activities = Activity::where('user_id', $user->id)->get();
        $idle = app(UsageProcessingService::class)->calculateIdleTime($activities);

        $this->assertGreaterThan(
            0,
            $idle,
            'a six-minute gap was not reported as idle even though the organization asks for three minutes',
        );
    }

    public function test_an_unset_organization_keeps_the_previous_behaviour(): void
    {
        // No setting means no behaviour change for anyone who has not chosen
        // one: the config default still applies.
        $user = $this->userWithIdleThreshold(null, 'carevance-unset');
        $this->logsWithASixMinuteSilence($user);

        $activities = Activity::where('user_id', $user->id)->get();
        $idle = app(UsageProcessingService::class)->calculateIdleTime($activities);

        $this->assertGreaterThan(0, $idle, 'the config default stopped applying to an unconfigured organization');
    }
}
