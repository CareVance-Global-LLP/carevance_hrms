<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
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

    public function test_browser_extension_can_store_an_exact_website_session(): void
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
            'source' => 'browser_extension',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'Gemini',
            'app_name' => 'chrome',
            'window_title' => 'Gemini',
            'url' => 'https://gemini.google.com/app',
            'started_at' => '2026-04-21T11:28:54Z',
            'ended_at' => '2026-04-21T11:29:05Z',
            'metadata' => [
                'profile_key' => 'profile-a',
                'tab_id' => 91,
                'window_id' => 5,
            ],
        ], $headers);

        $response
            ->assertCreated()
            ->assertJsonPath('source', 'browser_extension')
            ->assertJsonPath('tool_type', 'website')
            ->assertJsonPath('normalized_domain', 'gemini.google.com');
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
            'source' => 'browser_extension',
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
            'source' => 'browser_extension',
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
            'source' => 'browser_extension',
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

        return [$user, $this->apiHeadersFor($user)];
    }
}
