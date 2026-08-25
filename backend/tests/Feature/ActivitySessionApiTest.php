<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ActivitySessionApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_employee_can_start_and_finish_a_desktop_activity_session(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 09:00:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $startResponse = $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Visual Studio Code',
            'app_name' => 'Visual Studio Code',
            'window_title' => 'Tracking Work',
            'started_at' => '2026-04-21T09:00:00Z',
            'confidence' => 100,
        ], $headers);

        $startResponse
            ->assertCreated()
            ->assertJsonPath('display_name', 'Visual Studio Code')
            ->assertJsonPath('started_at', '2026-04-21T09:00:00.000000Z')
            ->assertJsonPath('ended_at', null);

        $sessionId = (int) $startResponse->json('id');

        $this->patchJson("/api/activity-sessions/{$sessionId}", [
            'ended_at' => '2026-04-21T09:07:00Z',
        ], $headers)
            ->assertOk()
            ->assertJsonPath('duration_seconds', 420);
    }

    public function test_employee_can_finish_a_desktop_activity_session_with_fractional_end_time(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 09:00:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $startResponse = $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Visual Studio Code',
            'app_name' => 'Visual Studio Code',
            'window_title' => 'Tracking Work',
            'started_at' => '2026-04-21T09:00:00.000Z',
            'confidence' => 100,
        ], $headers);

        $sessionId = (int) $startResponse->json('id');

        $this->patchJson("/api/activity-sessions/{$sessionId}", [
            'ended_at' => '2026-04-21T09:00:01.154Z',
        ], $headers)
            ->assertOk()
            ->assertJsonPath('duration_seconds', 1);
    }

    public function test_activity_index_includes_desktop_sessions_in_timeline_order(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 09:00:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $sessionResponse = $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Visual Studio Code',
            'app_name' => 'Visual Studio Code',
            'window_title' => 'Tracking Work',
            'started_at' => '2026-04-21T09:00:00Z',
            'ended_at' => '2026-04-21T09:07:00Z',
            'confidence' => 100,
        ], $headers)
            ->assertCreated();

        $this->getJson('/api/activities?start_date=2026-04-21&end_date=2026-04-21', $headers)
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Visual Studio Code')
            ->assertJsonPath('data.0.duration', 420)
            ->assertJsonPath('data.0.source', 'activity_session');
    }

    public function test_desktop_codex_session_is_normalized_for_timeline_and_web_app_usage(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();
        $user->forceFill(['role' => 'admin'])->save();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 09:00:00',
            'end_time' => '2026-04-21 09:01:00',
            'duration' => 60,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Codex',
            'app_name' => 'Codex',
            'window_title' => 'Codex',
            'started_at' => '2026-04-21T09:00:00Z',
            'ended_at' => '2026-04-21T09:01:00Z',
            'confidence' => 100,
        ], $headers)
            ->assertCreated()
            ->assertJsonPath('normalized_label', 'codex')
            ->assertJsonPath('software_name', 'codex')
            ->assertJsonPath('classification', 'productive');

        $this->getJson('/api/activities?start_date=2026-04-21&end_date=2026-04-21&processed=1', $headers)
            ->assertOk()
            ->assertJsonPath('data.0.software_name', 'codex')
            ->assertJsonPath('data.0.duration', 60)
            ->assertJsonPath('data.0.classification', 'productive');

        $this->getJson('/api/reports/employee-insights?start_date=2026-04-21&end_date=2026-04-21&user_id='.$user->id, $headers)
            ->assertOk()
            ->assertJsonPath('selected_user_tools.productive.0.label', 'codex')
            ->assertJsonPath('selected_user_tools.productive.0.type', 'software')
            ->assertJsonPath('selected_user_tools.productive.0.total_duration', 60);
    }

    /**
     * The desktop agent reads browser URLs itself now, so it writes website
     * sessions too. This rule pinned the source to the extension, back when the
     * extension was the only thing that could know a URL, and it silently
     * rejected every browser session the desktop agent sent — the tracker
     * queues a failed create rather than reporting it, so browser time did not
     * error, it just stopped existing. Measured 14 Aug 2026: Chrome and Edge
     * each held in the foreground for twelve seconds twice over produced two
     * Visual Studio Code rows and nothing else.
     */
    public function test_desktop_agent_can_store_an_exact_website_session(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 11:20:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $response = $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'developer.mozilla.org',
            'app_name' => 'Microsoft Edge',
            'window_title' => 'Fetch API - Web APIs | MDN',
            'url' => 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
            'started_at' => '2026-04-21T11:28:54Z',
            'ended_at' => '2026-04-21T11:29:07Z',
        ], $headers);

        $response
            ->assertCreated()
            ->assertJsonPath('source', 'desktop')
            ->assertJsonPath('activity_kind', 'website')
            ->assertJsonPath('tool_type', 'website')
            ->assertJsonPath('normalized_domain', 'developer.mozilla.org');
    }

    /**
     * The URL requirement is the half of that rule worth keeping: a website row
     * with no address names nothing, whichever writer sent it.
     */
    public function test_a_website_session_without_a_url_is_still_refused(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 11:20:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'Google Chrome',
            'app_name' => 'Google Chrome',
            'window_title' => 'New Tab',
            'started_at' => '2026-04-21T11:28:54Z',
            'ended_at' => '2026-04-21T11:29:07Z',
        ], $headers)->assertStatus(422);
    }

    public function test_starting_a_new_browser_session_closes_previous_open_browser_session(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 11:20:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $firstResponse = $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'Instagram',
            'app_name' => 'chrome',
            'window_title' => 'Instagram',
            'url' => 'https://www.instagram.com/',
            'started_at' => '2026-04-21T11:28:00Z',
        ], $headers)->assertCreated();

        $firstId = (int) $firstResponse->json('id');

        $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'CareVance HRMS Workspace',
            'app_name' => 'chrome',
            'window_title' => 'CareVance HRMS Workspace',
            'url' => 'http://localhost:5173/reports/timeline',
            'started_at' => '2026-04-21T11:28:30Z',
        ], $headers)->assertCreated();

        $this->getJson('/api/activities?start_date=2026-04-21&end_date=2026-04-21', $headers)
            ->assertOk()
            ->assertJsonFragment([
                'id' => $firstId,
                'duration' => 30,
            ]);
    }

    public function test_exact_website_session_requires_a_real_url(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 11:20:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'Browser Activity',
            'started_at' => '2026-04-21T11:28:54Z',
        ], $headers)->assertStatus(422);
    }

    private function createAuthenticatedEmployee(): array
    {
        $organization = Organization::create([
            'name' => 'CareVance Org',
            'slug' => 'carevance-org',
        ]);

        $user = User::create([
            'name' => 'Ayush',
            'email' => 'ayush@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        // Stamps organization_id on every fixture the test creates directly
        // after this call, the same way BelongsToOrganization would from a
        // real authenticated request.
        Auth::setUser($user);

        return [$user, $this->apiHeadersFor($user)];
    }

    /**
     * Sanitised server-side as well as on the desktop.
     *
     * Found in the live database on 17 Aug 2026: one captured visit holding a
     * complete OAuth callback — `code` (66 characters), `state`,
     * `session_state` and `iss`. Readable by every admin who opens the
     * timeline and included in CSV exports. The desktop strips these now, but
     * an older build or a replayed offline queue can still post a raw URL, so
     * the server must not depend on the client having done it.
     */
    public function test_a_captured_url_is_stored_without_its_query_string(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 11:20:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $response = $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'idp.example.com',
            'app_name' => 'Google Chrome',
            'window_title' => 'Signing in',
            'url' => 'https://idp.example.com/callback?code=4%2F0AY0e-g7SECRETVALUE&state=abc123&session_state=xyz',
            'started_at' => '2026-04-21T11:28:54Z',
            'ended_at' => '2026-04-21T11:29:07Z',
        ], $headers);

        $response->assertCreated();

        $stored = (string) $response->json('url');
        $this->assertSame('https://idp.example.com/callback', $stored);
        $this->assertStringNotContainsString('code=', $stored);
        $this->assertStringNotContainsString('SECRETVALUE', $stored);
    }

    public function test_a_captured_url_keeps_the_page_it_names(): void
    {
        // Stripping must not reduce every single-page app to a bare host: hash
        // routing puts the real page in the fragment.
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 11:20:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $response = $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'keka',
            'app_name' => 'Google Chrome',
            'window_title' => 'Attendance',
            'url' => 'https://example-hr.example.com/#/me/attendance',
            'started_at' => '2026-04-21T11:28:54Z',
            'ended_at' => '2026-04-21T11:29:07Z',
        ], $headers);

        $response->assertCreated()
            ->assertJsonPath('url', 'https://example-hr.example.com/#/me/attendance');
    }
}
