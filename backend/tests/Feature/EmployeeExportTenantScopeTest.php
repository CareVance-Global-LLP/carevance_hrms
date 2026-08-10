<?php

namespace Tests\Feature;

use App\Models\Group;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The employee CSV export must never cross an organisation boundary.
 *
 * Its department filter chained whereHas(...)->orWhereHas(...) without a
 * wrapping closure, so the OR bound looser than the organization_id
 * constraint: (org = X AND deptMatch) OR groupMatch.
 *
 * That does NOT leak today, because Group and EmployeeWorkInfo both use
 * BelongsToOrganization and their subqueries are therefore already scoped to
 * the acting user's organisation. The tenant safety of this query is entirely
 * implicit in that trait — drop it from Group and the export starts returning
 * other tenants' employees with no other signal. The filter is now wrapped so
 * the boundary is stated in the query itself, and this test pins it.
 */
class EmployeeExportTenantScopeTest extends TestCase
{
    use RefreshDatabase;

    public function test_department_filter_does_not_leak_other_organisations(): void
    {
        $ourOrg = Organization::factory()->create(['name' => 'Ours']);
        $otherOrg = Organization::factory()->create(['name' => 'Theirs']);

        // The same department name exists in both tenants.
        $ourGroup = Group::factory()->create(['organization_id' => $ourOrg->id, 'name' => 'Engineering']);
        $theirGroup = Group::factory()->create(['organization_id' => $otherOrg->id, 'name' => 'Engineering']);

        $admin = User::factory()->create([
            'organization_id' => $ourOrg->id,
            'role' => 'admin',
            'name' => 'Our Admin',
        ]);
        $ours = User::factory()->create([
            'organization_id' => $ourOrg->id,
            'role' => 'employee',
            'name' => 'Our Engineer',
            'email' => 'ours@example.com',
        ]);
        $theirs = User::factory()->create([
            'organization_id' => $otherOrg->id,
            'role' => 'employee',
            'name' => 'Their Engineer',
            'email' => 'theirs@example.com',
        ]);

        $ourGroup->users()->attach($ours->id);
        $theirGroup->users()->attach($theirs->id);

        $response = $this->get(
            '/api/users/export?department=Engineering',
            $this->apiHeadersFor($admin)
        )->assertOk();

        $body = $response->streamedContent() ?: $response->getContent();

        $this->assertStringContainsString('ours@example.com', $body, 'Our own engineer belongs in the export.');
        $this->assertStringNotContainsString(
            'theirs@example.com',
            $body,
            'Another tenant`s employee must never appear in our export.'
        );
    }
}
