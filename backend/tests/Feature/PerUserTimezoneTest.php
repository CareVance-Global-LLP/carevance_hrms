<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Attendance\AttendanceService;
use App\Services\Attendance\UserTimezoneResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Tests\TestCase;

/**
 * Per-employee timezone on the activity and report paths.
 *
 * `ExternalTimestamp` used to resolve every zone from `config('app.timezone')`,
 * so a tenant outside the app default saw Timeline rendered in the wrong wall
 * clock and — worse — had their per-user-per-day report rows bucketed under the
 * wrong calendar date. A day key computed in the wrong zone silently moves work
 * between days; nothing downstream can detect it.
 *
 * The app default is pinned to UTC here rather than left to `.env` so the
 * assertions describe a real difference between two users instead of whatever
 * `APP_TIMEZONE` happens to be on the machine running the suite.
 */
class PerUserTimezoneTest extends TestCase
{
    use RefreshDatabase;

    private string $originalTimezone;

    protected function setUp(): void
    {
        parent::setUp();

        $this->originalTimezone = date_default_timezone_get();
        config(['app.timezone' => 'UTC']);
        date_default_timezone_set('UTC');
    }

    protected function tearDown(): void
    {
        date_default_timezone_set($this->originalTimezone);

        parent::tearDown();
    }

    private function makeOrganization(array $settings = []): Organization
    {
        return Organization::create([
            'name' => 'CareVance Labs',
            'slug' => 'carevance-labs-'.uniqid(),
            'settings' => $settings,
        ]);
    }

    private function makeUser(Organization $organization, string $email, string $role = 'employee', array $settings = []): User
    {
        $user = User::create([
            'name' => 'User '.$email,
            'email' => $email,
            'password' => 'password123',
            'role' => $role,
            'organization_id' => $organization->id,
            'settings' => $settings,
        ]);

        // Stamps organization_id on fixtures the test creates directly after
        // this call, the same way BelongsToOrganization would from a real
        // authenticated request. Whichever user was created last stays the
        // ambient actor, which is correct as long as later fixtures in the
        // same test belong to this same organization.
        Auth::setUser($user);

        return $user;
    }

