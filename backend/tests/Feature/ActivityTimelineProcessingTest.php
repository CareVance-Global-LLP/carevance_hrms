<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Carbon;
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
            ->assertJsonPath('data.0.software_name', 'codex')
            ->assertJsonPath('data.0.tool_type', 'software')
            ->assertJsonPath('data.0.classification', 'productive')
            ->assertJsonPath('data.0.user.name', 'Admin User');
    }

    public function test_processed_timeline_keeps_desktop_activity_session_duration_and_codex_label(): void
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
            'end_time' => '2026-04-21 10:01:00',
            'duration' => 60,
            'billable' => true,
        ]);

        ActivitySession::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Codex',
            'app_name' => 'Codex',
            'window_title' => 'Codex',
            'started_at' => '2026-04-21 10:00:00',
            'ended_at' => '2026-04-21 10:01:00',
            'duration_seconds' => 60,
            'normalized_label' => 'codex',
            'software_name' => 'codex',
            'classification' => 'productive',
        ]);

        $this->getJson('/api/activities?processed=1&per_page=50', $this->apiHeadersFor($user))
            ->assertOk()
            ->assertJsonPath('data.0.type', 'app')
            ->assertJsonPath('data.0.duration', 60)
            ->assertJsonPath('data.0.software_name', 'codex')
            ->assertJsonPath('data.0.tool_type', 'software')
            ->assertJsonPath('data.0.classification', 'productive');
    }

    public function test_processed_timeline_paginates_after_hidden_workspace_rows_are_removed(): void
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
            'end_time' => '2026-04-21 10:30:00',
            'duration' => 1800,
            'billable' => true,
        ]);

        foreach (range(1, 12) as $index) {
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
                'started_at' => Carbon::parse('2026-04-21 10:10:00')->addSeconds($index * 10),
                'ended_at' => Carbon::parse('2026-04-21 10:10:05')->addSeconds($index * 10),
                'duration_seconds' => 5,
                'normalized_label' => 'localhost',
                'normalized_domain' => 'localhost',
                'software_name' => 'chrome',
                'classification' => 'productive',
            ]);
        }

        foreach (range(1, 10) as $index) {
            ActivitySession::create([
                'user_id' => $user->id,
                'time_entry_id' => $entry->id,
                'source' => $index % 2 === 0 ? 'desktop' : 'browser_extension',
                'activity_kind' => $index % 2 === 0 ? 'desktop_app' : 'website',
                'tool_type' => $index % 2 === 0 ? 'software' : 'website',
                'display_name' => $index % 2 === 0 ? 'Codex' : 'Feed | LinkedIn',
                'app_name' => $index % 2 === 0 ? 'Codex' : 'chrome',
                'window_title' => $index % 2 === 0 ? 'Codex' : 'Feed | LinkedIn',
                'url' => $index % 2 === 0 ? null : 'https://www.linkedin.com/feed/',
                'started_at' => Carbon::parse('2026-04-21 10:00:00')->addSeconds($index * 10),
                'ended_at' => Carbon::parse('2026-04-21 10:00:05')->addSeconds($index * 10),
                'duration_seconds' => 5,
                'normalized_label' => $index % 2 === 0 ? 'codex' : 'linkedin.com',
                'normalized_domain' => $index % 2 === 0 ? null : 'linkedin.com',
                'software_name' => $index % 2 === 0 ? 'codex' : 'chrome',
                'classification' => $index % 3 === 0 ? 'context_dependent' : 'productive',
            ]);
        }

        $response = $this->getJson('/api/activities?processed=1&per_page=10', $this->apiHeadersFor($user));

        $response->assertOk()
            ->assertJsonCount(10, 'data')
            ->assertJsonPath('per_page', 10)
            ->assertJsonPath('total', 10)
            ->assertJsonPath('has_more', false);

        $rows = collect($response->json('data'));
        $this->assertSame(5, $rows->where('type', 'app')->count());
        $this->assertSame(5, $rows->where('type', 'url')->count());
        $this->assertFalse($rows->contains(fn (array $row) => str_contains(strtolower((string) ($row['name'] ?? '')), 'carevance hrms')));
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
