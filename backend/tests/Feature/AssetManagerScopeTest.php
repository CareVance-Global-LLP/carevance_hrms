<?php

namespace Tests\Feature;

use App\Models\Asset;
use App\Models\AssetAssignment;
use App\Models\Organization;
use App\Models\ReportGroup;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Whose kit a manager may touch.
 *
 * `assets.manage` is a permission rather than a role, and managers hold it by
 * default — which is right, and matches what every comparable HRMS does. What
 * was missing is the other half: the endpoint narrowed the target to the
 * organization and nothing more, so ANY manager could assign a laptop to ANY
 * person in the company, including an admin or somebody in a department they
 * have nothing to do with.
 *
 * The list a manager sees was never wrong — /api/users already narrows to their
 * own departments — so this only ever mattered to a request made by hand. That
 * is exactly the request worth defending against.
 *
 * The rule is the one already used to decide who may edit an employee's record:
 * an admin reaches everyone, otherwise the subject must sit lower in the
 * hierarchy AND share a department.
 */
class AssetManagerScopeTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private ReportGroup $operations;
    private ReportGroup $sales;
    private User $admin;
    private User $opsManager;
    private User $opsEmployee;
    private User $salesEmployee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-asset-scope',
        ]);

        $this->operations = ReportGroup::create([
            'organization_id' => $this->organization->id,
            'name' => 'Operations',
            'slug' => 'operations',
        ]);

        $this->sales = ReportGroup::create([
            'organization_id' => $this->organization->id,
            'name' => 'Sales',
            'slug' => 'sales',
        ]);

        $this->admin = $this->makeUser('admin@carevance.test', 'admin');
        $this->opsManager = $this->makeUser('ops.manager@carevance.test', 'manager', $this->operations);
        $this->opsEmployee = $this->makeUser('ops.employee@carevance.test', 'employee', $this->operations);
        $this->salesEmployee = $this->makeUser('sales.employee@carevance.test', 'employee', $this->sales);
    }

    private function makeUser(string $email, string $role, ?ReportGroup $group = null): User
    {
        $user = User::create([
            'name' => $email,
            'email' => $email,
            'password' => bcrypt('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);

        if ($group) {
            $user->groups()->attach($group->id);
        }

        return $user;
    }

    private function makeAsset(string $tag): Asset
    {
        return Asset::create([
            'organization_id' => $this->organization->id,
            'asset_tag' => $tag,
            'name' => 'ThinkPad T14',
            'category' => 'laptop',
            'status' => Asset::STATUS_AVAILABLE,
        ]);
    }

    // ------------------------------------------------------------- assigning

    public function test_a_manager_can_assign_within_their_own_department(): void
    {
        $asset = $this->makeAsset('LAP-001');

        $this->actingAs($this->opsManager)
            ->postJson("/api/assets/{$asset->id}/assign", ['user_id' => $this->opsEmployee->id])
            ->assertCreated();

        $this->assertDatabaseHas('asset_assignments', [
            'asset_id' => $asset->id,
            'user_id' => $this->opsEmployee->id,
        ]);
    }

    public function test_a_manager_cannot_assign_to_somebody_in_another_department(): void
    {
        $asset = $this->makeAsset('LAP-002');

        $this->actingAs($this->opsManager)
            ->postJson("/api/assets/{$asset->id}/assign", ['user_id' => $this->salesEmployee->id])
            ->assertForbidden();

        $this->assertSame(0, AssetAssignment::where('asset_id', $asset->id)->count());
        $this->assertSame(Asset::STATUS_AVAILABLE, $asset->fresh()->status);
    }

    public function test_a_manager_cannot_assign_to_an_admin(): void
    {
        // Upwards, not just sideways: an admin outranks the manager, so they are
        // not somebody the manager administers.
        $asset = $this->makeAsset('LAP-003');

        $this->actingAs($this->opsManager)
            ->postJson("/api/assets/{$asset->id}/assign", ['user_id' => $this->admin->id])
            ->assertForbidden();
    }

    public function test_an_admin_can_assign_to_anyone_in_the_organization(): void
    {
        $first = $this->makeAsset('LAP-004');
        $second = $this->makeAsset('LAP-005');

        $this->actingAs($this->admin)
            ->postJson("/api/assets/{$first->id}/assign", ['user_id' => $this->salesEmployee->id])
            ->assertCreated();

        $this->actingAs($this->admin)
            ->postJson("/api/assets/{$second->id}/assign", ['user_id' => $this->opsEmployee->id])
            ->assertCreated();
    }

    public function test_an_employee_still_cannot_assign_at_all(): void
    {
        // Unchanged: this is the assets.manage permission check, which fires
        // before any scoping question is asked.
        $asset = $this->makeAsset('LAP-006');

        $this->actingAs($this->opsEmployee)
            ->postJson("/api/assets/{$asset->id}/assign", ['user_id' => $this->opsEmployee->id])
            ->assertForbidden();
    }

    // ------------------------------------------------------------- returning

    public function test_a_manager_cannot_return_an_asset_held_outside_their_department(): void
    {
        // Scoping the assign but not the return would leave the same hole with
        // an extra step: take it off them, then assign it to yourself.
        $asset = $this->makeAsset('LAP-007');

        $this->actingAs($this->admin)
            ->postJson("/api/assets/{$asset->id}/assign", ['user_id' => $this->salesEmployee->id])
            ->assertCreated();

        $this->actingAs($this->opsManager)
            ->postJson("/api/assets/{$asset->id}/return")
            ->assertForbidden();

        $this->assertNull(AssetAssignment::where('asset_id', $asset->id)->latest('id')->first()->returned_date);
    }

    public function test_a_manager_can_return_an_asset_held_by_their_own_report(): void
    {
        $asset = $this->makeAsset('LAP-008');

        $this->actingAs($this->opsManager)
            ->postJson("/api/assets/{$asset->id}/assign", ['user_id' => $this->opsEmployee->id])
            ->assertCreated();

        $this->actingAs($this->opsManager)
            ->postJson("/api/assets/{$asset->id}/return")
            ->assertOk();

        $this->assertNotNull(AssetAssignment::where('asset_id', $asset->id)->latest('id')->first()->returned_date);
    }

    // ---------------------------------------------------------------- reading

    public function test_a_manager_cannot_read_the_assets_of_somebody_outside_their_department(): void
    {
        // Scoping the write but leaving the read open would be incoherent.
        $this->actingAs($this->opsManager)
            ->getJson("/api/employees/{$this->salesEmployee->id}/assets")
            ->assertForbidden();
    }

    public function test_a_manager_can_read_the_assets_of_their_own_report(): void
    {
        $this->actingAs($this->opsManager)
            ->getJson("/api/employees/{$this->opsEmployee->id}/assets")
            ->assertOk();
    }

    public function test_everybody_can_always_read_their_own_assets(): void
    {
        // The Settings > Assets tab depends on this, and it is the one case that
        // must never be gated.
        $this->actingAs($this->salesEmployee)
            ->getJson("/api/employees/{$this->salesEmployee->id}/assets")
            ->assertOk();
    }
}
