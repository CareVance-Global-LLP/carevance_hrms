<?php

namespace Tests\Feature;

use App\Models\LegalEntity;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Managing the companies inside an organization.
 *
 * An entity's PAN and TAN decide which return every employee under it appears
 * on, so most of these tests are about refusing changes that would silently
 * move somebody onto a different return.
 */
class LegalEntityApiTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-entity-api']);
        $this->admin = $this->user('admin', 'admin@carevance.test');
    }

    private function user(string $role, string $email, ?LegalEntity $entity = null): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
            'legal_entity_id' => $entity?->id,
        ]);
    }

    private function entity(array $overrides = []): LegalEntity
    {
        return LegalEntity::query()->create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => 'CareVance Global LLP',
            'pan' => 'AAACT1234F',
            'is_primary' => true,
            'is_active' => true,
        ], $overrides));
    }

    public function test_the_first_entity_is_primary_whether_or_not_it_was_asked_for(): void
    {
        // No primary means every unassigned employee has no PAN, and on the day
        // this ships that is all of them.
        $this->postJson('/api/legal-entities', [
            'name' => 'CareVance Global LLP',
            'is_primary' => false,
        ], $this->apiHeadersFor($this->admin))->assertCreated();

        $this->assertTrue(LegalEntity::query()->first()->is_primary);
    }

    public function test_making_one_primary_demotes_the_other(): void
    {
        $first = $this->entity();
        $second = $this->entity(['name' => 'CareVance Services', 'is_primary' => false]);

        $this->putJson("/api/legal-entities/{$second->id}", ['is_primary' => true], $this->apiHeadersFor($this->admin))
            ->assertOk();

        $this->assertFalse($first->fresh()->is_primary);
        $this->assertTrue($second->fresh()->is_primary);
    }

    public function test_the_last_primary_cannot_be_demoted(): void
    {
        // Demoting it would leave every employee without an explicit entity
        // resolving to nothing.
        $only = $this->entity();

        $this->putJson("/api/legal-entities/{$only->id}", ['is_primary' => false], $this->apiHeadersFor($this->admin))
            ->assertOk();

        $this->assertTrue($only->fresh()->is_primary, 'the last primary was demoted');
    }

    public function test_an_entity_with_employees_cannot_be_deleted(): void
    {
        /*
         * Refuse rather than orphan. Those employees would silently fall back
         * to the primary and start filing under a different PAN - a change
         * nobody asked for, visible only in next month's return.
         */
        $this->entity();
        $second = $this->entity(['name' => 'CareVance Services', 'is_primary' => false]);
        $this->user('employee', 'staff@carevance.test', $second);

        $this->deleteJson("/api/legal-entities/{$second->id}", [], $this->apiHeadersFor($this->admin))
            ->assertStatus(422);

        $this->assertNotNull($second->fresh());
    }

    public function test_the_primary_cannot_be_deleted(): void
    {
        $primary = $this->entity();

        $this->deleteJson("/api/legal-entities/{$primary->id}", [], $this->apiHeadersFor($this->admin))
            ->assertStatus(422);
    }

    public function test_a_malformed_pan_is_refused_on_the_way_in(): void
    {
        // A wrong PAN is otherwise discovered when EPFO rejects the upload,
        // which is the worst possible moment to find out.
        $this->postJson('/api/legal-entities', [
            'name' => 'Bad PAN Ltd',
            'pan' => 'NOTAPAN123',
        ], $this->apiHeadersFor($this->admin))->assertStatus(422);
    }

    public function test_employees_can_be_moved_in_bulk(): void
    {
        $this->entity();
        $second = $this->entity(['name' => 'CareVance Services', 'is_primary' => false]);

        $a = $this->user('employee', 'a@carevance.test');
        $b = $this->user('employee', 'b@carevance.test');

        $this->postJson("/api/legal-entities/{$second->id}/employees", [
            'user_ids' => [$a->id, $b->id],
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $this->assertSame($second->id, (int) $a->fresh()->legal_entity_id);
        $this->assertSame($second->id, (int) $b->fresh()->legal_entity_id);
    }

    public function test_employees_from_another_tenant_are_not_moved(): void
    {
        $second = $this->entity(['name' => 'CareVance Services', 'is_primary' => false]);

        $otherOrg = Organization::create(['name' => 'Other', 'slug' => 'other-entity-api']);
        $outsider = User::create([
            'name' => 'Outsider',
            'email' => 'outsider@other.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $otherOrg->id,
        ]);

        $this->postJson("/api/legal-entities/{$second->id}/employees", [
            'user_ids' => [$outsider->id],
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $this->assertNull($outsider->fresh()->legal_entity_id, "another tenant's employee was reassigned");
    }

    public function test_another_organizations_entity_is_not_found(): void
    {
        $otherOrg = Organization::create(['name' => 'Other', 'slug' => 'other-entity-404']);
        $theirs = LegalEntity::query()->create([
            'organization_id' => $otherOrg->id,
            'name' => 'Theirs',
            'is_primary' => true,
        ]);

        $this->putJson("/api/legal-entities/{$theirs->id}", ['name' => 'Hijacked'], $this->apiHeadersFor($this->admin))
            ->assertStatus(404);

        $this->assertSame('Theirs', $theirs->fresh()->name);
    }

    public function test_an_employee_cannot_change_the_groups_statutory_identity(): void
    {
        $entity = $this->entity();
        $employee = $this->user('employee', 'nobody@carevance.test');

        $this->putJson("/api/legal-entities/{$entity->id}", ['pan' => 'BBBCT1234F'], $this->apiHeadersFor($employee))
            ->assertStatus(403);
    }

    public function test_a_manager_may_read_the_entities_but_not_write_them(): void
    {
        // Seeing which company employs somebody is reasonable; changing the
        // group's statutory identity is not.
        $this->entity();
        $manager = $this->user('manager', 'manager@carevance.test');

        $this->getJson('/api/legal-entities', $this->apiHeadersFor($manager))->assertOk();
        $this->postJson('/api/legal-entities', ['name' => 'Sneaky Ltd'], $this->apiHeadersFor($manager))
            ->assertStatus(403);
    }

    public function test_the_list_reports_how_many_employees_are_unassigned(): void
    {
        // users_count alone understates it: everybody with a null entity falls
        // back to the primary, and the UI has to be able to say so.
        $this->entity();
        $this->user('employee', 'x@carevance.test');
        $this->user('employee', 'y@carevance.test');

        $this->getJson('/api/legal-entities', $this->apiHeadersFor($this->admin))
            ->assertOk()
            // admin + two employees, none explicitly assigned
            ->assertJsonPath('unassigned_count', 3);
    }
}
