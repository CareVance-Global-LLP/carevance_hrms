<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A seeded role must grant what its slug is supposed to grant.
 *
 * Two lists said what a role gets, and they disagreed. `User::PERMISSIONS_*` is
 * read live for a user with no custom role; `Organization`'s own hand-written
 * copy was read once, when the organisation was created. Nothing kept them in
 * step.
 *
 * Measured on production 25 Aug 2026: seven Admin roles lacked assets.view,
 * assets.manage, payroll.view and invoices.view, and nine Manager roles lacked
 * those plus chat.use. The visible symptom was a 403 on Assets for an admin —
 * on a screen the same person could reach from an account that had no custom
 * role at all.
 *
 * `admin` was the worse half: it had no entry in that copy, so seeding fell
 * through to `Permission::pluck('key')` — every permission row that happened to
 * exist that day. An organisation created before a permission was added never
 * received it, and one created after did.
 */
class SystemRolePermissionBaselineTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_seeder_reads_the_same_lists_the_permission_check_does(): void
    {
        // The whole bug in one assertion: two sources of truth for the same
        // question. Derived rather than copied, so they cannot drift again.
        $defaults = Organization::systemRolePermissionDefaults();

        $this->assertSame(User::PERMISSIONS_ADMIN, $defaults['admin']);
        $this->assertSame(User::PERMISSIONS_MANAGER, $defaults['manager']);
        $this->assertSame(User::PERMISSIONS_EMPLOYEE, $defaults['employee']);
    }

    public function test_an_unknown_slug_grants_nothing_rather_than_everything(): void
    {
        // The old fallback was `?? Permission::pluck('key')->all()`. A slug the
        // map does not cover became omnipotent, silently, and its permissions
        // depended on the date the organisation was created.
        $this->assertArrayNotHasKey('auditor', Organization::systemRolePermissionDefaults());
    }

    public function test_a_new_organisation_gets_the_full_admin_baseline(): void
    {
        foreach (User::PERMISSIONS_ADMIN as $key) {
            Permission::query()->firstOrCreate(
                ['key' => $key],
                ['name' => $key, 'group_name' => 'Test', 'description' => $key]
            );
        }

        $organization = Organization::factory()->create();

        $admin = Role::withoutGlobalScopes()
            ->where('organization_id', $organization->id)
            ->where('slug', 'admin')
            ->first();

        $this->assertNotNull($admin, 'a new organisation must get its system roles');

        $granted = $admin->permissions()->pluck('key')->all();

        foreach (User::PERMISSIONS_ADMIN as $key) {
            $this->assertContains($key, $granted, "a seeded admin role must carry {$key}");
        }
    }

    public function test_the_sync_command_tops_up_without_removing_anything(): void
    {
        foreach (array_merge(User::PERMISSIONS_ADMIN, ['reports.export']) as $key) {
            Permission::query()->firstOrCreate(
                ['key' => $key],
                ['name' => $key, 'group_name' => 'Test', 'description' => $key]
            );
        }

        $organization = Organization::factory()->create();
        $admin = Role::withoutGlobalScopes()
            ->where('organization_id', $organization->id)
            ->where('slug', 'admin')
            ->first();

        // Strip two baseline permissions to simulate a drifted role, and add
        // one that is NOT in the baseline to stand for a deliberate grant.
        $assets = Permission::where('key', 'assets.view')->first();
        $extra = Permission::where('key', 'reports.export')->first();
        $admin->permissions()->detach($assets->id);
        $admin->permissions()->syncWithoutDetaching([$extra->id]);

        $this->artisan('roles:sync-permissions', ['--organization' => $organization->id])
            ->assertExitCode(0);

        $granted = $admin->fresh()->permissions()->pluck('key');

        $this->assertTrue($granted->contains('assets.view'), 'the missing baseline permission must be restored');
        $this->assertTrue(
            $granted->contains('reports.export'),
            'a deliberate grant outside the baseline must survive — this is additive, not a reset'
        );
    }
}
