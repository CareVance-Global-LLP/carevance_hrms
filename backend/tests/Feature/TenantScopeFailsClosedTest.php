<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Project;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Tests\TestCase;

/**
 * The tenant global scope must fail closed for an authenticated user who has no
 * organisation.
 *
 * currentOrganizationId() returns null both when nobody is logged in (console
 * commands, queued jobs — the scope must be a no-op there) and when the logged-in
 * user's organization_id is NULL. Those were handled identically, so an org-less
 * account read every tenant's rows through every scoped model. The live database
 * had exactly one such user.
 */
class TenantScopeFailsClosedTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_user_without_an_organization_sees_nothing(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();

        Project::forceCreate(['organization_id' => $orgA->id, 'name' => 'Alpha project']);
        Project::forceCreate(['organization_id' => $orgB->id, 'name' => 'Beta project']);

        $orphan = User::factory()->create(['organization_id' => null, 'role' => 'employee']);
        Auth::setUser($orphan);

        $this->assertSame(
            0,
            Project::query()->count(),
            'A user with no organization must see no tenant rows at all. Seeing them means the '
            .'global scope silently switched itself off.',
        );
    }

    public function test_a_normal_user_still_sees_only_their_own_organization(): void
    {
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();

        Project::forceCreate(['organization_id' => $orgA->id, 'name' => 'Alpha project']);
        Project::forceCreate(['organization_id' => $orgB->id, 'name' => 'Beta project']);

        Auth::setUser(User::factory()->create(['organization_id' => $orgA->id, 'role' => 'admin']));

        $this->assertSame(1, Project::query()->count());
        $this->assertSame('Alpha project', Project::query()->first()->name);
    }

    public function test_the_scope_is_still_a_no_op_with_no_authenticated_user(): void
    {
        // Console commands, queued jobs and migrations run unauthenticated and
        // must keep seeing every row, or background work silently does nothing.
        $orgA = Organization::factory()->create();
        $orgB = Organization::factory()->create();

        Project::forceCreate(['organization_id' => $orgA->id, 'name' => 'Alpha project']);
        Project::forceCreate(['organization_id' => $orgB->id, 'name' => 'Beta project']);

        Auth::forgetUser();

        $this->assertSame(2, Project::query()->count());
    }

    public function test_explicit_escape_hatches_still_work_for_an_org_less_user(): void
    {
        $orgA = Organization::factory()->create();
        Project::forceCreate(['organization_id' => $orgA->id, 'name' => 'Alpha project']);

        Auth::setUser(User::factory()->create(['organization_id' => null, 'role' => 'super_admin']));

        // Failing closed must not break the deliberate, greppable escape hatches
        // that super-admin and reporting paths rely on.
        $this->assertSame(1, Project::withoutOrganizationScope()->count());
        $this->assertSame(1, Project::forOrganization($orgA->id)->count());
    }
}
