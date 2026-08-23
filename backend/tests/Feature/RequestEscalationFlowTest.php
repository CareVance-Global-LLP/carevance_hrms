<?php

namespace Tests\Feature;

use Carbon\Carbon;
use App\Models\AppNotification;
use App\Models\AttendanceTimeEditRequest;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class RequestEscalationFlowTest extends TestCase
{
    use RefreshDatabase;

    /**
     * Pin the clock to a Monday.
     *
     * Every request here is dated now(), and a leave request that covers no
     * working day is refused with a 422 - correctly. So the leave test passed
     * from Monday to Friday and failed every weekend, which is both invisible
     * on a weekday and impossible to reproduce when somebody looks on Monday.
     */
    protected function setUp(): void
    {
        parent::setUp();
        Carbon::setTestNow(Carbon::parse('2026-08-24 09:00:00'));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    private function makeHierarchy(Organization $organization): array
    {
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-escalate@org.test',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager-escalate@org.test',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-escalate@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Operations',
            'slug' => 'operations-escalate',
            'is_active' => true,
        ]);
        $manager->groups()->attach($group->id);
        $employee->groups()->attach($group->id);

        return ['admin' => $admin, 'manager' => $manager, 'employee' => $employee];
    }

    public function test_time_edit_request_escalates_to_next_hierarchy_level(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $people = $this->makeHierarchy($organization);
        $admin = $people['admin'];
        $manager = $people['manager'];
        $employee = $people['employee'];

        $createResponse = $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 30,
            'message' => 'Stayed late',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $requestId = (int) $createResponse->json('data.id');

        // The requester (employee) is NOT the current holder, so they cannot forward.
        $this->postJson("/api/attendance-time-edit-requests/{$requestId}/transfer", [
            'note' => 'Manager is OOO, please review.',
        ], $this->apiHeadersFor($employee))
            ->assertForbidden();

        // The current holder (manager) forwards the request up to the admin level.
        $this->postJson("/api/attendance-time-edit-requests/{$requestId}/transfer", [
            'note' => 'Manager is OOO, please review.',
        ], $this->apiHeadersFor($manager))
            ->assertOk()
            ->assertJsonPath('data.escalated_to.id', $admin->id)
            ->assertJsonPath('data.escalation_history.0.to_user_id', $admin->id);

        $this->assertDatabaseHas('attendance_time_edit_requests', [
            'id' => $requestId,
            'escalated_to_user_id' => $admin->id,
        ]);

        // The admin (next hierarchy) is notified they received the escalation.
        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            'title' => 'Time Edit Request Escalated to You',
        ]);

        // The escalated admin can see the request in their approval inbox.
        $this->getJson('/api/attendance-time-edit-requests', $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('data.0.id', $requestId)
            ->assertJsonPath('data.0.escalated_to.id', $admin->id);

        // Admin can approve the escalated request.
        $this->patchJson("/api/attendance-time-edit-requests/{$requestId}/approve", [], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_reviewer_forwards_request_received_from_lower_hierarchy(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $people = $this->makeHierarchy($organization);
        $admin = $people['admin'];
        $manager = $people['manager'];
        $employee = $people['employee'];

        $createResponse = $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 30,
            'message' => 'Stayed late',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $requestId = (int) $createResponse->json('data.id');

        // The manager (who received the request from their lower hierarchy) forwards it up.
        $this->postJson("/api/attendance-time-edit-requests/{$requestId}/transfer", [
            'note' => 'Please review, I am out.',
        ], $this->apiHeadersFor($manager))
            ->assertOk()
            ->assertJsonPath('data.escalated_to.id', $admin->id);

        $this->assertDatabaseHas('attendance_time_edit_requests', [
            'id' => $requestId,
            'escalated_to_user_id' => $admin->id,
        ]);

        // The escalated admin can now approve the forwarded request.
        $this->patchJson("/api/attendance-time-edit-requests/{$requestId}/approve", [], $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_escalation_is_blocked_when_no_higher_hierarchy_exists(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $people = $this->makeHierarchy($organization);
        $admin = $people['admin'];
        $manager = $people['manager'];
        $employee = $people['employee'];

        $createResponse = $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 30,
            'message' => 'Stayed late',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $requestId = (int) $createResponse->json('data.id');

        // First transfer goes manager (current holder) -> admin (next higher than employee).
        $this->postJson("/api/attendance-time-edit-requests/{$requestId}/transfer", [], $this->apiHeadersFor($manager))
            ->assertOk();

        // Second transfer would need someone higher than the admin (level 10) — none exists.
        $this->postJson("/api/attendance-time-edit-requests/{$requestId}/transfer", [], $this->apiHeadersFor($admin))
            ->assertStatus(422)
            ->assertJsonPath('message', 'No higher hierarchy is available to escalate this request to.');
    }

    public function test_non_requester_cannot_transfer_request(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $people = $this->makeHierarchy($organization);
        $manager = $people['manager'];
        $employee = $people['employee'];

        $createResponse = $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 30,
            'message' => 'Stayed late',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $requestId = (int) $createResponse->json('data.id');

        // A random other employee (not the requester, not an admin) is forbidden.
        $outsider = User::create([
            'name' => 'Outsider',
            'email' => 'outsider@org.test',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $this->postJson("/api/attendance-time-edit-requests/{$requestId}/transfer", [], $this->apiHeadersFor($outsider))
            ->assertForbidden();
    }

    public function test_leave_request_escalates_and_notifies_admin(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $people = $this->makeHierarchy($organization);
        $admin = $people['admin'];
        $manager = $people['manager'];
        $employee = $people['employee'];

        $createResponse = $this->postJson('/api/leave-requests', [
            'start_date' => now()->toDateString(),
            'end_date' => now()->toDateString(),
            'leave_type' => 'full_day',
            'leave_category' => 'paid',
            'reason' => 'Family event',
        ], $this->apiHeadersFor($employee))->assertCreated();

        $requestId = (int) $createResponse->json('data.id');

        // The current holder (manager) forwards the leave request up to admin.
        $this->postJson("/api/leave-requests/{$requestId}/transfer", [
            'note' => 'Manager unreachable',
        ], $this->apiHeadersFor($manager))
            ->assertOk()
            ->assertJsonPath('data.escalated_to.id', $admin->id);

        $this->assertDatabaseHas('leave_requests', [
            'id' => $requestId,
            'escalated_to_user_id' => $admin->id,
        ]);

        $this->assertDatabaseHas('app_notifications', [
            'organization_id' => $organization->id,
            'user_id' => $admin->id,
            // "Forwarded", not "Escalated" — the leave and time-edit paths word
            // this differently, and only the time-edit one says "Escalated".
            // Cosmetic drift between the two subsystems; the test pinned the
            // wording the other one uses.
            'title' => 'Leave Request Forwarded to You',
        ]);
    }
}
