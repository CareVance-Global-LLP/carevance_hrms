<?php

namespace Tests\Feature;

use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A punch buffered on a disconnected desktop carries the time the employee
 * actually clicked. If the server stamps it at sync time instead, the worked
 * hours for that day are wrong — which is the whole reason the offline queue
 * records punch_at in the first place.
 */
class OfflineAttendancePunchTest extends TestCase
{
    use RefreshDatabase;

    private array $headers = [];

    private function actingUser(): User
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-offline-punch',
        ]);

        $user = User::create([
            'name' => 'Field Employee',
            'email' => 'offline-punch@carevance.test',
            'password' => bcrypt('secret-password'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $this->headers = $this->apiHeadersFor($user);

        return $user;
    }

    public function test_a_buffered_punch_out_is_recorded_at_the_time_it_happened(): void
    {
        $user = $this->actingUser();

        // Anchored relative to now, and in the past: resolveSyncTimestamp
        // deliberately clamps a future client timestamp back to now, so a
        // fixed wall-clock hour would fail whenever the suite runs before it.
        $punchOut = now()->subMinutes(10)->startOfMinute();
        $punchIn = $punchOut->copy()->subHours(4);

        $this->postJson('/api/attendance/check-in', [
            'local_id' => 'off_punch_in',
            'device_id' => 'desktop-1',
            'punch_at' => $punchIn->toIso8601String(),
        ], $this->headers)->assertOk();

        // The queue drains later — but the punch-out belongs at the buffered time.
        $this->postJson('/api/attendance/check-out', [
            'local_id' => 'off_punch_out',
            'device_id' => 'desktop-1',
            'punch_out_at' => $punchOut->toIso8601String(),
        ], $this->headers)->assertOk();

        $punch = AttendancePunch::where('user_id', $user->id)->firstOrFail();
        $this->assertSame(
            $punchOut->format('Y-m-d H:i'),
            $punch->punch_out_at->format('Y-m-d H:i'),
            'the punch-out must land at the buffered time, not at sync time'
        );
        $this->assertSame(4 * 3600, (int) $punch->worked_seconds, 'the session should be the four hours actually worked');
    }

    public function test_replaying_a_punch_out_does_not_apply_it_twice(): void
    {
        $user = $this->actingUser();

        // Anchored relative to now, and in the past: resolveSyncTimestamp
        // deliberately clamps a future client timestamp back to now, so a
        // fixed wall-clock hour would fail whenever the suite runs before it.
        $punchOut = now()->subMinutes(10)->startOfMinute();
        $punchIn = $punchOut->copy()->subHours(4);

        $this->postJson('/api/attendance/check-in', [
            'local_id' => 'off_punch_in',
            'device_id' => 'desktop-1',
            'punch_at' => $punchIn->toIso8601String(),
        ], $this->headers)->assertOk();

        $payload = [
            'local_id' => 'off_punch_out',
            'device_id' => 'desktop-1',
            'punch_out_at' => $punchOut->toIso8601String(),
        ];

        $this->postJson('/api/attendance/check-out', $payload, $this->headers)->assertOk();

        // The desktop never saw the response, so the queue replays it. Before
        // the idempotency check this answered 422 "No active punch-in found",
        // which the sync engine reports as a failure on a punch that is in fact
        // already stored.
        $this->postJson('/api/attendance/check-out', $payload, $this->headers)->assertOk();

        $this->assertSame(1, AttendancePunch::where('user_id', $user->id)->count());
        $punch = AttendancePunch::where('user_id', $user->id)->firstOrFail();
        $this->assertSame($punchOut->format('Y-m-d H:i'), $punch->punch_out_at->format('Y-m-d H:i'));
    }

    public function test_a_punch_out_that_predates_its_punch_in_never_yields_a_negative_session(): void
    {
        $user = $this->actingUser();

        $punchIn = now()->subHours(3)->startOfMinute();

        $this->postJson('/api/attendance/check-in', [
            'punch_at' => $punchIn->toIso8601String(),
        ], $this->headers)->assertOk();

        // Clock skew on the tracker machine.
        $this->postJson('/api/attendance/check-out', [
            'punch_out_at' => $punchIn->copy()->subHour()->toIso8601String(),
        ], $this->headers)->assertOk();

        $punch = AttendancePunch::where('user_id', $user->id)->firstOrFail();
        $this->assertGreaterThanOrEqual(0, (int) $punch->worked_seconds);
        $this->assertSame(0, (int) $punch->worked_seconds, 'the session collapses to zero rather than going negative');
    }

    public function test_a_live_punch_out_still_uses_the_current_time(): void
    {
        $user = $this->actingUser();

        $this->postJson('/api/attendance/check-in', [], $this->headers)->assertOk();
        $this->postJson('/api/attendance/check-out', [], $this->headers)->assertOk();

        $punch = AttendancePunch::where('user_id', $user->id)->firstOrFail();
        $this->assertNotNull($punch->punch_out_at);
        $this->assertTrue(
            $punch->punch_out_at->diffInMinutes(now()) < 2,
            'a normal web punch-out is unaffected by the offline path'
        );

        $record = AttendanceRecord::where('user_id', $user->id)->firstOrFail();
        $this->assertNotNull($record->check_out_at);
    }
}
