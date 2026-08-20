<?php

namespace Tests\Feature;

use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * What the timeline calls a website visit.
 *
 * Reported 19 Aug 2026: "I used so many websites like insta and facebook and it
 * shows Google Chrome only". The desktop agent fills `display_name` from the
 * foreground process, which for any browser is the browser, and the feed
 * preferred that field unconditionally — so every website row in the timeline
 * read "Google Chrome" regardless of the site.
 *
 * Confirmed in the data before the fix: five consecutive Gmail sessions all
 * carried `display_name = 'Google Chrome'` while `normalized_domain` had held
 * `mail.google.com` the whole time. The name was recoverable from the row
 * itself, which is why this is fixed on read — every session already stored is
 * named correctly without a re-import or a new desktop build.
 */
class TimelineWebsiteNamingTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_website_session_is_named_after_the_site_not_the_browser(): void
    {
        [$user, $headers] = $this->createEmployee();

        // Non-overlapping: the feed collapses sessions that occupy the same
        // window, which would otherwise hide one of the two behind the other.
        $this->recordWebsiteSession($user, 'instagram.com', 'https://instagram.com/', '10:00:00', '10:04:00');
        $this->recordWebsiteSession($user, 'facebook.com', 'https://facebook.com/', '10:10:00', '10:14:00');

        $names = collect($this->timelineRows($headers))->pluck('name');

        $this->assertTrue($names->contains('instagram.com'), 'expected the Instagram visit to be named after the site, got: '.$names->implode(', '));
        $this->assertTrue($names->contains('facebook.com'), 'expected the Facebook visit to be named after the site, got: '.$names->implode(', '));
        $this->assertFalse($names->contains('Google Chrome'), 'a website visit must not be named after the browser that opened it');
    }

    public function test_an_application_session_is_still_named_after_the_application(): void
    {
        [$user, $headers] = $this->createEmployee();

        // The other half of the rule: outside a browser the process name is the
        // right answer, and narrowing the website case must not disturb it.
        ActivitySession::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Visual Studio Code',
            'app_name' => 'Visual Studio Code',
            'window_title' => 'useDesktopTracker.ts',
            'normalized_label' => 'vscode',
            'normalized_domain' => null,
            'started_at' => '2026-08-19 10:00:00',
            'ended_at' => '2026-08-19 10:05:00',
        ]);

        $names = collect($this->timelineRows($headers))->pluck('name');

        $this->assertTrue($names->contains('Visual Studio Code'), 'got: '.$names->implode(', '));
    }

    public function test_a_website_with_no_readable_host_falls_back_to_the_browser(): void
    {
        [$user, $headers] = $this->createEmployee();

        // 'unknown-site' is the normalizer's own placeholder for a URL it could
        // not read a host out of. Showing that to somebody reading a report is
        // worse than naming the browser, which is at least true.
        ActivitySession::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'Google Chrome',
            'app_name' => 'Google Chrome',
            'window_title' => 'New Tab',
            'normalized_label' => 'unknown-site',
            'normalized_domain' => null,
            'started_at' => '2026-08-19 10:00:00',
            'ended_at' => '2026-08-19 10:01:00',
        ]);

        $names = collect($this->timelineRows($headers))->pluck('name');

        $this->assertTrue($names->contains('Google Chrome'), 'got: '.$names->implode(', '));
        $this->assertFalse($names->contains('unknown-site'), 'the normalizer placeholder must never reach a report');
    }

    private function recordWebsiteSession(User $user, string $domain, string $url, string $from, string $to): void
    {
        ActivitySession::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            // Exactly what the desktop agent sends: the browser, every time.
            'display_name' => 'Google Chrome',
            'app_name' => 'Google Chrome',
            'window_title' => $domain.' - Google Chrome',
            'url' => $url,
            'normalized_label' => $domain,
            'normalized_domain' => $domain,
            'started_at' => '2026-08-19 '.$from,
            'ended_at' => '2026-08-19 '.$to,
        ]);
    }

    /** @return array<int, array<string, mixed>> */
    private function timelineRows(array $headers): array
    {
        return $this->getJson(
            '/api/activities?start_date=2026-08-19&end_date=2026-08-19&processed=true',
            $headers
        )->assertOk()->json('data') ?? [];
    }

    /** @return array{0: User, 1: array<string, string>} */
    private function createEmployee(): array
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $user = User::create([
            'name' => 'Aayush',
            'email' => 'aayush@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        return [$user, $this->apiHeadersFor($user)];
    }
}
