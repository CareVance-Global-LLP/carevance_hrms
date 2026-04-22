<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ActivityTimelineProcessingTest extends TestCase
{
    use RefreshDatabase;

    public function test_processed_activity_timeline_collapses_cumulative_snapshot_rows(): void
    {
        $organization = Organization::create(['name' => 'CareVance Labs', 'slug' => 'carevance-labs']);
        $user = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 10:00:00',
            'end_time' => '2026-04-21 10:05:00',
            'duration' => 300,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Codex',
            'app_name' => 'Codex',
            'window_title' => 'Codex',
            'duration' => 10,
            'recorded_at' => '2026-04-21 10:00:10',
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Codex',
            'app_name' => 'Codex',
            'window_title' => 'Codex',
            'duration' => 20,
            'recorded_at' => '2026-04-21 10:00:20',
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Codex',
            'app_name' => 'Codex',
            'window_title' => 'Codex',
            'duration' => 30,
            'recorded_at' => '2026-04-21 10:00:30',
        ]);

        $response = $this->getJson('/api/activities?processed=1&per_page=50', $this->apiHeadersFor($user));

        $response->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.type', 'app')
            ->assertJsonPath('data.0.duration', 30)
            ->assertJsonPath('data.0.software_name', 'vscode')
            ->assertJsonPath('data.0.tool_type', 'software')
            ->assertJsonPath('data.0.classification', 'productive')
            ->assertJsonPath('data.0.user.name', 'Admin User');
    }

    public function test_raw_activity_timeline_handles_snapshot_rows_without_exact_session_timestamps(): void
    {
        $organization = Organization::create(['name' => 'CareVance Labs', 'slug' => 'carevance-labs']);
        $user = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 10:00:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Instagram',
            'app_name' => 'chrome',
            'window_title' => 'Instagram',
            'url' => 'https://www.instagram.com/',
            'duration' => 15,
            'recorded_at' => '2026-04-21 10:00:15',
        ]);

        $this->getJson('/api/activities?per_page=50', $this->apiHeadersFor($user))
            ->assertOk()
            ->assertJsonPath('data.0.name', 'Instagram')
            ->assertJsonPath('data.0.started_at', null)
            ->assertJsonPath('data.0.ended_at', null);
    }

    public function test_raw_activity_timeline_clips_stale_open_browser_sessions_at_next_session_start(): void
    {
        $organization = Organization::create(['name' => 'CareVance Labs', 'slug' => 'carevance-labs']);
        $user = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 10:00:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
        ]);

        ActivitySession::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'source' => 'browser_extension',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'Instagram',
            'app_name' => 'chrome',
            'window_title' => 'Instagram',
            'url' => 'https://www.instagram.com/',
            'started_at' => '2026-04-21 10:00:00',
            'ended_at' => null,
            'duration_seconds' => 0,
        ]);

        ActivitySession::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'source' => 'browser_extension',
            'activity_kind' => 'website',
            'tool_type' => 'website',
            'display_name' => 'CareVance HRMS Workspace',
            'app_name' => 'chrome',
            'window_title' => 'CareVance HRMS Workspace',
            'url' => 'http://localhost:5173/reports/timeline',
            'started_at' => '2026-04-21 10:00:30',
            'ended_at' => null,
            'duration_seconds' => 0,
        ]);

        $response = $this->getJson('/api/activities?per_page=50', $this->apiHeadersFor($user));

        $response->assertOk()
            ->assertJsonFragment([
                'name' => 'Instagram',
                'duration' => 30,
            ]);
    }
}
