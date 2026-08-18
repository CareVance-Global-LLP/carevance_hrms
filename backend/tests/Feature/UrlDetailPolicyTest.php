<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Monitoring\TrackerPolicyResolver;
use App\Support\CapturedUrl;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * How much of a visited address an organisation keeps.
 *
 * The product recorded whatever the browser reported, which is how a live OAuth
 * authorization code ended up in `activity_sessions.url` on 17 Aug 2026. The
 * credential half of that is now closed at every level and is not configurable.
 * What IS configurable is detail: some customers want the page, some only the
 * domain, some nothing at all.
 */
class UrlDetailPolicyTest extends TestCase
{
    use RefreshDatabase;

    private function actor(array $orgSettings = [], array $userSettings = []): array
    {
        $organization = Organization::create([
            'name' => 'CareVance Labs',
            'slug' => 'carevance-labs-'.uniqid(),
            'settings' => $orgSettings,
        ]);

        $user = User::create([
            'name' => 'Tracked Employee',
            'email' => uniqid('tracked').'@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
            'settings' => $userSettings,
        ]);

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 11:20:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        return [$user, $entry];
    }

    private function postVisit(User $user, TimeEntry $entry, string $url)
    {
        return $this->actingAs($user)->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'example.com',
            'app_name' => 'Google Chrome',
            'window_title' => 'A page',
            'url' => $url,
            'started_at' => '2026-04-21T11:28:54Z',
            'ended_at' => '2026-04-21T11:29:07Z',
        ]);
    }

    public function test_full_detail_keeps_the_path_but_never_the_query(): void
    {
        [$user, $entry] = $this->actor(['url_detail_level' => 'full']);

        $this->postVisit($user, $entry, 'https://example.com/docs/page?code=SECRET&state=abc')
            ->assertCreated()
            ->assertJsonPath('url', 'https://example.com/docs/page')
            ->assertJsonPath('activity_kind', 'website');
    }

    public function test_host_detail_reduces_a_visit_to_its_domain(): void
    {
        [$user, $entry] = $this->actor(['url_detail_level' => 'host']);

        $this->postVisit($user, $entry, 'https://example.com/private/salary-review')
            ->assertCreated()
            ->assertJsonPath('url', 'https://example.com');
    }

    public function test_addresses_off_records_the_browser_as_an_application(): void
    {
        /*
         * Not a website row with a null URL: that would contradict the rule
         * that a website session must name an address, and would read in a
         * report as a visit nobody can identify. The time is still recorded —
         * turning off addresses must not turn off tracking.
         */
        [$user, $entry] = $this->actor(['url_detail_level' => 'off']);

        $this->postVisit($user, $entry, 'https://example.com/private/salary-review')
            ->assertCreated()
            ->assertJsonPath('url', null)
            ->assertJsonPath('activity_kind', 'desktop_app')
            ->assertJsonPath('tool_type', 'software');
    }

    public function test_a_user_setting_overrides_the_organization(): void
    {
        // Same chain as every other tracker setting: per-user, then org.
        [$user, $entry] = $this->actor(['url_detail_level' => 'full'], ['url_detail_level' => 'host']);

        $this->postVisit($user, $entry, 'https://example.com/docs/page')
            ->assertCreated()
            ->assertJsonPath('url', 'https://example.com');
    }

    public function test_a_junk_user_value_falls_through_rather_than_bypassing_the_organization(): void
    {
        // A per-user value outside the allow-list must not silently widen what
        // the organisation chose.
        [$user, $entry] = $this->actor(['url_detail_level' => 'host'], ['url_detail_level' => 'everything']);

        $this->postVisit($user, $entry, 'https://example.com/docs/page')
            ->assertCreated()
            ->assertJsonPath('url', 'https://example.com');
    }

    public function test_the_default_is_unchanged_behaviour(): void
    {
        // No setting anywhere: keep the path, as the product already did.
        [$user, $entry] = $this->actor();

        $this->postVisit($user, $entry, 'https://example.com/docs/page')
            ->assertCreated()
            ->assertJsonPath('url', 'https://example.com/docs/page');
    }

    public function test_credentials_are_stripped_at_every_level(): void
    {
        // The one thing an organisation cannot opt into keeping.
        foreach ([TrackerPolicyResolver::URL_DETAIL_FULL, TrackerPolicyResolver::URL_DETAIL_HOST] as $level) {
            $stored = CapturedUrl::sanitize('https://idp.example.com/cb?code=SECRET&state=abc', $level);
            $this->assertStringNotContainsString('code=', (string) $stored, "level {$level} leaked a query string");
            $this->assertStringNotContainsString('SECRET', (string) $stored);
        }
    }
}
