<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

/**
 * The delete guard has to cover every route that deletes, not one of four.
 *
 * `DELETE /api/users/{id}` refuses an account with history. Three other routes
 * reached the same rows without asking, and `users.organization_id` is ON
 * DELETE CASCADE with SoftDeletes on neither `User` nor `Organization`, so
 * deleting an organization destroys every account in it and everything the
 * hundred-odd cascading tables hold — payslips, attendance, the leave ledger,
 * Form 16s. That is exactly the "route around the stricter one" the guard's
 * own comment warns about.
 *
 *  - `DELETE /api/super-admin/organizations/{organization}` was docblocked
 *    "(soft delete)" and hard-deleted the tenant.
 *  - `POST /auth/signup-owner` is UNAUTHENTICATED and deleted an existing
 *    organization outright whenever the submitted email matched a user whose
 *    workspace was still `inactive` — taking every other member of that
 *    workspace with it through the cascade.
 *  - `POST /auth/cleanup-pending` deleted the caller's own account, and the
 *    organization if they were the last one in it.
 *
 * A signup nobody used still deletes. That is what these routes are for.
 */
class HardDeleteRoutesRespectHistoryTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        Mail::fake();
    }

    private function makeOrganization(string $slug, array $attributes = []): Organization
    {
        return Organization::create(array_merge([
            'name' => 'Tenant '.$slug,
            'slug' => $slug,
        ], $attributes));
    }

    private function member(Organization $org, string $name, string $role = 'employee'): User
    {
        return User::create([
            'name' => ucfirst($name),
            'email' => $name.'-'.$org->id.'@carevance.test',
            'password' => bcrypt('password123'),
            'role' => $role,
            'organization_id' => $org->id,
        ]);
    }

    private function giveHistory(Organization $org, User $user): void
    {
        AttendanceRecord::create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'attendance_date' => '2026-07-14',
            'worked_seconds' => 28800,
            'status' => 'present',
        ]);
    }

    private function vendor(): User
    {
        return User::create([
            'name' => 'Vendor Engineer',
            'email' => 'engineer@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'super_admin',
            'organization_id' => null,
        ]);
    }

    /* ── super admin ───────────────────────────────────────────── */

    public function test_a_super_admin_cannot_delete_an_organization_whose_people_have_records(): void
    {
        $org = $this->makeOrganization('worked-tenant');
        $admin = $this->member($org, 'tenant-admin', 'admin');
        $this->giveHistory($org, $admin);

        $this->withHeaders($this->apiHeadersFor($this->vendor()))
            ->deleteJson("/api/super-admin/organizations/{$org->id}")
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'ORGANIZATION_HAS_HISTORY');

        $this->assertDatabaseHas('organizations', ['id' => $org->id]);
        $this->assertDatabaseHas('users', ['id' => $admin->id]);
        $this->assertDatabaseHas('attendance_records', ['user_id' => $admin->id]);
    }

    public function test_a_super_admin_can_still_delete_a_workspace_nobody_ever_used(): void
    {
        $org = $this->makeOrganization('spam-tenant');
        $admin = $this->member($org, 'spam-admin', 'admin');

        $this->withHeaders($this->apiHeadersFor($this->vendor()))
            ->deleteJson("/api/super-admin/organizations/{$org->id}")
            ->assertOk();

        $this->assertDatabaseMissing('organizations', ['id' => $org->id]);
        $this->assertDatabaseMissing('users', ['id' => $admin->id]);
    }

    /* ── the unauthenticated signup reclaim ────────────────────── */

    /** @return array<string, mixed> */
    private function signupPayload(string $email): array
    {
        return [
            'company_name' => 'Reclaimed Ltd',
            'name' => 'New Owner',
            'email' => $email,
            'password' => 'Str0ng!Passw0rd#2026',
            'password_confirmation' => 'Str0ng!Passw0rd#2026',
            'signup_mode' => 'trial',
            'trial_plan' => 'basic_tracking',
            'terms_accepted' => true,
        ];
    }

    public function test_signing_up_again_cannot_delete_a_workspace_that_has_records_in_it(): void
    {
        $org = $this->makeOrganization('abandoned-but-worked', ['subscription_status' => 'inactive']);
        $owner = $this->member($org, 'returning-owner', 'admin');
        $this->giveHistory($org, $owner);

        $this->postJson('/api/auth/signup-owner', $this->signupPayload($owner->email))
            ->assertStatus(422);

        $this->assertDatabaseHas('organizations', ['id' => $org->id]);
        $this->assertDatabaseHas('users', ['id' => $owner->id]);
        $this->assertDatabaseHas('attendance_records', ['user_id' => $owner->id]);
    }

    public function test_signing_up_again_cannot_delete_a_workspace_that_has_other_people_in_it(): void
    {
        $org = $this->makeOrganization('abandoned-but-staffed', ['subscription_status' => 'inactive']);
        $owner = $this->member($org, 'staffed-owner', 'admin');
        $colleague = $this->member($org, 'staffed-colleague');

        $this->postJson('/api/auth/signup-owner', $this->signupPayload($owner->email))
            ->assertStatus(422);

        // The cascade would have taken the colleague, who never signed up for
        // anything and cannot see this happen.
        $this->assertDatabaseHas('users', ['id' => $colleague->id]);
        $this->assertDatabaseHas('organizations', ['id' => $org->id]);
    }

    public function test_an_abandoned_signup_with_nothing_in_it_can_still_be_reclaimed(): void
    {
        $org = $this->makeOrganization('abandoned-empty', ['subscription_status' => 'inactive']);
        $owner = $this->member($org, 'empty-owner', 'admin');

        $this->postJson('/api/auth/signup-owner', $this->signupPayload($owner->email))
            ->assertSuccessful();

        $this->assertDatabaseMissing('organizations', ['id' => $org->id]);
    }

    /* ── abandoning your own pending signup ────────────────────── */

    public function test_abandoning_a_pending_signup_is_refused_once_there_are_records(): void
    {
        $org = $this->makeOrganization('pending-but-worked', ['subscription_status' => 'inactive']);
        $owner = $this->member($org, 'pending-owner', 'admin');
        $this->giveHistory($org, $owner);

        $this->withHeaders($this->apiHeadersFor($owner))
            ->postJson('/api/auth/cleanup-pending')
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'HAS_HISTORY');

        $this->assertDatabaseHas('users', ['id' => $owner->id]);
        $this->assertDatabaseHas('organizations', ['id' => $org->id]);
    }

    public function test_abandoning_a_pending_signup_with_nothing_in_it_still_works(): void
    {
        $org = $this->makeOrganization('pending-empty', ['subscription_status' => 'inactive']);
        $owner = $this->member($org, 'clean-owner', 'admin');

        $this->withHeaders($this->apiHeadersFor($owner))
            ->postJson('/api/auth/cleanup-pending')
            ->assertOk();

        $this->assertDatabaseMissing('users', ['id' => $owner->id]);
        $this->assertDatabaseMissing('organizations', ['id' => $org->id]);
    }
}
