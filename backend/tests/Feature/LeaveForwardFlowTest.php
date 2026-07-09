<?php

namespace Tests\Feature;

use App\Models\DepartmentTeam;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class LeaveForwardFlowTest extends TestCase
{
    use RefreshDatabase;

    private function makeUser(Organization $org, string $role, string $email, ?int $reportGroupId = null, ?int $reportingManagerId = null): User
    {
        $user = User::create([
            'name' => $email,
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $org->id,
        ]);

        if ($reportGroupId !== null || $reportingManagerId !== null) {
            EmployeeWorkInfo::create([
                'organization_id' => $org->id,
                'user_id' => $user->id,
                'report_group_id' => $reportGroupId,
                'reporting_manager_id' => $reportingManagerId,
            ]);
        }

        return $user;
    }

    public function test_manager_can_forward_to_another_manager_in_different_department(): void
    {
        $org = Organization::create(['name' => 'Org', 'slug' => 'org']);

        $admin = $this->makeUser($org, 'admin', 'admin@org.test');
        $deptA = Group::create(['organization_id' => $org->id, 'name' => 'Dept A', 'slug' => 'dept-a', 'is_active' => true]);
        $deptB = Group::create(['organization_id' => $org->id, 'name' => 'Dept B', 'slug' => 'dept-b', 'is_active' => true]);

        $managerA = $this->makeUser($org, 'manager', 'manager-a@org.test', $deptA->id, null);
        $managerB = $this->makeUser($org, 'manager', 'manager-b@org.test', $deptB->id, null);
        $employee = $this->makeUser($org, 'employee', 'employee@org.test', $deptA->id, $managerA->id);

        $managerA->groups()->attach($deptA->id);
        $employee->groups()->attach($deptA->id);
        $managerB->groups()->attach($deptB->id);

        DepartmentTeam::create(['organization_id' => $org->id, 'department_id' => $deptA->id, 'name' => 'Team A'])
            ->managers()->attach($managerA->id);
        DepartmentTeam::create(['organization_id' => $org->id, 'department_id' => $deptB->id, 'name' => 'Team B'])
            ->managers()->attach($managerB->id);

        $leaveDate = Carbon::tomorrow()->startOfDay();
        while ($leaveDate->isWeekend()) {
            $leaveDate->addDay();
        }

        $create = $this->postJson('/api/leave-requests', [
            'start_date' => $leaveDate->toDateString(),
            'end_date' => $leaveDate->toDateString(),
            'reason' => 'Forward test',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $leaveId = (int) $create->json('data.id');

        // Manager A (the current reviewer) should see Manager B (other dept) and the admin as forward targets.
        $targets = $this->getJson("/api/leave-requests/{$leaveId}/forward-targets", $this->apiHeadersFor($managerA))
            ->assertOk()
            ->json('data');

        $targetIds = collect($targets)->pluck('id')->all();
        $this->assertContains($managerB->id, $targetIds, 'Cross-department manager must be a forward target.');
        $this->assertContains($admin->id, $targetIds, 'Admin must be a forward target.');
        $this->assertNotContains($managerA->id, $targetIds, 'The current holder must not be a forward target.');

        // Manager A forwards the request to Manager B.
        $this->postJson("/api/leave-requests/{$leaveId}/transfer", [
            'to_user_id' => $managerB->id,
            'note' => 'Handing off',
        ], $this->apiHeadersFor($managerA))->assertOk();

        $this->assertDatabaseHas('leave_requests', [
            'id' => $leaveId,
            'escalated_to_user_id' => $managerB->id,
        ]);
    }

    public function test_admin_can_forward_request_even_when_not_current_reviewer(): void
    {
        $org = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = $this->makeUser($org, 'admin', 'admin2@org.test');
        $managerA = $this->makeUser($org, 'manager', 'mgr-a@org.test', null, null);
        $managerB = $this->makeUser($org, 'manager', 'mgr-b@org.test', null, null);
        $employee = $this->makeUser($org, 'employee', 'emp2@org.test', null, $managerA->id);

        $leaveDate = Carbon::tomorrow()->startOfDay();
        while ($leaveDate->isWeekend()) {
            $leaveDate->addDay();
        }

        $create = $this->postJson('/api/leave-requests', [
            'start_date' => $leaveDate->toDateString(),
            'end_date' => $leaveDate->toDateString(),
            'reason' => 'Admin forward test',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $leaveId = (int) $create->json('data.id');

        // Before the fix the admin was not a current reviewer and the transfer was Forbidden.
        // Admin delegates to Manager B (a different manager than the immediate reviewer).
        $this->postJson("/api/leave-requests/{$leaveId}/transfer", [
            'to_user_id' => $managerB->id,
            'note' => 'Delegated by admin',
        ], $this->apiHeadersFor($admin))->assertOk();

        $this->assertDatabaseHas('leave_requests', [
            'id' => $leaveId,
            'escalated_to_user_id' => $managerB->id,
        ]);
    }
}
