<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ActivityTrackingTimelineTest extends TestCase
{
    use RefreshDatabase;

    public function test_activity_store_merges_overlapping_duplicate_snapshots_for_the_same_session(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-03-16 10:45:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
        ]);

        $firstResponse = $this->postJson('/api/activities', [
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Instagram',
            'duration' => 120,
            'recorded_at' => '2026-03-16T10:57:00Z',
        ], $headers)->assertCreated();

        $secondResponse = $this->postJson('/api/activities', [
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Instagram',
            'duration' => 125,
            'recorded_at' => '2026-03-16T10:57:04Z',
        ], $headers)->assertOk();

        $this->assertSame(
            (int) $firstResponse->json('id'),
            (int) $secondResponse->json('id')
        );

        $this->assertDatabaseCount('activities', 1);
        $this->assertDatabaseHas('activities', [
            'id' => (int) $firstResponse->json('id'),
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Instagram',
            'duration' => 125,
        ]);
    }

    public function test_activity_index_can_return_a_normalized_timeline_feed(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-03-16 10:45:00',
            'end_time' => '2026-03-16 11:05:00',
            'duration' => 1200,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Instagram',
            'duration' => 120,
            'recorded_at' => '2026-03-16 10:57:00',
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Instagram',
            'duration' => 125,
            'recorded_at' => '2026-03-16 10:57:04',
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'System Idle - Instagram',
            'duration' => 180,
            'recorded_at' => '2026-03-16 11:00:00',
        ]);

        $response = $this->getJson('/api/activities?start_date=2026-03-16&end_date=2026-03-16&normalized=1', $headers)
            ->assertOk();

        $timelineRows = collect($response->json('data'));

        $this->assertCount(2, $timelineRows);

        $webRow = $timelineRows->first(fn (array $row) => ($row['type'] ?? null) === 'url');
        $idleRow = $timelineRows->first(fn (array $row) => ($row['type'] ?? null) === 'idle');

        $this->assertNotNull($webRow);
        $this->assertNotNull($idleRow);
        $this->assertSame('instagram.com', $webRow['normalized_label']);
        $this->assertSame(121, (int) $webRow['duration']);
        $this->assertSame('2026-03-16T10:54:59+00:00', $webRow['start_at']);
        $this->assertSame('2026-03-16T10:57:00+00:00', $webRow['end_at']);
        $this->assertSame('website', $webRow['tool_type']);
        $this->assertSame($user->name, $webRow['user']['name']);

        $this->assertSame(180, (int) $idleRow['duration']);
        $this->assertSame('idle', $idleRow['tool_type']);
        $this->assertSame('2026-03-16T10:57:00+00:00', $idleRow['start_at']);
        $this->assertSame('2026-03-16T11:00:00+00:00', $idleRow['end_at']);
        $this->assertSame(301, (int) $timelineRows->sum('duration'));
    }

    public function test_activity_store_upserts_authoritative_session_boundaries_by_session_key(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-03-16 10:45:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
        ]);

        $response = $this->postJson('/api/activities', [
            'time_entry_id' => $entry->id,
            'session_key' => 'tracked:url:55:1710586500000:github',
            'type' => 'url',
            'name' => 'GitHub',
            'started_at' => '2026-03-16T10:55:00Z',
            'last_seen_at' => '2026-03-16T10:55:03Z',
            'ended_at' => '2026-03-16T10:55:03Z',
            'duration' => 3,
            'recorded_at' => '2026-03-16T10:55:03Z',
        ], $headers)->assertCreated();

        $this->postJson('/api/activities', [
            'time_entry_id' => $entry->id,
            'session_key' => 'tracked:url:55:1710586500000:github',
            'type' => 'url',
            'name' => 'GitHub',
            'started_at' => '2026-03-16T10:55:00Z',
            'last_seen_at' => '2026-03-16T10:55:08Z',
            'ended_at' => '2026-03-16T10:55:08Z',
            'duration' => 8,
            'recorded_at' => '2026-03-16T10:55:08Z',
        ], $headers)->assertOk();

        $this->assertDatabaseCount('activities', 1);
        $this->assertDatabaseHas('activities', [
            'id' => (int) $response->json('id'),
            'user_id' => $user->id,
            'session_key' => 'tracked:url:55:1710586500000:github',
            'type' => 'url',
            'name' => 'GitHub',
            'duration' => 8,
        ]);

        $activity = Activity::query()->firstOrFail();
        $this->assertSame('2026-03-16T10:55:00+00:00', $activity->started_at?->toIso8601String());
        $this->assertSame('2026-03-16T10:55:08+00:00', $activity->ended_at?->toIso8601String());
        $this->assertSame('2026-03-16T10:55:08+00:00', $activity->last_seen_at?->toIso8601String());
    }

    public function test_activity_store_normalizes_millisecond_session_boundaries_to_whole_seconds(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-03-16 10:45:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
        ]);

        $response = $this->postJson('/api/activities', [
            'time_entry_id' => $entry->id,
            'session_key' => 'tracked:url:55:1710586500125:instagram',
            'type' => 'url',
            'name' => 'Instagram',
            'started_at' => '2026-03-16T10:55:00.125Z',
            'last_seen_at' => '2026-03-16T10:55:03.970Z',
            'ended_at' => '2026-03-16T10:55:03.970Z',
            'duration' => 3.845,
            'recorded_at' => '2026-03-16T10:55:03.970Z',
        ], $headers)->assertCreated();

        $activity = Activity::query()->findOrFail((int) $response->json('id'));

        $this->assertSame(3, (int) $activity->duration);
        $this->assertSame('2026-03-16T10:55:00+00:00', $activity->started_at?->copy()->setMicrosecond(0)->toIso8601String());
        $this->assertSame('2026-03-16T10:55:03+00:00', $activity->ended_at?->copy()->setMicrosecond(0)->toIso8601String());
    }

    public function test_normalized_timeline_excludes_carevance_workspace_and_preserves_exact_positive_gap_durations(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-03-16 10:45:00',
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'snapchat - say it in a snap',
            'duration' => 5,
            'recorded_at' => '2026-03-16 10:49:38',
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'CareVance HRMS Workspace',
            'duration' => 12,
            'recorded_at' => '2026-03-16 10:49:50',
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'snapchat - say it in a snap',
            'duration' => 5,
            'recorded_at' => '2026-03-16 10:49:57',
        ]);

        $timelineRows = collect(
            $this->getJson('/api/activities?start_date=2026-03-16&end_date=2026-03-16&normalized=1', $headers)
                ->assertOk()
                ->json('data')
        );

        $this->assertCount(2, $timelineRows);
        $this->assertTrue($timelineRows->every(fn (array $row) => ($row['normalized_label'] ?? null) !== 'carevance'));
        $this->assertSame([5, 5], $timelineRows->pluck('duration')->sort()->values()->all());
    }

    private function createAuthenticatedEmployee(): array
    {
        $organization = Organization::create([
            'name' => 'CareVance Org',
            'slug' => 'carevance-org',
        ]);

        $user = User::create([
            'name' => 'Employee',
            'email' => 'employee@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        return [$user, $this->apiHeadersFor($user)];
    }
}
