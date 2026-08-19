<?php

namespace Tests\Feature;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * What each built-in role can do.
 *
 * Two things are pinned here. First, that HR and payroll managers actually
 * hold permissions — they were absent from the match in hasPermission() and
 * fell through to `default => false`, so an HR user with no custom role had
 * none at all. Second, that nobody else's set moved while that was fixed:
 * a permission change nobody asked for is a regression, however well meant.
 */
class RolePermissionParityTest extends TestCase
{
    use RefreshDatabase, BuildsPayrollFixture;

    protected function setUp(): void
    {
        parent::setUp();

        $this->buildPayrollFixture();
    }

    private function userWithRole(string $role): User
    {
        return User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => $role,
            'email' => $role.'@parity.test',
        ]);
    }

    public function test_hr_is_no_longer_left_with_no_permissions_at_all(): void
    {
        $hr = $this->userWithRole('hr');

        $this->assertTrue($hr->hasPermission('employees.view'));
        $this->assertTrue($hr->hasPermission('payroll.view'));
        $this->assertTrue($hr->hasPermission('assets.manage'));
        $this->assertTrue($hr->hasPermission('leave.manage'));
    }

    public function test_a_payroll_manager_holds_the_same_set(): void
    {
        $payrollManager = $this->userWithRole('payroll_manager');

        $this->assertTrue($payrollManager->hasPermission('payroll.view'));
        $this->assertTrue($payrollManager->hasPermission('employees.view'));
    }

    /**
     * The routing map and the feature map must agree.
     *
     * getHierarchyLevel() places hr and payroll_manager at 20 — more
     * privileged than a line manager. If hasPermission() disagrees, the role
     * is privileged enough to reach a route and unprivileged enough to be
     * refused by the controller behind it, which is how HR got locked out of
     * its own module once already.
     */
    public function test_the_hierarchy_map_and_the_permission_map_agree(): void
    {
        $hr = $this->userWithRole('hr');
        $manager = $this->userWithRole('manager');

        $this->assertLessThan(
            $manager->getHierarchyLevel(),
            $hr->getHierarchyLevel(),
            'Fixture assumption: HR outranks a line manager.'
        );

        foreach (['employees.view', 'payroll.view', 'reports.view'] as $permission) {
            $this->assertTrue(
                $hr->hasPermission($permission),
                "HR outranks a manager but cannot {$permission}."
            );
        }
    }

    public function test_super_admin_still_holds_everything(): void
    {
        $superAdmin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'super_admin',
            'email' => 'sa@parity.test',
        ]);

        $this->assertTrue($superAdmin->hasPermission('anything.at.all'));
    }

    public function test_an_employees_permissions_are_unchanged(): void
    {
        $employee = $this->userWithRole('employee');

        foreach (['dashboard.view', 'timer.use', 'chat.use'] as $allowed) {
            $this->assertTrue($employee->hasPermission($allowed));
        }

        foreach (['payroll.view', 'employees.manage', 'settings.manage', 'roles.manage', 'audit.view'] as $denied) {
            $this->assertFalse(
                $employee->hasPermission($denied),
                "An employee must not hold {$denied}."
            );
        }
    }

    public function test_a_managers_permissions_are_unchanged(): void
    {
        $manager = $this->userWithRole('manager');

        $this->assertTrue($manager->hasPermission('employees.view'));
        $this->assertTrue($manager->hasPermission('reports.view'));

        // A manager administers people, not the organisation.
        foreach (['settings.manage', 'roles.manage', 'productivity.manage', 'geofence.manage'] as $denied) {
            $this->assertFalse(
                $manager->hasPermission($denied),
                "A manager must not hold {$denied}."
            );
        }
    }

    public function test_an_unknown_role_holds_nothing(): void
    {
        $stranger = $this->userWithRole('contractor_intern_temp');

        $this->assertFalse($stranger->hasPermission('dashboard.view'));
        $this->assertFalse($stranger->hasPermission('payroll.view'));
    }
}