    public function test_resolver_prefers_employee_work_info_timezone(): void
    {
        $organization = $this->makeOrganization(['timezone' => 'Europe/Berlin']);
        $user = $this->makeUser($organization, 'tokyo@example.com', 'employee', ['timezone' => 'America/New_York']);

        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'expected_timezone' => 'Asia/Tokyo',
        ]);

        $this->assertSame('Asia/Tokyo', app(UserTimezoneResolver::class)->forUser($user->fresh()));
    }

    public function test_resolver_falls_back_through_user_then_org_then_app_default(): void
    {
        $organization = $this->makeOrganization(['timezone' => 'Europe/Berlin']);

        $userScoped = $this->makeUser($organization, 'user-scoped@example.com', 'employee', ['timezone' => 'America/New_York']);
        $orgScoped = $this->makeUser($organization, 'org-scoped@example.com');

        $bareOrganization = $this->makeOrganization();
        $bare = $this->makeUser($bareOrganization, 'bare@example.com');

        $resolver = app(UserTimezoneResolver::class);

        $this->assertSame('America/New_York', $resolver->forUser($userScoped->fresh()));
        $this->assertSame('Europe/Berlin', $resolver->forUser($orgScoped->fresh()));
        $this->assertSame(config('app.timezone'), $resolver->forUser($bare->fresh()));
        $this->assertSame(config('app.timezone'), $resolver->forUser(null));
    }

    public function test_resolver_resolves_by_id_without_a_hydrated_model(): void
    {
        $organization = $this->makeOrganization();
        $user = $this->makeUser($organization, 'by-id@example.com');

        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'expected_timezone' => 'Asia/Tokyo',
        ]);

        $this->actingAs($user);

        $resolver = app(UserTimezoneResolver::class);

        $this->assertSame('Asia/Tokyo', $resolver->forUserId((int) $user->id));
        $this->assertSame(
            ['Asia/Tokyo'],
            array_values($resolver->forUserIds([$user->id]))
        );
        $this->assertSame(config('app.timezone'), $resolver->forUserId(null));
    }

    public function test_attendance_today_still_reports_the_resolved_timezone(): void
    {
        $organization = $this->makeOrganization(['timezone' => 'Europe/Berlin']);
        $user = $this->makeUser($organization, 'attendance@example.com');

        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'expected_timezone' => 'Asia/Tokyo',
        ]);

        $payload = app(AttendanceService::class)->todayPayload($user->fresh());

        $this->assertSame('Asia/Tokyo', $payload['timezone']);
    }

    public function test_overall_report_buckets_each_user_day_in_that_users_timezone(): void
    {
        $organization = $this->makeOrganization();
        $admin = $this->makeUser($organization, 'admin@example.com', 'admin');
        $tokyo = $this->makeUser($organization, 'tokyo-report@example.com');
        $default = $this->makeUser($organization, 'default-report@example.com');

        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $tokyo->id,
            'expected_timezone' => 'Asia/Tokyo',
        ]);

        // 22:00 UTC on 21 Apr is 07:00 on 22 Apr in Tokyo. Same instant, two
        // different calendar days — which is exactly the misattribution a
        // config-wide zone cannot express.
        foreach ([$tokyo, $default] as $employee) {
            TimeEntry::create([
                'user_id' => $employee->id,
                'start_time' => '2026-04-21 22:00:00',
                'end_time' => '2026-04-21 23:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);
        }

        $response = $this->getJson(
            '/api/reports/overall?start_date=2026-04-20&end_date=2026-04-23',
            $this->apiHeadersFor($admin)
        )->assertOk();

        $rows = collect($response->json('by_user_day'))
            ->mapWithKeys(fn (array $row) => [(int) $row['user_id'] => (string) $row['date']]);

        $this->assertSame('2026-04-22', $rows->get((int) $tokyo->id));
        $this->assertSame('2026-04-21', $rows->get((int) $default->id));
    }

    public function test_processed_timeline_renders_timestamps_in_the_viewed_users_timezone(): void
    {
        $organization = $this->makeOrganization();
        $admin = $this->makeUser($organization, 'timeline-admin@example.com', 'admin');
        $tokyo = $this->makeUser($organization, 'timeline-tokyo@example.com');
        $default = $this->makeUser($organization, 'timeline-default@example.com');

        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $tokyo->id,
            'expected_timezone' => 'Asia/Tokyo',
        ]);

        foreach ([$tokyo, $default] as $employee) {
            $entry = TimeEntry::create([
                'user_id' => $employee->id,
                'start_time' => '2026-04-21 22:00:00',
                'end_time' => '2026-04-21 23:00:00',
                'duration' => 3600,
                'billable' => true,
            ]);

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'app',
                'name' => 'Codex',
                'app_name' => 'Codex',
                'window_title' => 'Codex',
                'duration' => 60,
                'recorded_at' => '2026-04-21 22:10:00',
            ]);
        }

        $response = $this->getJson(
            '/api/activities?processed=1&per_page=50&start_date=2026-04-20&end_date=2026-04-23',
            $this->apiHeadersFor($admin)
        )->assertOk();

        $recordedAtByUser = collect($response->json('data'))
            ->mapWithKeys(fn (array $row) => [(int) $row['user_id'] => (string) $row['recorded_at']]);

        $this->assertSame('2026-04-22T07:10:00+09:00', $recordedAtByUser->get((int) $tokyo->id));
        $this->assertSame('2026-04-21T22:10:00+00:00', $recordedAtByUser->get((int) $default->id));
    }

    public function test_idle_day_rollup_uses_the_users_timezone(): void
    {
        $organization = $this->makeOrganization();
        $admin = $this->makeUser($organization, 'idle-admin@example.com', 'admin');
        $tokyo = $this->makeUser($organization, 'idle-tokyo@example.com');

        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $tokyo->id,
            'expected_timezone' => 'Asia/Tokyo',
        ]);

        $entry = TimeEntry::create([
            'user_id' => $tokyo->id,
            'start_time' => '2026-04-21 22:00:00',
            'end_time' => '2026-04-21 23:00:00',
            'duration' => 3600,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $tokyo->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'System Idle',
            'duration' => 600,
            'recorded_at' => '2026-04-21 22:30:00',
        ]);

        $response = $this->getJson(
            '/api/reports/overall?start_date=2026-04-20&end_date=2026-04-23',
            $this->apiHeadersFor($admin)
        )->assertOk();

        $idleRow = collect($response->json('by_user_day'))
            ->first(fn (array $row) => (int) $row['user_id'] === (int) $tokyo->id && (int) ($row['idle_duration'] ?? 0) > 0);

        $this->assertNotNull($idleRow, 'expected an idle bucket for the Tokyo user');
        $this->assertSame('2026-04-22', (string) $idleRow['date']);
    }
}
