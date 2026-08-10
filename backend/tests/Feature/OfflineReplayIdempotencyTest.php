<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The desktop tracker replays its offline queue until the server acknowledges
 * each record. An acknowledgement lost in transit brings the identical payload
 * back, so every sync endpoint has to resolve (device_id, local_id) to the row
 * it already wrote instead of inserting a second one.
 */
class OfflineReplayIdempotencyTest extends TestCase
{
    use RefreshDatabase;

    private array $headers = [];

    private function actingUser(): User
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-offline-replay',
        ]);

        $user = User::create([
            'name' => 'Tracked Employee',
            'email' => 'tracked-replay@carevance.test',
            'password' => bcrypt('secret-password'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $this->headers = $this->apiHeadersFor($user);

        return $user;
    }

    public function test_replaying_an_activity_does_not_create_a_second_row(): void
    {
        $user = $this->actingUser();

        $payload = [
            'local_id' => 'off_activity_1',
            'device_id' => 'desktop-device-1',
            'type' => 'app',
            'name' => 'Visual Studio Code',
            'app_name' => 'Visual Studio Code',
            'duration' => 120,
            'recorded_at' => now()->subHours(3)->toIso8601String(),
        ];

        $first = $this->postJson('/api/activities', $payload, $this->headers);
        $first->assertStatus(201);

        // The desktop never saw the 201, so it retries the identical record.
        $second = $this->postJson('/api/activities', $payload, $this->headers);
        $second->assertStatus(200);

        $this->assertSame($first->json('id'), $second->json('id'), 'the replay must resolve to the original row');
        $this->assertSame(
            1,
            Activity::where('user_id', $user->id)->where('local_id', 'off_activity_1')->count(),
            'a replayed activity must not duplicate'
        );
    }

    public function test_a_replay_hours_later_still_resolves_to_the_original_activity(): void
    {
        $this->actingUser();

        // The pre-existing fallback only matches duplicates within a 5-second
        // window of recorded_at. A queue that drains the next morning is well
        // outside it, which is exactly the case the offline key has to cover.
        $payload = [
            'local_id' => 'off_activity_stale',
            'device_id' => 'desktop-device-1',
            'type' => 'url',
            'name' => 'example.com',
            'url' => 'https://example.com/dashboard',
            'duration' => 45,
            'recorded_at' => now()->subDay()->toIso8601String(),
        ];

        $first = $this->postJson('/api/activities', $payload, $this->headers)->assertStatus(201);

        $replay = $payload;
        $replay['recorded_at'] = now()->toIso8601String();
        $second = $this->postJson('/api/activities', $replay, $this->headers)->assertStatus(200);

        $this->assertSame($first->json('id'), $second->json('id'));
        $this->assertSame(1, Activity::where('local_id', 'off_activity_stale')->count());
    }

    public function test_activities_without_an_offline_key_are_unaffected(): void
    {
        $this->actingUser();

        $payload = [
            'type' => 'app',
            'name' => 'Slack',
            'duration' => 10,
            'recorded_at' => now()->subHours(2)->toIso8601String(),
        ];

        $this->postJson('/api/activities', $payload, $this->headers)->assertStatus(201);

        $later = $payload;
        $later['recorded_at'] = now()->subHour()->toIso8601String();
        $this->postJson('/api/activities', $later, $this->headers)->assertStatus(201);

        $this->assertSame(2, Activity::where('name', 'Slack')->count(), 'live captures still record separately');
    }

    public function test_replaying_an_activity_session_does_not_create_a_second_row(): void
    {
        $this->actingUser();

        $payload = [
            'local_id' => 'off_session_1',
            'device_id' => 'desktop-device-1',
            'source' => 'desktop',
            'activity_kind' => 'app',
            'tool_type' => 'app',
            'display_name' => 'Visual Studio Code',
            'app_name' => 'Visual Studio Code',
            'started_at' => now()->subHours(2)->toIso8601String(),
            'ended_at' => now()->subHours(2)->addMinutes(20)->toIso8601String(),
        ];

        $first = $this->postJson('/api/activity-sessions', $payload, $this->headers);
        $first->assertStatus(201);

        $second = $this->postJson('/api/activity-sessions', $payload, $this->headers);
        $second->assertStatus(200);

        $this->assertSame($first->json('id'), $second->json('id'));
        $this->assertSame(
            1,
            ActivitySession::where('local_id', 'off_session_1')->count(),
            'a replayed session must not duplicate'
        );
    }

    public function test_a_session_replay_does_not_close_the_row_it_duplicates(): void
    {
        $this->actingUser();

        // closeConflictingOpenSessions() ends any open session that overlaps a
        // new one. A replay must short-circuit before that, or the retry would
        // close the very session it is a copy of.
        $payload = [
            'local_id' => 'off_session_open',
            'device_id' => 'desktop-device-1',
            'source' => 'desktop',
            'activity_kind' => 'app',
            'tool_type' => 'app',
            'display_name' => 'Terminal',
            'app_name' => 'Terminal',
            'started_at' => now()->subMinutes(30)->toIso8601String(),
        ];

        $this->postJson('/api/activity-sessions', $payload, $this->headers)->assertStatus(201);
        $this->postJson('/api/activity-sessions', $payload, $this->headers)->assertStatus(200);

        $session = ActivitySession::where('local_id', 'off_session_open')->firstOrFail();
        $this->assertNull($session->ended_at, 'the replay must leave the open session open');
        $this->assertSame(1, ActivitySession::where('local_id', 'off_session_open')->count());
    }
}
