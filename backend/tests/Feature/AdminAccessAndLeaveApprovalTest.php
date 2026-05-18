<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\AppNotification;
use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AdminAccessAndLeaveApprovalTest extends TestCase
{
    use RefreshDatabase;

    public function test_employee_leave_request_notifies_same_group_manager_and_admin_cannot_approve_employee_request(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-leave-routing@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-leave-routing@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-leave-routing@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Operations',
            'slug' => 'operations',
            'is_active' => true,
        ]);
        $manager->groups()->attach($group->id);
        $employee->groups()->attach($group->id);

        $leaveDate = Carbon::tomorrow()->startOfDay();
        while ($leaveDate->isWeekend()) {
            $leaveDate->addDay();
        }

        $createResponse = $this->postJson('/api/leave-requests', [
            'start_date' => $leaveDate->toDateString(),
            'end_date' => $leaveDate->toDateString(),
            'reason' => 'Family function',
        ], $this->apiHeadersFor($employee))
            ->assertCreated()
            ->assertJsonPath('data.approval_destination', 'Sent to your group manager: Manager');

        $leaveId = (int) $createResponse->json('data.id');

        $this->getJson('/api/leave-requests', $this->apiHeadersFor($employee))
            ->assertOk()
            ->assertJsonPath('data.0.approval_destination', 'Sent to your group manager: Manager');

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $manager->id,
            'title' => 'Leave Request Submitted',
        ]);
        $this->assertDatabaseMissing('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            'title' => 'Leave Request Submitted',
        ]);

        $this->patchJson("/api/leave-requests/{$leaveId}/approve", [], $this->apiHeadersFor($admin))
            ->assertForbidden();

        $this->patchJson("/api/leave-requests/{$leaveId}/approve", [], $this->apiHeadersFor($manager))
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');

        $notification = AppNotification::query()
            ->where('organization_id', $organization->id)
            ->where('user_id', $employee->id)
            ->latest()
            ->first();

        $this->assertNotNull($notification);
        $this->assertSame('Leave Request Approved', $notification->title);
    }

    public function test_employee_leave_request_requires_a_manager_in_the_same_group(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-no-group-manager@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Design',
            'slug' => 'design',
            'is_active' => true,
        ]);
        $employee->groups()->attach($group->id);

        $leaveDate = Carbon::tomorrow()->startOfDay();
        while ($leaveDate->isWeekend()) {
            $leaveDate->addDay();
        }

        $this->postJson('/api/leave-requests', [
            'start_date' => $leaveDate->toDateString(),
            'end_date' => $leaveDate->toDateString(),
            'reason' => 'Personal work',
        ], $this->apiHeadersFor($employee))
            ->assertStatus(422)
            ->assertJsonPath('message', 'No manager is assigned to your group yet. Please contact an admin.');
    }

    public function test_employee_leave_request_is_reviewable_by_reporting_manager_without_shared_group(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-reporting-scope@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-reporting-scope@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Design',
            'slug' => 'design-reporting-scope',
            'is_active' => true,
        ]);
        $employee->groups()->attach($group->id);

        EmployeeWorkInfo::create([
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'report_group_id' => $group->id,
            'reporting_manager_id' => $manager->id,
        ]);

        $leaveDate = Carbon::tomorrow()->startOfDay();
        while ($leaveDate->isWeekend()) {
            $leaveDate->addDay();
        }

        $this->postJson('/api/leave-requests', [
            'start_date' => $leaveDate->toDateString(),
            'end_date' => $leaveDate->toDateString(),
            'reason' => 'Reporting manager review path',
        ], $this->apiHeadersFor($employee))
            ->assertCreated();

        $this->getJson('/api/leave-requests?status=pending', $this->apiHeadersFor($manager))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.user.id', $employee->id);
    }

    public function test_manager_leave_request_notifies_admin_and_manager_cannot_self_approve(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-review-leave@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-review-leave@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);

        $leaveDate = Carbon::tomorrow()->startOfDay();
        while ($leaveDate->isWeekend()) {
            $leaveDate->addDay();
        }

        $createResponse = $this->postJson('/api/leave-requests', [
            'start_date' => $leaveDate->toDateString(),
            'end_date' => $leaveDate->toDateString(),
            'reason' => 'Manager leave',
        ], $this->apiHeadersFor($manager))->assertCreated();

        $leaveId = (int) $createResponse->json('data.id');

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            'title' => 'Leave Request Submitted',
        ]);
        $this->assertDatabaseMissing('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $manager->id,
            'title' => 'Leave Request Submitted',
        ]);

        $this->patchJson("/api/leave-requests/{$leaveId}/approve", [], $this->apiHeadersFor($manager))
            ->assertForbidden();

        $this->patchJson("/api/leave-requests/{$leaveId}/approve", [], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_admin_can_list_pending_manager_leave_with_mixed_case_roles(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-mixed-role@org.test',
            'password' => Hash::make('password123'),
            'role' => ' Admin ',
            'organization_id' => $organization->id,
        ]);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-mixed-role@org.test',
            'password' => Hash::make('password123'),
            'role' => ' Manager ',
            'organization_id' => $organization->id,
        ]);

        $leaveDate = Carbon::tomorrow()->startOfDay();
        while ($leaveDate->isWeekend()) {
            $leaveDate->addDay();
        }

        $this->postJson('/api/leave-requests', [
            'start_date' => $leaveDate->toDateString(),
            'end_date' => $leaveDate->toDateString(),
            'reason' => 'Manager leave with mixed role formatting',
        ], $this->apiHeadersFor($manager))->assertCreated();

        $this->getJson('/api/leave-requests?status=pending', $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.user.id', $manager->id);
    }

    public function test_leave_request_approval_marks_leave_and_updates_attendance(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-attendance@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Support',
            'slug' => 'support',
            'is_active' => true,
        ]);
        $manager->groups()->attach($group->id);
        $employee->groups()->attach($group->id);

        $employeeHeaders = $this->apiHeadersFor($employee);
        $managerHeaders = $this->apiHeadersFor($manager);
        $leaveDate = Carbon::tomorrow()->startOfDay();
        while ($leaveDate->isWeekend()) {
            $leaveDate->addDay();
        }

        $date = $leaveDate->toDateString();

        $createResponse = $this->postJson('/api/leave-requests', [
            'start_date' => $date,
            'end_date' => $date,
            'reason' => 'Doctor appointment',
        ], $employeeHeaders)->assertCreated();

        $leaveId = (int) $createResponse->json('data.id');

        $this->patchJson("/api/leave-requests/{$leaveId}/approve", [], $managerHeaders)
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');

        $leave = LeaveRequest::findOrFail($leaveId);
        $attendance = AttendanceRecord::where('user_id', $employee->id)
            ->whereDate('attendance_date', $date)
            ->first();

        $this->assertSame('approved', $leave->status);
        $this->assertNotNull($attendance);
        $this->assertSame('absent', $attendance->status);
    }

    public function test_half_day_leave_approval_marks_attendance_as_half_leave(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-half-day@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-half-day@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Support',
            'slug' => 'support-half-day',
            'is_active' => true,
        ]);
        $manager->groups()->attach($group->id);
        $employee->groups()->attach($group->id);

        $leaveDate = Carbon::tomorrow()->startOfDay();
        while ($leaveDate->isWeekend()) {
            $leaveDate->addDay();
        }

        $createResponse = $this->postJson('/api/leave-requests', [
            'start_date' => $leaveDate->toDateString(),
            'end_date' => $leaveDate->toDateString(),
            'leave_type' => 'half_day',
            'reason' => 'Half day leave',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $leaveId = (int) $createResponse->json('data.id');

        $this->patchJson("/api/leave-requests/{$leaveId}/approve", [], $this->apiHeadersFor($manager))
            ->assertOk()
            ->assertJsonPath('data.leave_type', 'half_day');

        $attendance = AttendanceRecord::where('user_id', $employee->id)
            ->whereDate('attendance_date', $leaveDate->toDateString())
            ->first();

        $this->assertNotNull($attendance);
        $this->assertSame('half_leave', $attendance->status);
    }

    public function test_expired_pending_leave_request_is_auto_cancelled_and_removed_from_pending_results(): void
    {
        Carbon::setTestNow('2026-04-10 10:00:00');

        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-expired-leave@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-expired-leave@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Support',
            'slug' => 'support-expired-leave',
            'is_active' => true,
        ]);
        $manager->groups()->attach($group->id);
        $employee->groups()->attach($group->id);

        $leave = LeaveRequest::create([
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'start_date' => '2026-04-09',
            'end_date' => '2026-04-09',
            'leave_type' => 'full_day',
            'reason' => 'Old pending leave',
            'status' => 'pending',
        ]);

        $this->getJson('/api/leave-requests?status=pending', $this->apiHeadersFor($manager))
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $leave->refresh();

        $this->assertSame('auto_cancelled', $leave->status);

        $this->patchJson("/api/leave-requests/{$leave->id}/approve", [], $this->apiHeadersFor($manager))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Only pending requests can be approved.');

        Carbon::setTestNow();
    }

    public function test_employee_is_forbidden_from_admin_reports_and_org_settings_but_admin_is_allowed(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin2@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee2@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $this->getJson('/api/reports/overall', $this->apiHeadersFor($employee))->assertForbidden();
        $this->putJson('/api/settings/organization', [
            'name' => 'Changed Org',
            'slug' => 'changed-org',
        ], $this->apiHeadersFor($employee))->assertForbidden();

        $this->getJson('/api/reports/overall', $this->apiHeadersFor($admin))->assertOk();
        $this->putJson('/api/settings/organization', [
            'name' => 'Changed Org',
            'slug' => 'changed-org',
        ], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('organization.name', 'Changed Org');
    }
}
