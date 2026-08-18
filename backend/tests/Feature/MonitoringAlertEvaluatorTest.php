<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\MonitoringAlertRule;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Monitoring\MonitoringAlertEvaluator;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MonitoringAlertEvaluatorTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance Labs', 'slug' => 'carevance-labs']);
        $this->admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $this->organization->id,
        ]);
    }

    private function employee(string $name): User
    {
        return User::create([
            'name' => $name,
            'email' => strtolower(str_replace(' ', '.', $name)).'@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);
    }

    private function trackDay(User $user, Carbon $day, int $seconds, int $idleSeconds = 0): void
    {
        TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => $day->copy()->setTime(9, 0),
            'end_time' => $day->copy()->setTime(9, 0)->addSeconds($seconds),
            'duration' => $seconds,
            'idle_seconds' => $idleSeconds,
            'billable' => true,
        ]);
    }

    private function rule(string $metric, int $threshold, string $name = 'Rule'): MonitoringAlertRule
    {
        return MonitoringAlertRule::create([
            'organization_id' => $this->organization->id,
            'name' => $name,
            'metric' => $metric,
            'threshold' => $threshold,
            'is_enabled' => true,
        ]);
    }

    public function test_it_reports_somebody_who_tracked_nothing(): void
    {
        /*
         * The case this exists for. Every defect found on 17 Aug 2026 — a
         * capped analytics query, a stranded offline queue, a timer left
         * running overnight — showed up as an employee with no tracked time,
         * and looked exactly like a quiet day until somebody went looking.
         */
        $day = Carbon::parse('2026-08-16');
        $silent = $this->employee('Silent Employee');
        $working = $this->employee('Working Employee');
        $this->trackDay($working, $day, 6 * 3600);

        $this->rule(MonitoringAlertRule::METRIC_NO_ACTIVITY, 0, 'Nobody tracked anything');

        $result = app(MonitoringAlertEvaluator::class)->evaluateForDate($day);

        $this->assertSame(1, $result['rules']);
        $this->assertGreaterThan(0, $result['notifications']);

        $notification = AppNotification::withoutGlobalScopes()->where('user_id', $this->admin->id)->first();
        $this->assertNotNull($notification, 'the admin should have been told');
        $this->assertStringContainsString('Silent Employee', $notification->message);
        $this->assertStringNotContainsString('Working Employee', $notification->message);
        $this->assertSame($silent->id, $notification->meta['user_ids'][0]);
    }

    public function test_it_reports_a_short_day_against_a_threshold(): void
    {
        $day = Carbon::parse('2026-08-16');
        $short = $this->employee('Short Day');
        $full = $this->employee('Full Day');
        $this->trackDay($short, $day, 2 * 3600);
        $this->trackDay($full, $day, 8 * 3600);

        $this->rule(MonitoringAlertRule::METRIC_TRACKED_BELOW, 6 * 3600, 'Under six hours');

        app(MonitoringAlertEvaluator::class)->evaluateForDate($day);

        $notification = AppNotification::withoutGlobalScopes()->where('user_id', $this->admin->id)->first();
        $this->assertStringContainsString('Short Day', $notification->message);
        $this->assertStringNotContainsString('Full Day', $notification->message);
        // The rule explains itself in the alert rather than only naming itself.
        $this->assertStringContainsString('tracked less than 6h', $notification->message);
    }

    public function test_a_day_with_no_tracked_time_does_not_breach_an_idle_rule(): void
    {
        /*
         * Dividing idle by zero tracked would make every absent person breach
         * every idle rule, double-reporting them alongside the no-activity rule
         * and training people to ignore the alerts.
         */
        $day = Carbon::parse('2026-08-16');
        $this->employee('Absent Employee');

        $this->rule(MonitoringAlertRule::METRIC_IDLE_SHARE_ABOVE, 50, 'Mostly idle');

        $result = app(MonitoringAlertEvaluator::class)->evaluateForDate($day);

        $this->assertSame(0, $result['notifications']);
    }

    public function test_it_reports_a_genuinely_idle_day(): void
    {
        $day = Carbon::parse('2026-08-16');
        $idle = $this->employee('Idle Employee');
        $this->trackDay($idle, $day, 4 * 3600, 3 * 3600);

        $this->rule(MonitoringAlertRule::METRIC_IDLE_SHARE_ABOVE, 50, 'Mostly idle');

        app(MonitoringAlertEvaluator::class)->evaluateForDate($day);

        $notification = AppNotification::withoutGlobalScopes()->where('user_id', $this->admin->id)->first();
        $this->assertNotNull($notification);
        $this->assertStringContainsString('Idle Employee', $notification->message);
    }

    public function test_a_disabled_rule_is_not_evaluated(): void
    {
        $day = Carbon::parse('2026-08-16');
        $this->employee('Silent Employee');

        $rule = $this->rule(MonitoringAlertRule::METRIC_NO_ACTIVITY, 0);
        $rule->update(['is_enabled' => false]);

        $result = app(MonitoringAlertEvaluator::class)->evaluateForDate($day);

        $this->assertSame(0, $result['rules']);
        $this->assertSame(0, $result['notifications']);
    }

    public function test_a_quiet_day_raises_nothing(): void
    {
        // Silence is the normal case, and an alert that fires every day is one
        // nobody reads.
        $day = Carbon::parse('2026-08-16');
        $working = $this->employee('Working Employee');
        $this->trackDay($working, $day, 8 * 3600);

        $this->rule(MonitoringAlertRule::METRIC_TRACKED_BELOW, 6 * 3600);

        $result = app(MonitoringAlertEvaluator::class)->evaluateForDate($day);

        $this->assertSame(0, $result['notifications']);
        $this->assertSame(0, AppNotification::withoutGlobalScopes()->count());
    }

    public function test_the_command_evaluates_yesterday_by_default(): void
    {
        /*
         * Not today: "tracked less than six hours" is true of everybody at 9am,
         * and a rule that fires every morning is one people switch off.
         */
        Carbon::setTestNow('2026-08-17 07:00:00');

        try {
            $this->employee('Silent Employee');
            $this->rule(MonitoringAlertRule::METRIC_NO_ACTIVITY, 0);

            $this->artisan('monitoring:evaluate-alerts')
                ->expectsOutputToContain('2026-08-16')
                ->assertExitCode(0);
        } finally {
            Carbon::setTestNow();
        }
    }
}
