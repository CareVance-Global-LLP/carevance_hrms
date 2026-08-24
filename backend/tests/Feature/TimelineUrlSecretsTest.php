<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Credentials must not reach the timeline.
 *
 * The desktop agent has stripped query strings out of captured URLs since
 * 17 Aug 2026 (normalize-captured-url.cjs), but that only protects rows written
 * after it shipped. Rows recorded before it are still in the database and were
 * still being rendered in full: read out of a live install on 20 Aug 2026, the
 * timeline was showing two complete OAuth callbacks — a live `code` plus
 * `state` — to every admin who opened the page, and to anyone who exported it.
 *
 * The rule is therefore enforced again at the point of display, where it covers
 * history as well as new writes.
 *
 * Assertions read the DECODED name rather than the response string: JSON escapes
 * forward slashes, so a raw-body substring check silently fails on every URL and
 * would have to be loosened until it no longer proved anything.
 */
class TimelineUrlSecretsTest extends TestCase
{
    use RefreshDatabase;

    private const OAUTH_CALLBACK = 'https://mcp.expo.dev/auth/expo-callback?code=043bc167-f430-4283-8b2d-ffb9d74b04de&state=PbABmJzitS8';

    public function test_a_query_string_never_reaches_the_raw_timeline(): void
    {
        $headers = $this->createAdminWithVisit(self::OAUTH_CALLBACK);

        // The path still says which page they were on, which is all a report
        // needs; the single-use credential is gone.
        $this->assertSame(
            'https://mcp.expo.dev/auth/expo-callback',
            $this->firstName('/api/activities?per_page=50', $headers),
        );
    }

    public function test_a_query_string_never_reaches_the_processed_timeline(): void
    {
        $headers = $this->createAdminWithVisit(self::OAUTH_CALLBACK);

        $name = $this->firstName('/api/activities?processed=1&per_page=50', $headers);

        $this->assertStringNotContainsString('043bc167', $name, 'a live authorization code reached the processed timeline');
        $this->assertStringNotContainsString('state=', $name);
        $this->assertStringContainsString('mcp.expo.dev/auth/expo-callback', $name);
    }

    public function test_a_hash_route_survives(): void
    {
        // Hash routing puts the real page in the fragment, so it is kept —
        // losing it would collapse every page of a hash-routed app into one row.
        $headers = $this->createAdminWithVisit('https://mail.google.com/mail/u/0/#inbox/FMfcgzQhVrKdd');

        $this->assertSame(
            'https://mail.google.com/mail/u/0/#inbox/FMfcgzQhVrKdd',
            $this->firstName('/api/activities?per_page=50', $headers),
        );
    }

    public function test_a_hash_carrying_key_value_pairs_is_dropped(): void
    {
        // The OAuth implicit flow returns access_token in the fragment, so a
        // fragment holding key=value pairs is a credential, not a route.
        $headers = $this->createAdminWithVisit('https://example.test/cb#access_token=SECRETVALUE123');

        $name = $this->firstName('/api/activities?per_page=50', $headers);

        $this->assertStringNotContainsString('SECRETVALUE123', $name, 'an implicit-flow token reached the timeline');
        $this->assertSame('https://example.test/cb', $name);
    }

    public function test_an_ordinary_window_title_is_left_alone(): void
    {
        // Most names are a window title, not an address, and must pass through
        // untouched — including ones that happen to contain punctuation.
        $title = 'useDesktopTracker.ts - CareVance - Visual Studio Code';
        $headers = $this->createAdminWithVisit($title, 'app');

        $this->assertSame($title, $this->firstName('/api/activities?per_page=50', $headers));
    }

    /** The `name` of the first row the endpoint returns. */
    private function firstName(string $url, array $headers): string
    {
        $data = $this->getJson($url, $headers)->assertOk()->json('data');
        $this->assertNotEmpty($data, 'the timeline returned no rows to assert on');

        return (string) ($data[0]['name'] ?? '');
    }

    /** @return array<string, string> */
    private function createAdminWithVisit(string $name, string $type = 'url'): array
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-timeline-secrets',
        ]);

        $user = User::create([
            'name' => 'Admin',
            'email' => 'admin@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        // Stamps organization_id the same way BelongsToOrganization would
        // from a real authenticated request.
        Auth::setUser($user);

        Activity::create([
            'user_id' => $user->id,
            'type' => $type,
            'name' => $name,
            'duration' => 120,
            'recorded_at' => '2026-08-19 10:00:00',
        ]);

        return $this->apiHeadersFor($user);
    }
}
