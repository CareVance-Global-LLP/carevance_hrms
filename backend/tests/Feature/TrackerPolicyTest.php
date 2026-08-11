<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Monitoring\MonitoringSettingsResolver;
use App\Services\Monitoring\TrackerPolicyResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * The tracker's policy has to come from one place.
 *
 * Idle thresholds were previously configured twice — client env vars and
 * server config — with nothing reconciling them, so a client set below the
 * server proposed idle stops that were rejected with 409 until it burned its
 * retry cap, and a client set above it left the cron as the only real rule.
 */
class TrackerPolicyTest extends TestCase
{
    use RefreshDatabase;

    private function makeOrganization(array $settings = []): Organization
    {
        return Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-policy-'.uniqid(),
            'settings' => $settings,
        ]);
    }

    private function makeUser(Organization $organization, array $settings = []): User
    {
        return User::create([
            'name' => 'Tracked Employee',
            'email' => 'policy-'.uniqid().'@carevance.test',
            'password' => bcrypt('secret-password'),
            'role' => 'employee',
            'organization_id' => $organization->id,
            'settings' => $settings,
        ]);
    }

    public function test_policy_resolves_user_over_organization_over_system(): void
    {
        $resolver = app(TrackerPolicyResolver::class);

        $organization = $this->makeOrganization(['idle_auto_stop_threshold_seconds' => 900]);

        $inheriting = $this->makeUser($organization);
        $this->assertSame(
            900,
            $resolver->resolveForUser($inheriting)['idle_auto_stop_threshold_seconds'],
            'a user with no override inherits the organization value'
        );

        $overriding = $this->makeUser($organization, ['idle_auto_stop_threshold_seconds' => 1200]);
        $this->assertSame(
            1200,
            $resolver->resolveForUser($overriding)['idle_auto_stop_threshold_seconds'],
            'a per-user override wins'
        );

        $noOrgSetting = $this->makeUser($this->makeOrganization());
        $this->assertSame(
            (int) config('time_tracking.idle_auto_stop_threshold_seconds'),
            $resolver->resolveForUser($noOrgSetting)['idle_auto_stop_threshold_seconds'],
            'with nothing set anywhere it falls through to system config'
        );
    }

    public function test_auto_stop_can_never_be_shorter_than_the_idle_record_threshold(): void
    {
        $resolver = app(TrackerPolicyResolver::class);

        // Deliberately inverted: stop sooner than idle is even recorded.
        $organization = $this->makeOrganization([
            'idle_track_threshold_seconds' => 900,
            'idle_auto_stop_threshold_seconds' => 300,
        ]);

        $policy = $resolver->resolveForUser($this->makeUser($organization));

        $this->assertGreaterThanOrEqual(
            $policy['idle_track_threshold_seconds'],
            $policy['idle_auto_stop_threshold_seconds'],
            'stopping a timer before any idle span was recorded leaves nothing to justify the stop'
        );
    }

    public function test_an_absurdly_short_threshold_is_rejected_not_clamped_silently(): void
    {
        $resolver = app(TrackerPolicyResolver::class);

        // 10 seconds would stop a timer while someone reads one sentence.
        $organization = $this->makeOrganization(['idle_auto_stop_threshold_seconds' => 10]);
        $policy = $resolver->resolveForUser($this->makeUser($organization));

        $this->assertSame(
            (int) config('time_tracking.idle_auto_stop_threshold_seconds'),
            $policy['idle_auto_stop_threshold_seconds'],
            'an out-of-band value falls back to config rather than being clamped to the floor'
        );
    }

    public function test_the_policy_ships_with_the_user_payload(): void
    {
        $organization = $this->makeOrganization();
        $user = $this->makeUser($organization);

        $response = $this->getJson('/api/auth/me', $this->apiHeadersFor($user))->assertOk();

        $policy = $response->json('tracker_policy') ?? $response->json('user.tracker_policy');
        $this->assertIsArray($policy, 'the client cannot resolve policy it is never sent');

        foreach ([
            'idle_track_threshold_seconds',
            'idle_auto_stop_threshold_seconds',
            'capture_interval_minutes',
            'screenshot_retention_days',
            'privacy',
        ] as $key) {
            $this->assertArrayHasKey($key, $policy, "policy is missing {$key}");
        }

        $this->assertArrayHasKey('blocked_apps', $policy['privacy']);
        $this->assertTrue($policy['privacy']['skip_on_private_browsing']);
    }

    public function test_per_minute_capture_is_no_longer_offered(): void
    {
        $allowed = app(MonitoringSettingsResolver::class)->allowedIntervals();

        $this->assertNotContains(1, $allowed, 'per-minute capture reads as continuous recording');
        $this->assertNotContains(3, $allowed);
        $this->assertContains(5, $allowed);
    }

    public function test_a_legacy_sub_five_minute_setting_now_inherits(): void
    {
        $resolver = app(MonitoringSettingsResolver::class);

        // Null means "inherit", which hands these users the organization
        // default their admin actually chose. That is deliberately preferred
        // over rounding up to the nearest allowed value: the org default is
        // almost always LESS frequent than the sub-5-minute setting it
        // replaces, so rounding would override a deliberate choice with a more
        // intrusive one.
        $this->assertNull($resolver->sanitize(1));
        $this->assertNull($resolver->sanitize(3));
        $this->assertSame(10, $resolver->sanitize(10));
        $this->assertNull($resolver->sanitize(null));
        $this->assertNull($resolver->sanitize('not a number'));
    }

    public function test_a_legacy_one_minute_user_ends_up_on_the_org_default(): void
    {
        $organization = $this->makeOrganization(['monitoring' => ['interval_minutes' => 15]]);
        $user = $this->makeUser($organization, ['monitoring_interval_minutes' => 1]);

        $this->assertSame(
            15,
            app(TrackerPolicyResolver::class)->resolveForUser($user)['capture_interval_minutes'],
            'a withdrawn per-minute setting falls back to what the organization chose'
        );
    }

    public function test_expired_screenshots_are_purged_with_their_files(): void
    {
        Storage::fake('screenshots');

        $organization = $this->makeOrganization(['screenshot_retention_days' => 30]);
        $user = $this->makeUser($organization);

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subDays(100),
            'end_time' => now()->subDays(100)->addHour(),
            'duration' => 3600,
            'timer_slot' => 'primary',
        ]);

        Storage::disk('screenshots')->put('old.jpg', 'old-bytes');
        Storage::disk('screenshots')->put('fresh.jpg', 'fresh-bytes');

        $old = Screenshot::create([
            'time_entry_id' => $entry->id,
            'filename' => 'old.jpg',
            'captured_at' => now()->subDays(45),
        ]);
        $fresh = Screenshot::create([
            'time_entry_id' => $entry->id,
            'filename' => 'fresh.jpg',
            'captured_at' => now()->subDays(2),
        ]);

        $this->artisan('screenshots:purge')->assertExitCode(0);

        $this->assertNull(Screenshot::find($old->id), 'the expired row is gone');
        $this->assertNotNull(Screenshot::find($fresh->id), 'a recent capture survives');

        Storage::disk('screenshots')->assertMissing('old.jpg');
        Storage::disk('screenshots')->assertExists('fresh.jpg');
    }

    public function test_retention_is_measured_from_capture_not_from_upload(): void
    {
        Storage::fake('screenshots');

        $organization = $this->makeOrganization(['screenshot_retention_days' => 30]);
        $user = $this->makeUser($organization);

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subDays(2),
            'end_time' => now()->subDays(2)->addHour(),
            'duration' => 3600,
            'timer_slot' => 'primary',
        ]);

        Storage::disk('screenshots')->put('buffered.jpg', 'bytes');

        // Taken 60 days ago, synced from the offline queue today. Measuring
        // age from created_at would silently extend the retention window by
        // however long the device stayed offline.
        $buffered = Screenshot::create([
            'time_entry_id' => $entry->id,
            'filename' => 'buffered.jpg',
            'captured_at' => now()->subDays(60),
        ]);

        $this->artisan('screenshots:purge')->assertExitCode(0);

        $this->assertNull(Screenshot::find($buffered->id));
    }

    public function test_a_dry_run_deletes_nothing(): void
    {
        Storage::fake('screenshots');

        $organization = $this->makeOrganization(['screenshot_retention_days' => 7]);
        $user = $this->makeUser($organization);

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subDays(40),
            'end_time' => now()->subDays(40)->addHour(),
            'duration' => 3600,
            'timer_slot' => 'primary',
        ]);

        Storage::disk('screenshots')->put('keep.jpg', 'bytes');
        $screenshot = Screenshot::create([
            'time_entry_id' => $entry->id,
            'filename' => 'keep.jpg',
            'captured_at' => now()->subDays(40),
        ]);

        $this->artisan('screenshots:purge --dry-run')->assertExitCode(0);

        $this->assertNotNull(Screenshot::find($screenshot->id));
        Storage::disk('screenshots')->assertExists('keep.jpg');
    }
}
