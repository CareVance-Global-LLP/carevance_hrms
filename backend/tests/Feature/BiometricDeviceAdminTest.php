<?php

namespace Tests\Feature;

use App\Models\BiometricDevice;
use App\Models\BiometricPunch;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Registering devices, and claiming a device id for a person.
 *
 * The claim path is the one that matters. Somebody enrolls on the terminal
 * before an admin has said who they are, so their punches arrive attached to a
 * number and nothing else. Those punches are KEPT rather than discarded, which
 * only pays off if claiming the id later attaches the backlog — otherwise the
 * first fortnight of somebody's attendance is silently lost and nobody can tell
 * from the records that it ever existed.
 */
class BiometricDeviceAdminTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;
    private BiometricDevice $device;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-bio-admin']);

        $this->admin = $this->makeUser('admin@carevance.test', 'admin', $this->organization);
        $this->employee = $this->makeUser('kajal@carevance.test', 'employee', $this->organization);

        $this->device = BiometricDevice::query()->create([
            'organization_id' => $this->organization->id,
            'serial_number' => 'ESSL-ADMIN-1',
            'name' => 'Reception',
            'is_active' => true,
        ]);
    }

    private function makeUser(string $email, string $role, Organization $organization): User
    {
        return User::create([
            'name' => explode('@', $email)[0],
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    private function orphanPunch(string $deviceUserId, string $at): BiometricPunch
    {
        return BiometricPunch::query()->create([
            'organization_id' => $this->organization->id,
            'biometric_device_id' => $this->device->id,
            'device_user_id' => $deviceUserId,
            'user_id' => null,
            'punched_at' => $at,
            'direction' => 'in',
        ]);
    }

    public function test_it_lists_devices_with_the_quiet_ones_flagged(): void
    {
        // Quiet for a day: no attendance is arriving, which is indistinguishable
        // from an empty office unless it is called out.
        $this->device->forceFill(['last_seen_at' => now()->subDay()])->save();

        $this->actingAs($this->admin);

        $response = $this->getJson('/api/biometric-devices')->assertOk();

        $response->assertJsonPath('data.0.serial_number', 'ESSL-ADMIN-1');
        $this->assertTrue($response->json('data.0.is_stale'));
        $this->assertStringContainsString('/api/iclock', $response->json('endpoint'));
    }

    public function test_an_unclaimed_device_id_is_reported_per_id_with_its_punch_count(): void
    {
        $this->orphanPunch('77', now()->subDays(2)->setTime(9, 30)->toDateTimeString());
        $this->orphanPunch('77', now()->subDays(2)->setTime(18, 30)->toDateTimeString());

        $this->actingAs($this->admin);

        $response = $this->getJson('/api/biometric-devices')->assertOk();

        // Per id, not a total: "2 unmapped punches" is not actionable, "id 77
        // has 2" tells an admin exactly who to go and ask.
        $response->assertJsonPath('unmapped.0.device_user_id', '77');
        $this->assertSame(2, (int) $response->json('unmapped.0.punch_count'));
    }

    public function test_claiming_an_id_attaches_the_punches_already_collected_under_it(): void
    {
        $earlier = $this->orphanPunch('77', now()->subDays(3)->setTime(9, 15)->toDateTimeString());

        $this->actingAs($this->admin);

        $this->postJson('/api/biometric-devices/claim', [
            'device_user_id' => '77',
            'user_id' => $this->employee->id,
        ])->assertOk();

        // The whole reason unmapped punches are kept rather than dropped.
        $this->assertSame($this->employee->id, $earlier->fresh()->user_id);

        $this->assertDatabaseHas('biometric_device_users', [
            'organization_id' => $this->organization->id,
            'device_user_id' => '77',
            'user_id' => $this->employee->id,
        ]);
    }

    public function test_it_refuses_to_claim_an_id_for_somebody_in_another_workspace(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-bio-admin']);
        $stranger = $this->makeUser('stranger@other.test', 'employee', $other);

        $orphan = $this->orphanPunch('88', now()->subDay()->setTime(9, 0)->toDateTimeString());

        $this->actingAs($this->admin);

        $this->postJson('/api/biometric-devices/claim', [
            'device_user_id' => '88',
            'user_id' => $stranger->id,
        ])->assertStatus(422);

        // And the punches stay unattached rather than being handed to a
        // stranger's record on a partially-applied write.
        $this->assertNull($orphan->fresh()->user_id);
    }

    public function test_an_employee_cannot_register_a_device(): void
    {
        $this->actingAs($this->employee);

        // A registered serial can post attendance into this tenant, so this is
        // a decision about other people's records, not a personal setting.
        $this->postJson('/api/biometric-devices', [
            'serial_number' => 'ROGUE-1',
            'name' => 'Mine',
        ])->assertForbidden();

        $this->assertDatabaseMissing('biometric_devices', ['serial_number' => 'ROGUE-1']);
    }

    public function test_a_device_from_another_workspace_is_not_editable(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-bio-edit']);
        $theirDevice = BiometricDevice::withoutOrganizationScope()->create([
            'organization_id' => $other->id,
            'serial_number' => 'THEIRS-1',
            'name' => 'Their reception',
            'is_active' => true,
        ]);

        $this->actingAs($this->admin);

        $this->putJson("/api/biometric-devices/{$theirDevice->id}", ['name' => 'Renamed'])
            ->assertNotFound();

        $this->assertSame('Their reception', $theirDevice->fresh()->name);
    }

    public function test_a_device_that_has_never_connected_is_not_reported_as_having_stopped(): void
    {
        // Registered a moment ago and never contacted, which is the normal
        // state between an admin adding a serial and an engineer configuring
        // the terminal. Calling that "not reporting" trains people to ignore
        // the warning by the time it means something.
        $this->device->forceFill(['last_seen_at' => null])->save();

        $this->actingAs($this->admin);

        $response = $this->getJson('/api/biometric-devices')->assertOk();

        $this->assertFalse($response->json('data.0.is_stale'));
        $this->assertFalse($response->json('data.0.has_ever_reported'));
    }
}
