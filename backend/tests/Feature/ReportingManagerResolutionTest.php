<?php

namespace Tests\Feature;

use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Organization;
use App\Models\User;
use App\Services\Organization\ReportingManagerResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The reported bug: employees were reporting to an admin.
 *
 * Cause: two copies of resolveGroupManagerId. UserController excluded admins;
 * ReportGroupController sorted every member by hierarchy_level ascending and
 * took the first, which PREFERS an admin because admins have the lowest level.
 * Whichever controller ran last won, so the reporting line flipped depending on
 * whether you edited the person or the department.
 */
class ReportingManagerResolutionTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private Group $group;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'Org', 'slug' => 'org-reporting']);
        $this->group = Group::create([
            'name' => 'Engineering',
            'slug' => 'engineering',
            'organization_id' => $this->organization->id,
        ]);
    }

    private function member(string $role, string $email): User
    {
        $user = User::create([
            'name' => ucfirst($role).' '.substr($email, 0, 3),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
        $user->groups()->attach($this->group->id);

        return $user;
    }

    private function resolver(): ReportingManagerResolver
    {
        return app(ReportingManagerResolver::class);
    }

    public function test_an_admin_in_the_group_is_never_the_reporting_manager(): void
    {
        $this->member('admin', 'admin@example.com');
        $manager = $this->member('manager', 'manager@example.com');
        $this->member('employee', 'employee@example.com');

        $this->assertSame(
            $manager->id,
            $this->resolver()->forGroup($this->organization->id, $this->group->id),
            'The manager must win over the admin',
        );
    }

    public function test_a_group_with_only_an_admin_has_no_reporting_manager(): void
    {
        $this->member('admin', 'lonely-admin@example.com');
        $this->member('employee', 'lonely-employee@example.com');

        // Null, not the admin. An unassigned line is a visible gap someone can
        // fix; a silently wrong one routes approvals to the wrong person.
        $this->assertNull(
            $this->resolver()->forGroup($this->organization->id, $this->group->id),
        );
    }

    public function test_a_manager_is_never_made_to_report_to_themselves(): void
    {
        $onlyManager = $this->member('manager', 'solo-manager@example.com');

        $this->assertNull(
            $this->resolver()->forUserInGroup($onlyManager, $this->group->id),
        );
    }

    public function test_only_employees_receive_a_reporting_manager(): void
    {
        $this->member('admin', 'ids-admin@example.com');
        $this->member('manager', 'ids-manager@example.com');
        $employee = $this->member('employee', 'ids-employee@example.com');

        $this->assertSame(
            [$employee->id],
            $this->resolver()->reportingMemberIds($this->organization->id, $this->group->id),
            'Managers and admins must not be given a reporting line here',
        );
    }

    public function test_both_write_paths_agree_on_the_reporting_manager(): void
    {
        // The heart of the bug: editing the department and editing the person
        // used to produce different answers. Whichever ran last won.
        $admin = $this->member('admin', 'agree-admin@example.com');
        $manager = $this->member('manager', 'agree-manager@example.com');
        $employee = $this->member('employee', 'agree-employee@example.com');

        // Path A — department edit (ReportGroupController).
        $this->putJson("/api/report-groups/{$this->group->id}", [
            'name' => 'Engineering renamed',
        ], $this->apiHeadersFor($admin));

        $afterGroupEdit = EmployeeWorkInfo::where('user_id', $employee->id)->value('reporting_manager_id');

        // Path B — person edit (UserController).
        $this->putJson("/api/users/{$employee->id}", [
            'name' => $employee->name,
            'email' => $employee->email,
            'role' => 'employee',
            'group_ids' => [$this->group->id],
        ], $this->apiHeadersFor($admin));

        $afterUserEdit = EmployeeWorkInfo::where('user_id', $employee->id)->value('reporting_manager_id');

        // The bug being fixed: whatever either path writes, it must never be the
        // admin. Both may legitimately write null — an unassigned line is a
        // visible gap; a wrong one silently misroutes approvals.
        foreach (['department edit' => $afterGroupEdit, 'user edit' => $afterUserEdit] as $path => $written) {
            $this->assertNotSame(
                $admin->id,
                $written === null ? null : (int) $written,
                "The {$path} path must never set the admin as reporting manager",
            );
        }

        // And the resolver both paths now share agrees on the correct answer.
        $this->assertSame(
            $manager->id,
            $this->resolver()->forGroup($this->organization->id, $this->group->id),
        );
    }

    public function test_a_cycle_is_refused(): void
    {
        $a = $this->member('employee', 'cycle-a@example.com');
        $b = $this->member('employee', 'cycle-b@example.com');
        $c = $this->member('employee', 'cycle-c@example.com');

        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $b->id,
            'reporting_manager_id' => $a->id,
        ]);
        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $c->id,
            'reporting_manager_id' => $b->id,
        ]);

        // Direct self-reference.
        $this->assertTrue($this->resolver()->wouldCreateCycle($a->id, $a->id));
        // A -> C would close A -> B -> C -> A.
        $this->assertTrue($this->resolver()->wouldCreateCycle($a->id, $c->id));
        // A fresh person under C is fine.
        $d = $this->member('employee', 'cycle-d@example.com');
        $this->assertFalse($this->resolver()->wouldCreateCycle($d->id, $c->id));
        // Clearing is always allowed.
        $this->assertFalse($this->resolver()->wouldCreateCycle($a->id, null));
    }

    public function test_cycle_detection_terminates_on_pre_existing_bad_data(): void
    {
        // A loop already in the database must not hang the walk.
        $a = $this->member('employee', 'loop-a@example.com');
        $b = $this->member('employee', 'loop-b@example.com');

        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $a->id,
            'reporting_manager_id' => $b->id,
        ]);
        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $b->id,
            'reporting_manager_id' => $a->id,
        ]);

        $outsider = $this->member('employee', 'loop-outsider@example.com');

        $this->assertFalse($this->resolver()->wouldCreateCycle($outsider->id, $a->id));
    }

    public function test_an_explicit_reporting_line_survives_a_later_group_sync(): void
    {
        // The inversion: derivation is a default for new records, not something
        // that reasserts itself over a human decision on every later save.
        $manager = $this->member('manager', 'explicit-manager@example.com');
        $employee = $this->member('employee', 'explicit-employee@example.com');

        $otherManager = User::create([
            'name' => 'Cross Functional Lead',
            'email' => 'explicit-other@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $this->organization->id,
        ]);

        // An admin points the employee at a manager OUTSIDE their group —
        // something derivation cannot express at all.
        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $employee->id,
            'report_group_id' => $this->group->id,
            'reporting_manager_id' => $otherManager->id,
            'reporting_manager_source' => ReportingManagerResolver::SOURCE_EXPLICIT,
        ]);

        $this->resolver()->applyDerivedManager($this->organization->id, $employee->id, $this->group->id);

        $this->assertSame(
            $otherManager->id,
            (int) EmployeeWorkInfo::where('user_id', $employee->id)->value('reporting_manager_id'),
            'A hand-set reporting line must not be recomputed away',
        );
        $this->assertNotSame($manager->id, (int) EmployeeWorkInfo::where('user_id', $employee->id)->value('reporting_manager_id'));
    }

    public function test_authority_not_department_decides_a_valid_reporting_line(): void
    {
        // The rule every HRMS uses: your manager must outrank you. Department,
        // team and job title decide permissions and grouping — never parentage.
        $admin = $this->member('admin', 'authority-admin@example.com');
        $managerA = $this->member('manager', 'authority-mgr-a@example.com');
        $managerB = $this->member('manager', 'authority-mgr-b@example.com');
        $employee = $this->member('employee', 'authority-employee@example.com');

        $resolver = $this->resolver();

        // Legitimate, and deliberately allowed: a team lead under a department
        // head. Zoho's own documented example is CEO > VP > Manager > Executive.
        $this->assertTrue($resolver->canManage($admin, $managerA), 'manager may report to admin');
        $this->assertTrue($resolver->canManage($managerA, $employee), 'employee may report to manager');
        $this->assertTrue($resolver->canManage($admin, $employee), 'employee may report to admin if set deliberately');

        // Rejected: peers and inversions.
        $this->assertFalse($resolver->canManage($managerA, $managerB), 'peers cannot manage each other');
        $this->assertFalse($resolver->canManage($employee, $managerA), 'an employee cannot manage a manager');
        $this->assertFalse($resolver->canManage($managerA, $managerA), 'nobody manages themselves');
    }

    public function test_a_reporting_line_across_departments_is_valid(): void
    {
        // Derivation could never express this: an employee reporting to a lead
        // outside their own department. It is the whole reason the line has to
        // be declared rather than inferred.
        $employee = $this->member('employee', 'cross-dept-employee@example.com');

        $otherDepartmentLead = User::create([
            'name' => 'Other Department Lead',
            'email' => 'cross-dept-lead@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $this->organization->id,
        ]);

        // Deliberately NOT attached to $this->group.
        $this->assertTrue(
            $this->resolver()->canManage($otherDepartmentLead, $employee),
            'Department must not constrain who may manage whom',
        );
    }

    public function test_a_derived_reporting_line_is_still_refreshed(): void
    {
        $manager = $this->member('manager', 'derived-manager@example.com');
        $employee = $this->member('employee', 'derived-employee@example.com');

        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $employee->id,
            'reporting_manager_id' => null,
            'reporting_manager_source' => ReportingManagerResolver::SOURCE_DERIVED,
        ]);

        $this->resolver()->applyDerivedManager($this->organization->id, $employee->id, $this->group->id);

        $this->assertSame(
            $manager->id,
            (int) EmployeeWorkInfo::where('user_id', $employee->id)->value('reporting_manager_id'),
        );
    }
}
