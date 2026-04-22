<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Organization;
use App\Models\Task;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class GroupTaskAccessTest extends TestCase
{
    use RefreshDatabase;

    public function test_employee_only_receives_tasks_from_allowed_groups_and_assignments(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $admin = $this->createUser($organization, 'Admin', 'admin@carevance.test', 'admin');
        $employee = $this->createUser($organization, 'Digital Employee', 'digital@carevance.test', 'employee');
        $otherEmployee = $this->createUser($organization, 'IT Employee', 'it@carevance.test', 'employee');

        $digitalGroup = $this->createGroup($organization, 'Digital Marketing');
        $itGroup = $this->createGroup($organization, 'IT');

        $employee->groups()->attach($digitalGroup->id);
        $otherEmployee->groups()->attach($itGroup->id);

        $visibleTask = Task::create([
            'group_id' => $digitalGroup->id,
            'title' => 'Plan campaign assets',
            'status' => 'todo',
            'priority' => 'medium',
            'assignee_id' => $employee->id,
        ]);

        $unassignedGroupTask = Task::create([
            'group_id' => $digitalGroup->id,
            'title' => 'Review landing page copy',
            'status' => 'todo',
            'priority' => 'medium',
            'assignee_id' => null,
        ]);

        $sameGroupButOtherAssignee = Task::create([
            'group_id' => $digitalGroup->id,
            'title' => 'Schedule newsletter send',
            'status' => 'todo',
            'priority' => 'medium',
            'assignee_id' => $admin->id,
        ]);

        $crossGroupTask = Task::create([
            'group_id' => $itGroup->id,
            'title' => 'Rotate API keys',
            'status' => 'todo',
            'priority' => 'high',
            'assignee_id' => $otherEmployee->id,
        ]);

        $response = $this->getJson('/api/tasks', $this->apiHeadersFor($employee))
            ->assertOk();

        $this->assertSame([$visibleTask->id, $unassignedGroupTask->id], collect($response->json())
            ->pluck('id')
            ->sort()
            ->values()
            ->all());

        $this->getJson("/api/tasks/{$visibleTask->id}", $this->apiHeadersFor($employee))
            ->assertOk()
            ->assertJsonPath('group.id', $digitalGroup->id);

        $this->getJson("/api/tasks/{$sameGroupButOtherAssignee->id}", $this->apiHeadersFor($employee))
            ->assertForbidden();

        $this->getJson("/api/tasks/{$crossGroupTask->id}", $this->apiHeadersFor($employee))
            ->assertForbidden();
    }

    public function test_manager_cannot_create_tasks_even_for_visible_groups(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $manager = $this->createUser($organization, 'Group Manager', 'manager@carevance.test', 'manager');
        $employee = $this->createUser($organization, 'Digital Employee', 'digital@carevance.test', 'employee');

        $digitalGroup = $this->createGroup($organization, 'Digital Marketing');
        $itGroup = $this->createGroup($organization, 'IT');

        $manager->groups()->attach($digitalGroup->id);
        $employee->groups()->attach($digitalGroup->id);

        $headers = $this->apiHeadersFor($manager);

        $this->postJson('/api/tasks', [
            'group_id' => $digitalGroup->id,
            'title' => 'Prepare social media calendar',
            'priority' => 'medium',
            'assignee_id' => $employee->id,
        ], $headers)
            ->assertForbidden();

        $this->postJson('/api/tasks', [
            'group_id' => $itGroup->id,
            'title' => 'Provision a new laptop',
            'priority' => 'medium',
        ], $headers)
            ->assertForbidden();
    }

    public function test_manager_cannot_create_groups(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $manager = $this->createUser($organization, 'Group Manager', 'manager-groups@carevance.test', 'manager');
        $employee = $this->createUser($organization, 'Digital Employee', 'digital-groups@carevance.test', 'employee');

        $this->postJson('/api/report-groups', [
            'name' => 'Operations',
            'description' => 'Operations team',
            'user_ids' => [$employee->id],
        ], $this->apiHeadersFor($manager))
            ->assertForbidden();
    }

    public function test_manager_cannot_create_users_from_users_endpoint(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $manager = $this->createUser($organization, 'People Manager', 'people-manager@carevance.test', 'manager');

        $this->postJson('/api/users', [
            'name' => 'Blocked Employee',
            'email' => 'blocked-employee@carevance.test',
            'password' => 'password123',
            'role' => 'employee',
        ], $this->apiHeadersFor($manager))
            ->assertForbidden();
    }

    public function test_task_assignment_is_rejected_when_user_is_not_in_the_selected_group(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $admin = $this->createUser($organization, 'Admin', 'admin@carevance.test', 'admin');
        $digitalEmployee = $this->createUser($organization, 'Digital Employee', 'digital@carevance.test', 'employee');
        $itEmployee = $this->createUser($organization, 'IT Employee', 'it@carevance.test', 'employee');

        $digitalGroup = $this->createGroup($organization, 'Digital Marketing');
        $itGroup = $this->createGroup($organization, 'IT');

        $digitalEmployee->groups()->attach($digitalGroup->id);
        $itEmployee->groups()->attach($itGroup->id);

        $this->postJson('/api/tasks', [
            'group_id' => $digitalGroup->id,
            'title' => 'Draft paid ads brief',
            'priority' => 'high',
            'assignee_id' => $itEmployee->id,
        ], $this->apiHeadersFor($admin))
            ->assertStatus(422)
            ->assertJsonValidationErrors('assignee_id')
            ->assertJsonPath('errors.assignee_id.0', 'Assigned user must belong to the selected group.');
    }

    public function test_timer_only_query_accepts_true_string_and_filters_done_tasks(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $employee = $this->createUser($organization, 'Timer Employee', 'timer@carevance.test', 'employee');
        $group = $this->createGroup($organization, 'IT');
        $employee->groups()->attach($group->id);

        $todoTask = Task::create([
            'group_id' => $group->id,
            'title' => 'Keep alive check',
            'status' => 'todo',
            'priority' => 'medium',
            'assignee_id' => null,
        ]);

        Task::create([
            'group_id' => $group->id,
            'title' => 'Completed maintenance',
            'status' => 'done',
            'priority' => 'medium',
            'assignee_id' => null,
        ]);

        $response = $this->getJson('/api/tasks?timer_only=true', $this->apiHeadersFor($employee))
            ->assertOk();

        $this->assertSame([$todoTask->id], collect($response->json())
            ->pluck('id')
            ->values()
            ->all());
    }

    public function test_admin_can_reassign_manager_group_membership(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $admin = $this->createUser($organization, 'Admin', 'admin@carevance.test', 'admin');
        $manager = $this->createUser($organization, 'Manager', 'manager@carevance.test', 'manager');

        $operationsGroup = $this->createGroup($organization, 'Operations');
        $digitalGroup = $this->createGroup($organization, 'Digital Marketing');

        $manager->groups()->sync([$operationsGroup->id]);

        $this->putJson("/api/users/{$manager->id}", [
            'group_ids' => [$digitalGroup->id],
        ], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('groups.0.id', $digitalGroup->id);
    }

    public function test_admin_cannot_assign_employee_to_multiple_groups(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $admin = $this->createUser($organization, 'Admin', 'admin@carevance.test', 'admin');
        $employee = $this->createUser($organization, 'Employee', 'employee@carevance.test', 'employee');

        $operationsGroup = $this->createGroup($organization, 'Operations');
        $digitalGroup = $this->createGroup($organization, 'Digital Marketing');

        $this->putJson("/api/users/{$employee->id}", [
            'group_ids' => [$operationsGroup->id, $digitalGroup->id],
        ], $this->apiHeadersFor($admin))
            ->assertStatus(422)
            ->assertJsonValidationErrors('group_ids')
            ->assertJsonPath('errors.group_ids.0', 'Managers and employees can belong to only one group at a time.');
    }

    public function test_manager_cannot_reassign_another_manager_group_membership(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance']);

        $actingManager = $this->createUser($organization, 'Acting Manager', 'acting-manager@carevance.test', 'manager');
        $targetManager = $this->createUser($organization, 'Target Manager', 'target-manager@carevance.test', 'manager');

        $operationsGroup = $this->createGroup($organization, 'Operations');
        $digitalGroup = $this->createGroup($organization, 'Digital Marketing');

        $actingManager->groups()->sync([$operationsGroup->id]);
        $targetManager->groups()->sync([$operationsGroup->id]);

        $this->putJson("/api/users/{$targetManager->id}", [
            'group_ids' => [$digitalGroup->id],
        ], $this->apiHeadersFor($actingManager))
            ->assertForbidden();
    }

    public function test_manager_only_sees_employees_from_their_own_group(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-visible-users']);

        $manager = $this->createUser($organization, 'Group Manager', 'manager-visible@carevance.test', 'manager');
        $sameGroupEmployee = $this->createUser($organization, 'Same Group Employee', 'same-group@carevance.test', 'employee');
        $otherGroupEmployee = $this->createUser($organization, 'Other Group Employee', 'other-group@carevance.test', 'employee');

        $digitalGroup = $this->createGroup($organization, 'Digital Marketing');
        $itGroup = $this->createGroup($organization, 'IT');

        $manager->groups()->sync([$digitalGroup->id]);
        $sameGroupEmployee->groups()->sync([$digitalGroup->id]);
        $otherGroupEmployee->groups()->sync([$itGroup->id]);

        $response = $this->getJson('/api/users', $this->apiHeadersFor($manager))
            ->assertOk();

        $returnedIds = collect($response->json())->pluck('id')->sort()->values()->all();

        $this->assertSame([$manager->id, $sameGroupEmployee->id], $returnedIds);
        $this->getJson("/api/users/{$sameGroupEmployee->id}", $this->apiHeadersFor($manager))->assertOk();
        $this->getJson("/api/users/{$otherGroupEmployee->id}", $this->apiHeadersFor($manager))->assertForbidden();
    }

    public function test_assigning_manager_to_group_syncs_employee_reporting_manager(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-reporting-sync']);

        $admin = $this->createUser($organization, 'Admin', 'admin-sync@carevance.test', 'admin');
        $manager = $this->createUser($organization, 'Manager', 'manager-sync@carevance.test', 'manager');
        $employee = $this->createUser($organization, 'Employee', 'employee-sync@carevance.test', 'employee');

        $operationsGroup = $this->createGroup($organization, 'Operations');

        $this->putJson("/api/users/{$employee->id}", [
            'group_ids' => [$operationsGroup->id],
        ], $this->apiHeadersFor($admin))->assertOk();

        $this->putJson("/api/users/{$manager->id}", [
            'group_ids' => [$operationsGroup->id],
        ], $this->apiHeadersFor($admin))->assertOk();

        $workInfo = EmployeeWorkInfo::query()
            ->where('organization_id', $organization->id)
            ->where('user_id', $employee->id)
            ->first();

        $this->assertNotNull($workInfo);
        $this->assertSame($operationsGroup->id, (int) $workInfo->report_group_id);
        $this->assertSame($manager->id, (int) $workInfo->reporting_manager_id);
    }

    public function test_manager_attendance_report_only_includes_own_group_employees(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-attendance-scope']);

        $manager = $this->createUser($organization, 'Group Manager', 'manager-attendance@carevance.test', 'manager');
        $sameGroupEmployee = $this->createUser($organization, 'Same Group Employee', 'same-attendance@carevance.test', 'employee');
        $otherGroupEmployee = $this->createUser($organization, 'Other Group Employee', 'other-attendance@carevance.test', 'employee');

        $digitalGroup = $this->createGroup($organization, 'Digital Marketing');
        $itGroup = $this->createGroup($organization, 'IT');

        $manager->groups()->sync([$digitalGroup->id]);
        $sameGroupEmployee->groups()->sync([$digitalGroup->id]);
        $otherGroupEmployee->groups()->sync([$itGroup->id]);

        AttendanceRecord::create([
            'organization_id' => $organization->id,
            'user_id' => $sameGroupEmployee->id,
            'attendance_date' => Carbon::parse('2026-04-22')->toDateString(),
            'status' => 'present',
            'check_in_at' => Carbon::parse('2026-04-22 09:00:00'),
            'check_out_at' => Carbon::parse('2026-04-22 18:00:00'),
            'worked_seconds' => 8 * 3600,
        ]);

        AttendanceRecord::create([
            'organization_id' => $organization->id,
            'user_id' => $otherGroupEmployee->id,
            'attendance_date' => Carbon::parse('2026-04-22')->toDateString(),
            'status' => 'present',
            'check_in_at' => Carbon::parse('2026-04-22 09:15:00'),
            'check_out_at' => Carbon::parse('2026-04-22 18:15:00'),
            'worked_seconds' => 8 * 3600,
        ]);

        $response = $this->getJson('/api/reports/attendance?start_date=2026-04-22&end_date=2026-04-22', $this->apiHeadersFor($manager))
            ->assertOk();

        $returnedIds = collect($response->json('data'))->pluck('user.id')->sort()->values()->all();
        $this->assertSame([$sameGroupEmployee->id], $returnedIds);
    }

    public function test_manager_overall_report_only_includes_own_group_employees(): void
    {
        $organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-overall-scope']);

        $manager = $this->createUser($organization, 'Group Manager', 'manager-overall@carevance.test', 'manager');
        $sameGroupEmployee = $this->createUser($organization, 'Same Group Employee', 'same-overall@carevance.test', 'employee');
        $otherGroupEmployee = $this->createUser($organization, 'Other Group Employee', 'other-overall@carevance.test', 'employee');

        $digitalGroup = $this->createGroup($organization, 'Digital Marketing');
        $itGroup = $this->createGroup($organization, 'IT');

        $manager->groups()->sync([$digitalGroup->id]);
        $sameGroupEmployee->groups()->sync([$digitalGroup->id]);
        $otherGroupEmployee->groups()->sync([$itGroup->id]);

        $response = $this->getJson('/api/reports/overall?start_date=2026-04-22&end_date=2026-04-22', $this->apiHeadersFor($manager))
            ->assertOk();

        $returnedIds = collect($response->json('by_user'))->pluck('user.id')->sort()->values()->all();
        $this->assertSame([$sameGroupEmployee->id], $returnedIds);
    }

    private function createUser(Organization $organization, string $name, string $email, string $role): User
    {
        return User::create([
            'name' => $name,
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    private function createGroup(Organization $organization, string $name): Group
    {
        return Group::create([
            'organization_id' => $organization->id,
            'name' => $name,
            'slug' => str($name)->slug()->toString(),
            'is_active' => true,
        ]);
    }
}
