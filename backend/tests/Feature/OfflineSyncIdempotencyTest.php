<?php

namespace Tests\Feature;

use App\Models\AttendancePunch;
use App\Models\Organization;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class OfflineSyncIdempotencyTest extends TestCase
{
    use RefreshDatabase;

    private function makeEmployee(): User
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-offline',
        ]);

        return User::create([
            'name' => 'Offline Employee',
            'email' => 'offline-employee@example.com',
            'password' => 'password123',
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
    }

    public function test_time_entry_start_preserves_started_at_and_is_idempotent(): void
    {
        $user = $this->makeEmployee();
        $headers = $this->apiHeadersFor($user);
        $localId = 'off_test_te_1';
        $deviceId = 'device-xyz';

        $startedAt = '2026-03-16T09:05:00Z';

        $first = $this->postJson('/api/time-entries/start', [
            'local_id' => $localId,
            'device_id' => $deviceId,
            'started_at' => $startedAt,
            'timer_slot' => 'primary',
        ], $headers);

        $first->assertStatus(201);
        $this->assertDatabaseHas('time_entries', [
            'local_id' => $localId,
            'device_id' => $deviceId,
        ]);
        $entry = TimeEntry::where('local_id', $localId)->firstOrFail();
        // Timestamp is converted to app timezone (Asia/Kolkata) for storage
        $expectedInAppTz = \Carbon\Carbon::parse($startedAt)->setTimezone(config('app.timezone', 'UTC'))->toRfc3339String();
        $this->assertEquals($expectedInAppTz, $entry->start_time->toRfc3339String());

        // Retry with the same idempotency keys must not create a duplicate.
        $second = $this->postJson('/api/time-entries/start', [
            'local_id' => $localId,
            'device_id' => $deviceId,
            'started_at' => $startedAt,
        ], $headers);

        $second->assertStatus(200);
        $this->assertDatabaseCount('time_entries', 1);
    }

    public function test_attendance_check_in_preserves_punch_at_and_is_idempotent(): void
    {
        $user = $this->makeEmployee();
        $headers = $this->apiHeadersFor($user);
        $localId = 'off_test_att_1';
        $deviceId = 'device-xyz';
        $punchAt = '2026-03-16T09:00:00Z';

        $this->postJson('/api/attendance/check-in', [
            'local_id' => $localId,
            'device_id' => $deviceId,
            'punch_at' => $punchAt,
        ], $headers)->assertStatus(200);

        $this->assertDatabaseHas('attendance_punches', [
            'local_id' => $localId,
            'device_id' => $deviceId,
        ]);

        // Duplicate check-in should be rejected (already checked in) without
        // creating a second punch.
        $retry = $this->postJson('/api/attendance/check-in', [
            'local_id' => $localId,
            'device_id' => $deviceId,
            'punch_at' => $punchAt,
        ], $headers);
        $retry->assertStatus(422);
        $this->assertDatabaseCount('attendance_punches', 1);
    }

    public function test_activity_is_idempotent_via_local_id(): void
    {
        $user = $this->makeEmployee();
        $headers = $this->apiHeadersFor($user);
        $localId = 'off_test_act_1';
        $deviceId = 'device-xyz';

        // An activity can be created without a time entry reference.
        $first = $this->postJson('/api/activities', [
            'local_id' => $localId,
            'device_id' => $deviceId,
            'type' => 'app',
            'name' => 'VS Code',
            'duration' => 120,
            'recorded_at' => '2026-03-16T10:00:00Z',
        ], $headers);
        $first->assertStatus(201);

        $retry = $this->postJson('/api/activities', [
            'local_id' => $localId,
            'device_id' => $deviceId,
            'type' => 'app',
            'name' => 'VS Code',
            'duration' => 120,
            'recorded_at' => '2026-03-16T10:00:00Z',
        ], $headers);
        $retry->assertStatus(200);

        $this->assertDatabaseCount('activities', 1);
    }

    public function test_offline_time_entry_then_screenshot_linkage(): void
    {
        $user = $this->makeEmployee();
        $headers = $this->apiHeadersFor($user);
        $teLocal = 'off_link_te';
        $shotLocal = 'off_link_shot';
        $deviceId = 'device-xyz';

        $this->postJson('/api/time-entries/start', [
            'local_id' => $teLocal,
            'device_id' => $deviceId,
            'started_at' => '2026-03-16T09:00:00Z',
        ], $headers)->assertStatus(201);

        $entry = TimeEntry::where('local_id', $teLocal)->firstOrFail();

        // The offline screenshot carries the offline time-entry local_id; the
        // sync engine resolves it to the server id before POSTing.
        $shot = $this->postJson('/api/screenshots', [
            'local_id' => $shotLocal,
            'device_id' => $deviceId,
            'time_entry_id' => $entry->id,
            'captured_at' => '2026-03-16T09:30:00Z',
            'image_data_url' => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
        ], $headers);
        $shot->assertStatus(201);
        $this->assertDatabaseHas('screenshots', [
            'local_id' => $shotLocal,
            'time_entry_id' => $entry->id,
        ]);
    }

    public function test_offline_screenshot_uses_time_entry_local_id(): void
    {
        $user = $this->makeEmployee();
        $headers = $this->apiHeadersFor($user);
        $teLocal = 'off_te_local';
        $shotLocal = 'off_shot_local';
        $deviceId = 'device-abc';

        // First create a time entry via offline sync
        $this->postJson('/api/time-entries/start', [
            'local_id' => $teLocal,
            'device_id' => $deviceId,
            'started_at' => '2026-03-16T09:00:00Z',
            'timer_slot' => 'primary',
        ], $headers)->assertStatus(201);

        $entry = TimeEntry::where('local_id', $teLocal)->firstOrFail();

        // Simulate offline sync where client sends time_entry_local_id instead of server ID
        // This happens when the desktop is offline and hasn't received the server-generated ID yet
        $response = $this->postJson('/api/screenshots', [
            'local_id' => $shotLocal,
            'device_id' => $deviceId,
            'time_entry_local_id' => $teLocal,
            'captured_at' => '2026-03-16T09:30:00Z',
            'image_data_url' => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
        ], $headers);
        
        $response->assertStatus(201);
        $this->assertDatabaseHas('screenshots', [
            'local_id' => $shotLocal,
            'time_entry_id' => $entry->id,
            'device_id' => $deviceId,
        ]);
        
        // Verify idempotency - retry should return existing record
        $retryResponse = $this->postJson('/api/screenshots', [
            'local_id' => $shotLocal,
            'device_id' => $deviceId,
            'time_entry_local_id' => $teLocal,
            'captured_at' => '2026-03-16T09:30:00Z',
            'image_data_url' => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
        ], $headers);
        
        $retryResponse->assertStatus(200);
        $this->assertDatabaseCount('screenshots', 1);
    }
}
