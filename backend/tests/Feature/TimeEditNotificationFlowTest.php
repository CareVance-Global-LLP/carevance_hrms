<?php

namespace Tests\Feature;

use App\Models\AppNotification;
use App\Models\AttendanceTimeEditRequest;
use App\Models\Group;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class TimeEditNotificationFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_employee_time_edit_request_notifies_same_group_manager_and_blocks_admin_review(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-routing@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-routing@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-routing@org.test',
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

        $createResponse = $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 30,
            'message' => 'Stayed late for release handoff',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $requestId = (int) $createResponse->json('data.id');

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $manager->id,
            'title' => 'Time Edit Request Submitted',
        ]);
        $this->assertDatabaseMissing('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            'title' => 'Time Edit Request Submitted',
        ]);

        $this->patchJson("/api/attendance-time-edit-requests/{$requestId}/approve", [], $this->apiHeadersFor($admin))
            ->assertForbidden();

        $this->patchJson("/api/attendance-time-edit-requests/{$requestId}/approve", [], $this->apiHeadersFor($manager))
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_employee_time_edit_request_requires_a_manager_in_the_same_group(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-no-manager@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'QA',
            'slug' => 'qa',
            'is_active' => true,
        ]);
        $employee->groups()->attach($group->id);

        $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 30,
            'message' => 'Stayed late for release handoff',
        ], $this->apiHeadersFor($employee))
            ->assertStatus(422)
            ->assertJsonPath('message', 'No manager is assigned to your group yet. Please contact an admin.');
    }

    public function test_manager_time_edit_request_notifies_admin_and_manager_cannot_self_approve(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-manager-flow@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-self-review@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);

        $createResponse = $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 45,
            'message' => 'Late incident resolution',
        ], $this->apiHeadersFor($manager))->assertCreated();

        $requestId = (int) $createResponse->json('data.id');

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            'title' => 'Time Edit Request Submitted',
        ]);
        $this->assertDatabaseMissing('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $manager->id,
            'title' => 'Time Edit Request Submitted',
        ]);

        $this->patchJson("/api/attendance-time-edit-requests/{$requestId}/approve", [], $this->apiHeadersFor($manager))
            ->assertForbidden();

        $this->patchJson("/api/attendance-time-edit-requests/{$requestId}/approve", [], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_rejecting_employee_time_edit_notifies_employee_with_rejected_status(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
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
        $admin->groups()->attach($group->id);
        $employee->groups()->attach($group->id);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-reject@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);
        $manager->groups()->attach($group->id);

        $createResponse = $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 60,
            'message' => 'Release support',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $requestId = (int) $createResponse->json('data.id');

        $this->patchJson("/api/attendance-time-edit-requests/{$requestId}/reject", [
            'review_note' => 'Overtime could not be approved.',
        ], $this->apiHeadersFor($manager))
            ->assertOk()
            ->assertJsonPath('message', 'Time edit request rejected.');

        $notification = AppNotification::query()
            ->where('organization_id', $organization->id)
            ->where('user_id', $employee->id)
            ->latest()
            ->first();

        $this->assertNotNull($notification);
        $this->assertSame('Time Edit Request Rejected', $notification->title);
        $this->assertStringContainsString('was rejected by Manager', $notification->message);
        $this->assertStringContainsString('Overtime could not be approved.', $notification->message);
    }

    public function test_rejecting_own_time_edit_request_does_not_leave_submit_notification_as_latest(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Ayush',
            'email' => 'ayush@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $createResponse = $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 60,
            'message' => 'Worked late on deployment',
        ], $this->apiHeadersFor($admin))->assertCreated();

        $requestId = (int) $createResponse->json('data.id');

        $this->assertDatabaseHas('attendance_time_edit_requests', [
            'id' => $requestId,
            'status' => 'pending',
        ]);

        $this->assertDatabaseMissing('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            'title' => 'Time Edit Request Submitted',
        ]);

        $this->patchJson("/api/attendance-time-edit-requests/{$requestId}/reject", [], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('message', 'Time edit request rejected.');

        $notification = AppNotification::query()
            ->where('organization_id', $organization->id)
            ->where('user_id', $admin->id)
            ->latest()
            ->first();

        $request = AttendanceTimeEditRequest::findOrFail($requestId);

        $this->assertSame('rejected', $request->status);
        $this->assertNotNull($notification);
        $this->assertSame('Time Edit Request Rejected', $notification->title);
        $this->assertStringContainsString('Your time edit request for', $notification->message);
        $this->assertStringNotContainsString('submitted a time edit request', $notification->message);
    }
}
