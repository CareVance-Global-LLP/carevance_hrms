<?php

namespace Tests\Feature;

use App\Models\ActivitySession;
use App\Models\Organization;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ActivitySessionIdempotencyTest extends TestCase
{
    use RefreshDatabase;

    private function actor(): array
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);
        $user = User::create([
            'name' => 'Tracked User',
            'email' => 'tracked@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'organization_id' => $organization->id,
            'start_time' => now()->subHour(),
        ]);

        return [$user, $entry];
    }

    private function payload(TimeEntry $entry): array
    {
        return [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Visual Studio Code',
            'app_name' => 'Code',
            'window_title' => 'plan.md',
            'started_at' => now()->subMinutes(5)->toIso8601String(),
            'confidence' => 100,
            'local_id' => 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
            'device_id' => 'device-1',
        ];
    }

    public function test_a_replayed_session_does_not_create_a_second_row(): void
    {
        [$user, $entry] = $this->actor();
        $payload = $this->payload($entry);

        $first = $this->postJson('/api/activity-sessions', $payload, $this->apiHeadersFor($user));
        $first->assertSuccessful();

        // The retry the tracker's queue performs after a timeout that had in
        // fact succeeded. It must resolve to the original row.
        $second = $this->postJson('/api/activity-sessions', $payload, $this->apiHeadersFor($user));
        $second->assertSuccessful();

        $this->assertSame($first->json('id'), $second->json('id'));
        $this->assertSame(1, ActivitySession::where('local_id', $payload['local_id'])->count());
    }

    public function test_the_same_local_id_from_another_device_is_a_different_session(): void
    {
        [$user, $entry] = $this->actor();

        $this->postJson('/api/activity-sessions', $this->payload($entry), $this->apiHeadersFor($user))
            ->assertSuccessful();

        // Idempotency is scoped to the pair. Two devices minting the same UUID
        // is vanishingly unlikely, but collapsing them would silently discard
        // one machine's work.
        $otherDevice = array_merge($this->payload($entry), ['device_id' => 'device-2']);
        $this->postJson('/api/activity-sessions', $otherDevice, $this->apiHeadersFor($user))
            ->assertSuccessful();

        $this->assertSame(2, ActivitySession::where('local_id', $this->payload($entry)['local_id'])->count());
    }

    public function test_a_session_without_idempotency_keys_is_still_accepted(): void
    {
        // The browser-extension path does not mint them; it must keep working.
        [$user, $entry] = $this->actor();
        $payload = $this->payload($entry);
        unset($payload['local_id'], $payload['device_id']);

        $this->postJson('/api/activity-sessions', $payload, $this->apiHeadersFor($user))
            ->assertSuccessful();

        $this->assertSame(1, ActivitySession::where('user_id', $user->id)->count());
    }
}
