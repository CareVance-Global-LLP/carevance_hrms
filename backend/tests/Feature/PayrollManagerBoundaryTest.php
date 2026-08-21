<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A manager is not a payroll administrator.
 *
 * The administrative payroll group was gated `role:admin,manager`, and
 * RoleMiddleware reads 'manager' as `hierarchy_level < 100` — so every manager
 * in the organization could reach payroll runs, salary structures, bank files
 * and every colleague's compensation. Having a team is not a reason to see what
 * the company pays.
 *
 * The group is now `role:admin`, which is `hierarchy_level <= 10`. Deliberately
 * a LEVEL check and not a role NAME check: granting payroll access stays
 * possible, it just has to be done by placing someone at admin level rather
 * than being conferred automatically by a job title.
 *
 * Employees and managers keep their own figures through the ESS routes, which
 * live outside this group — see PayrollRouteAuthorizationTest's allow-list.
 */
class PayrollManagerBoundaryTest extends TestCase
{
    use RefreshDatabase;

    /** A route inside the administrative group. */
    private const ADMIN_PAYROLL_ROUTE = '/api/payroll/onboarding-status';

    /** A route outside it, reached from My Payroll. */
    private const SELF_SERVICE_ROUTE = '/api/payroll/my/payslips';

    public function test_a_manager_cannot_reach_the_administrative_payroll_area(): void
    {
        $manager = $this->userWithRole('manager', 50);

        $this->getJson(self::ADMIN_PAYROLL_ROUTE, $this->apiHeadersFor($manager))
            ->assertStatus(403);
    }

    public function test_an_employee_cannot_reach_the_administrative_payroll_area(): void
    {
        $employee = $this->userWithRole('employee', 100);

        $this->getJson(self::ADMIN_PAYROLL_ROUTE, $this->apiHeadersFor($employee))
            ->assertStatus(403);
    }

    public function test_an_admin_still_can(): void
    {
        $admin = $this->userWithRole('admin', 10);

        $this->getJson(self::ADMIN_PAYROLL_ROUTE, $this->apiHeadersFor($admin))
            ->assertStatus(200);
    }

    public function test_hr_and_payroll_manager_still_can(): void
    {
        // These two RUN payroll - PayslipController::PAYROLL_ROLES has always
        // listed them beside admin - and sit at level 20. Gating on 'role:admin'
        // (<= 10) locks them out of their own module, which has happened before.
        foreach (['hr', 'payroll_manager'] as $role) {
            $this->getJson(self::ADMIN_PAYROLL_ROUTE, $this->apiHeadersFor($this->userWithRole($role, 20)))
                ->assertStatus(200);
        }
    }

    public function test_a_custom_role_at_payroll_level_still_can(): void
    {
        /*
         * The escape hatch, and the reason this is a level comparison rather
         * than a list of role names: somebody can be given payroll access
         * without being called admin or hr.
         *
         * The level is read off the CUSTOM ROLE, not off users.hierarchy_level
         * - see User::getHierarchyLevel(), which resolves
         * customRole?->hierarchy_level first and only falls back to the role
         * name. Setting that column alone does nothing, which is a trap worth
         * having a test remember.
         */
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-custom-payroll']);
        $role = Role::create([
            'organization_id' => $organization->id,
            'name' => 'Payroll Officer',
            'slug' => 'payroll-officer',
            'hierarchy_level' => 20,
            'is_active' => true,
        ]);

        $user = User::create([
            'name' => 'Payroll Officer',
            'email' => 'officer@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'role_id' => $role->id,
            'organization_id' => $organization->id,
        ]);

        $this->getJson(self::ADMIN_PAYROLL_ROUTE, $this->apiHeadersFor($user))
            ->assertStatus(200);
    }

    public function test_a_manager_keeps_their_own_payroll(): void
    {
        // The point is to remove the ADMINISTRATIVE view, not to take away the
        // person's own payslips. Anything but 403 proves the ESS route is still
        // theirs; the payload depends on fixtures this test does not build.
        $manager = $this->userWithRole('manager', 50);

        $response = $this->getJson(self::SELF_SERVICE_ROUTE, $this->apiHeadersFor($manager));

        $this->assertNotSame(403, $response->status(), 'a manager lost access to their own payslips');
    }

    private function userWithRole(string $role, int $hierarchyLevel): User
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-payroll-boundary-'.$role,
        ]);

        return User::create([
            'name' => ucfirst($role),
            'email' => $role.'@carevance.test',
            'password' => Hash::make('password123'),
            'role' => $role,
            'hierarchy_level' => $hierarchyLevel,
            'organization_id' => $organization->id,
        ]);
    }
}
