<?php

namespace Tests\Feature;

use App\Models\AttendanceHoliday;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class AttendanceTimeEditRestrictionTest extends TestCase
{
    use RefreshDatabase;

    public function test_employee_cannot_request_time_edit_on_holiday(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-holiday@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
            'settings' => ['country' => 'India'],
        ]);

        $holidayDate = now()->toDateString();
        AttendanceHoliday::create([
            'organization_id' => $organization->id,
            'holiday_date' => $holidayDate,
            'country' => 'INDIA',
            'title' => 'Festival Holiday',
            'created_by' => $employee->id,
            'updated_by' => $employee->id,
        ]);

        $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => $holidayDate,
            'extra_minutes' => 30,
            'message' => 'Worked extra',
        ], $this->apiHeadersFor($employee))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Time edit request is not allowed on holidays.');
    }

    public function test_employee_cannot_request_time_edit_on_approved_leave_date(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-leave@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $leaveDate = now()->toDateString();
        LeaveRequest::create([
            'organization_id' => $organization->id,
            'user_id' => $employee->id,
            'start_date' => $leaveDate,
            'end_date' => $leaveDate,
            'reason' => 'Personal',
            'status' => 'approved',
        ]);

        $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => $leaveDate,
            'extra_minutes' => 20,
            'message' => 'Worked extra',
        ], $this->apiHeadersFor($employee))
            ->assertStatus(422)
            ->assertJsonPath('message', 'Time edit request is not allowed on approved leave days.');
    }

    public function test_employee_cannot_request_time_edit_when_disabled_in_user_settings(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-time-edit-disabled@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
            'settings' => ['can_edit_time' => false],
        ]);

        $this->postJson('/api/attendance-time-edit-requests', [
            'attendance_date' => now()->toDateString(),
            'extra_minutes' => 20,
            'message' => 'Worked extra',
        ], $this->apiHeadersFor($employee))
            ->assertStatus(403)
            ->assertJsonPath('message', 'Time edit requests are disabled for your account.');
    }
}
