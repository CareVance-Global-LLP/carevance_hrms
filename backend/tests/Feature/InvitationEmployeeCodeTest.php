<?php

namespace Tests\Feature;

use App\Models\EmployeeWorkInfo;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use App\Services\Invitations\InvitationService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The employee code is the organisation's own identifier — it predates this
 * system, so it is recorded rather than generated. These tests pin the two
 * properties that make it worth anything: it survives the invite round-trip,
 * and it cannot be handed to two people.
 */
class InvitationEmployeeCodeTest extends TestCase
{
    use RefreshDatabase;

    private function admin(Organization $organization): User
    {
        return User::create([
            'name' => 'Admin',
            'email' => 'admin-code@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
    }

    private function service(): InvitationService
    {
        return app(InvitationService::class);
    }

    public function test_employee_code_survives_invitation_and_lands_on_work_info(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org-code']);
        $admin = $this->admin($organization);

        $result = $this->service()->createBatch($admin, $organization, [
            'emails' => ['joiner@org.test'],
            'role' => 'employee',
            'delivery' => 'link',
            'employee_code' => 'EMP-001',
        ]);

        $this->assertSame([], $result['failed']);

        $invitation = Invitation::query()->where('email', 'joiner@org.test')->firstOrFail();
        $this->assertSame('EMP-001', $invitation->metadata['employee_code']);

        $user = $this->service()->accept($invitation, [
            'name' => 'New Joiner',
            'password' => 'password123',
        ]);

        $this->assertDatabaseHas('employee_work_infos', [
            'user_id' => $user->id,
            'employee_code' => 'EMP-001',
        ]);
    }

    public function test_work_info_is_created_even_with_no_group_or_job_title(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org-bare']);
        $admin = $this->admin($organization);

        $result = $this->service()->createBatch($admin, $organization, [
            'emails' => ['bare@org.test'],
            'role' => 'employee',
            'delivery' => 'link',
        ]);
        $this->assertSame([], $result['failed']);

        $invitation = Invitation::query()->where('email', 'bare@org.test')->firstOrFail();
        $user = $this->service()->accept($invitation, [
            'name' => 'Bare Joiner',
            'password' => 'password123',
        ]);

        // Previously skipped entirely, leaving the person with nowhere to hold
        // an employee code, designation or joining date.
        $this->assertDatabaseHas('employee_work_infos', [
            'user_id' => $user->id,
            'organization_id' => $organization->id,
        ]);
    }

    public function test_a_code_already_held_by_an_employee_is_refused(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org-dupe']);
        $admin = $this->admin($organization);

        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            'employee_code' => 'EMP-007',
        ]);

        $result = $this->service()->createBatch($admin, $organization, [
            'emails' => ['clash@org.test'],
            'role' => 'employee',
            'delivery' => 'link',
            // Case-insensitive: 'emp-007' is the same identifier.
            'employee_code' => 'emp-007',
        ]);

        $this->assertCount(1, $result['failed']);
        $this->assertStringContainsString('already assigned', $result['failed'][0]['message']);
        $this->assertDatabaseMissing('invitations', ['email' => 'clash@org.test']);
    }

    public function test_a_code_reserved_by_a_pending_invitation_is_refused(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org-pending']);
        $admin = $this->admin($organization);

        $this->service()->createBatch($admin, $organization, [
            'emails' => ['first@org.test'],
            'role' => 'employee',
            'delivery' => 'link',
            'employee_code' => 'EMP-100',
        ]);

        $result = $this->service()->createBatch($admin, $organization, [
            'emails' => ['second@org.test'],
            'role' => 'employee',
            'delivery' => 'link',
            'employee_code' => 'EMP-100',
        ]);

        $this->assertCount(1, $result['failed']);
        $this->assertStringContainsString('pending invitation', $result['failed'][0]['message']);
    }

    public function test_two_recipients_in_one_batch_cannot_share_a_code(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org-batch']);
        $admin = $this->admin($organization);

        $result = $this->service()->createBatch($admin, $organization, [
            'emails' => ['a@org.test', 'b@org.test'],
            'role' => 'employee',
            'delivery' => 'link',
            'employee_codes' => ['a@org.test' => 'EMP-200', 'b@org.test' => 'EMP-200'],
        ]);

        $this->assertCount(1, $result['created']);
        $this->assertCount(1, $result['failed']);
        $this->assertStringContainsString('more than once', $result['failed'][0]['message']);
    }

    public function test_an_admin_defined_role_is_applied_and_its_base_role_derived(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org-custom-role']);
        $admin = $this->admin($organization);

        // Level 60 sits between manager (50) and employee (100).
        $teamLead = \App\Models\Role::create([
            'organization_id' => $organization->id,
            'name' => 'Team Lead',
            'slug' => 'team-lead',
            'hierarchy_level' => 60,
            'is_system' => false,
            'is_active' => true,
        ]);

        $this->service()->createBatch($admin, $organization, [
            'emails' => ['lead@org.test'],
            // Deliberately a lie: the client claims admin while selecting a
            // level-60 role. The server must derive 'manager' and ignore this.
            'role' => 'admin',
            'role_id' => $teamLead->id,
            'delivery' => 'link',
        ]);

        $invitation = Invitation::query()->where('email', 'lead@org.test')->firstOrFail();
        $this->assertSame('manager', $invitation->role);
        $this->assertSame($teamLead->id, $invitation->metadata['role_id']);

        $user = $this->service()->accept($invitation, [
            'name' => 'Team Lead',
            'password' => 'password123',
        ]);

        $this->assertSame($teamLead->id, $user->role_id);
        $this->assertSame('manager', $user->role);
    }

    public function test_a_role_from_another_organization_is_ignored(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org-mine']);
        $stranger = Organization::create(['name' => 'Other', 'slug' => 'org-theirs']);
        $admin = $this->admin($organization);

        $foreign = \App\Models\Role::create([
            'organization_id' => $stranger->id,
            'name' => 'Their Admin',
            'slug' => 'their-admin',
            'hierarchy_level' => 10,
            'is_system' => false,
            'is_active' => true,
        ]);

        $this->service()->createBatch($admin, $organization, [
            'emails' => ['outsider@org.test'],
            'role' => 'employee',
            'role_id' => $foreign->id,
            'delivery' => 'link',
        ]);

        $invitation = Invitation::query()->where('email', 'outsider@org.test')->firstOrFail();

        // Not resolvable in this tenant, so it is dropped rather than granting
        // another organisation's admin role.
        $this->assertNull($invitation->metadata['role_id']);
        $this->assertSame('employee', $invitation->role);
    }

    public function test_a_collision_at_acceptance_does_not_lock_the_invitee_out(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org-race']);
        $admin = $this->admin($organization);

        $this->service()->createBatch($admin, $organization, [
            'emails' => ['racer@org.test'],
            'role' => 'employee',
            'delivery' => 'link',
            'employee_code' => 'EMP-300',
        ]);

        $invitation = Invitation::query()->where('email', 'racer@org.test')->firstOrFail();

        // An admin assigns the same code by hand before the invite is accepted.
        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            'employee_code' => 'EMP-300',
        ]);

        $user = $this->service()->accept($invitation, [
            'name' => 'Racer',
            'password' => 'password123',
        ]);

        // The account exists; only the contested code is withheld.
        $this->assertNotNull($user->id);
        $this->assertDatabaseHas('employee_work_infos', [
            'user_id' => $user->id,
            'employee_code' => null,
        ]);
    }
}
