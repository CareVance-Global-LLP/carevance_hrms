<?php

namespace Tests\Feature;

use App\Models\BiometricDevice;
use App\Models\BiometricDeviceUser;
use App\Models\BiometricPunch;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Ingesting punches from the hardware already on a customer's wall.
 *
 * These endpoints are unauthenticated in the usual sense, because a wall
 * terminal cannot hold a bearer token. Most of what follows is therefore about
 * what stands in for that: a pre-registered serial, database-level idempotency,
 * and refusing to guess whose finger a device id belongs to.
 */
class BiometricPushTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private BiometricDevice $device;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-bio']);

        $this->device = BiometricDevice::query()->create([
            'organization_id' => $this->organization->id,
            'serial_number' => 'ESSL0123456789',
            'name' => 'Reception',
            'is_active' => true,
        ]);
    }

    private function push(string $body, ?string $serial = null)
    {
        return $this->call(
            'POST',
            '/api/iclock/cdata?SN='.($serial ?? $this->device->serial_number).'&table=ATTLOG',
            [], [], [],
            ['CONTENT_TYPE' => 'text/plain'],
            $body,
        );
    }

    private function line(string $deviceUserId, string $timestamp, string $status = '0'): string
    {
        return implode("\t", [$deviceUserId, $timestamp, $status, '1']);
    }

    public function test_a_registered_device_gets_its_options(): void
    {
        // The device parses this as key=value. JSON here makes it retry forever.
        $response = $this->get('/api/iclock/cdata?SN='.$this->device->serial_number.'&options=all');

        $response->assertOk();
        $this->assertStringContainsString('ATTLOGStamp', $response->getContent());
        $this->assertStringContainsString($this->device->serial_number, $response->getContent());
    }

    public function test_an_unregistered_serial_stores_nothing(): void
    {
        /*
         * The whole authentication story. Auto-enrolling would let anyone who
         * learned this URL post attendance into a tenant.
         */
        $this->push($this->line('7', '2026-08-20 09:15:00'), 'UNKNOWN-SERIAL')->assertOk();

        $this->assertSame(0, BiometricPunch::withoutOrganizationScope()->count());
    }

    public function test_a_punch_is_stored_against_the_device(): void
    {
        $this->push($this->line('7', '2026-08-20 09:15:00'))->assertOk();

        $punch = BiometricPunch::withoutOrganizationScope()->first();

        $this->assertNotNull($punch);
        $this->assertSame('7', $punch->device_user_id);
        $this->assertSame($this->device->id, (int) $punch->biometric_device_id);
        $this->assertSame('09:15:00', $punch->punched_at->format('H:i:s'));
    }

    public function test_the_timestamp_is_read_as_local_time_not_utc(): void
    {
        /*
         * The device sends wall-clock with no zone. Reading it as UTC shifts
         * every punch by the offset - five and a half hours here, which turns a
         * 9am arrival into a 3:30am one and every day into an overnight shift.
         */
        $this->push($this->line('7', '2026-08-20 09:15:00'))->assertOk();

        $punch = BiometricPunch::withoutOrganizationScope()->first();

        $this->assertSame(
            '2026-08-20 09:15:00',
            $punch->punched_at->setTimezone(config('app.timezone'))->format('Y-m-d H:i:s'),
        );
    }

    public function test_replaying_the_same_batch_stores_nothing_new(): void
    {
        /*
         * Devices replay their whole buffer after a connectivity gap, and some
         * replay on every poll until acknowledged. Without idempotency one
         * office outage becomes thousands of duplicate punches.
         */
        $batch = implode("\n", [
            $this->line('7', '2026-08-20 09:15:00'),
            $this->line('7', '2026-08-20 18:02:00'),
        ]);

        $this->push($batch)->assertOk();
        $this->push($batch)->assertOk();
        $this->push($batch)->assertOk();

        $this->assertSame(2, BiometricPunch::withoutOrganizationScope()->count());
    }

    public function test_a_batch_of_many_punches_is_read_line_by_line(): void
    {
        $this->push(implode("\r\n", [
            $this->line('7', '2026-08-20 09:15:00'),
            $this->line('8', '2026-08-20 09:17:00'),
            $this->line('9', '2026-08-20 09:19:00'),
        ]))->assertOk();

        $this->assertSame(3, BiometricPunch::withoutOrganizationScope()->count());
    }

    public function test_an_unknown_device_user_is_recorded_rather_than_guessed(): void
    {
        /*
         * Auto-matching on employee code is how these integrations go wrong
         * silently: codes look similar enough to match the wrong person and
         * nobody finds out until payroll. An unclaimed id is a visible row.
         */
        $this->push($this->line('42', '2026-08-20 09:15:00'))->assertOk();

        $mapping = BiometricDeviceUser::withoutOrganizationScope()->where('device_user_id', '42')->first();

        $this->assertNotNull($mapping, 'the device id was not recorded for an admin to claim');
        $this->assertNull($mapping->user_id);
        $this->assertNull(BiometricPunch::withoutOrganizationScope()->first()->user_id);
    }

    public function test_a_claimed_device_user_attaches_to_the_person(): void
    {
        $employee = User::create([
            'name' => 'Kajal',
            'email' => 'kajal@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $this->organization->id,
        ]);

        BiometricDeviceUser::query()->create([
            'organization_id' => $this->organization->id,
            'device_user_id' => '42',
            'user_id' => $employee->id,
        ]);

        $this->push($this->line('42', '2026-08-20 09:15:00'))->assertOk();

        $this->assertSame($employee->id, (int) BiometricPunch::withoutOrganizationScope()->first()->user_id);
    }

    public function test_a_malformed_line_does_not_discard_the_rest_of_the_batch(): void
    {
        // One bad row in a replayed buffer must not cost a whole day of
        // everybody else's attendance.
        $this->push(implode("\n", [
            $this->line('7', '2026-08-20 09:15:00'),
            'this is not a punch',
            "8\tnot-a-date\t0\t1",
            $this->line('9', '2026-08-20 09:19:00'),
        ]))->assertOk();

        $this->assertSame(2, BiometricPunch::withoutOrganizationScope()->count());
    }

    public function test_the_device_is_marked_as_seen(): void
    {
        /*
         * A freshly registered device has never called in, which is NOT the
         * same as one that called for a year and stopped. This test used to
         * assert it was stale, and the UI duly told an admin "no attendance is
         * arriving from this device" about a terminal added thirty seconds
         * earlier - training them to ignore the warning by the time it meant
         * something.
         */
        $this->assertFalse($this->device->hasEverReported());
        $this->assertFalse($this->device->isStale());

        $this->push($this->line('7', '2026-08-20 09:15:00'))->assertOk();

        $this->assertTrue($this->device->fresh()->hasEverReported());
        $this->assertFalse($this->device->fresh()->isStale());
        $this->assertSame(1, (int) $this->device->fresh()->punches_received);
    }

    public function test_a_device_that_reported_and_stopped_is_stale(): void
    {
        // The failure that matters: it WAS working, and no longer is. Nothing
        // else in the product can tell an admin this happened.
        $this->device->forceFill(['last_seen_at' => now()->subDay()])->save();

        $this->assertTrue($this->device->fresh()->isStale());
        $this->assertTrue($this->device->fresh()->hasEverReported());
    }

    public function test_an_inactive_device_is_ignored(): void
    {
        $this->device->update(['is_active' => false]);

        $this->push($this->line('7', '2026-08-20 09:15:00'))->assertOk();

        $this->assertSame(0, BiometricPunch::withoutOrganizationScope()->count());
    }

    public function test_non_attendance_tables_are_acknowledged_without_being_stored(): void
    {
        // A device also pushes operation logs and templates. Acknowledging them
        // stops it retrying forever, which is all that matters until we store them.
        $this->call(
            'POST',
            '/api/iclock/cdata?SN='.$this->device->serial_number.'&table=OPERLOG',
            [], [], [], ['CONTENT_TYPE' => 'text/plain'],
            "OPLOG\t1\t2026-08-20 09:15:00",
        )->assertOk();

        $this->assertSame(0, BiometricPunch::withoutOrganizationScope()->count());
    }

    public function test_the_command_poll_is_answered(): void
    {
        // An unanswered poll is retried every few seconds forever.
        $this->get('/api/iclock/getrequest?SN='.$this->device->serial_number)
            ->assertOk()
            ->assertSee('OK');
    }
}
