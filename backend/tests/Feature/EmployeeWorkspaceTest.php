<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\PayrollProfile;
use App\Models\Project;
use App\Models\ReportGroup;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMiddleware;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class EmployeeWorkspaceTest extends TestCase
{
    use RefreshDatabase;
    use WithoutMiddleware;

    public function test_admin_can_read_and_update_employee_workspace(): void
    {
        Storage::fake('public');

        $org = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);

        $manager = User::create([
            'name' => 'Manager User',
            'email' => 'manager@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'organization_id' => $org->id,
        ]);

        $employee = User::create([
            'name' => 'Ava Employee',
            'email' => 'employee@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
        ]);

        $department = ReportGroup::create([
            'organization_id' => $org->id,
            'name' => 'Operations',
        ]);
        $manager->groups()->sync([$department->id]);
        $employee->groups()->sync([$department->id]);

        PayrollProfile::create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'currency' => 'INR',
            'payout_method' => 'bank_transfer',
            'bank_name' => 'SBI',
            'bank_account_number' => '1234567890',
            'bank_ifsc_swift' => 'SBIN0000123',
            'payroll_eligible' => true,
            'reimbursements_eligible' => true,
            'is_active' => true,
        ]);

        AttendanceRecord::create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'attendance_date' => now()->startOfMonth()->toDateString(),
            'status' => 'present',
            'check_in_at' => now()->startOfMonth()->setHour(9),
            'check_out_at' => now()->startOfMonth()->setHour(18),
            'worked_seconds' => 8 * 3600,
            'manual_adjustment_seconds' => 0,
            'late_minutes' => 10,
        ]);

        LeaveRequest::create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'start_date' => now()->startOfMonth()->addDays(2)->toDateString(),
            'end_date' => now()->startOfMonth()->addDays(2)->toDateString(),
            'reason' => 'Medical leave',
            'status' => 'approved',
        ]);

        $this->actingAs($admin)
            ->putJson("/api/employees/{$employee->id}/profile", [
                'first_name' => 'Ava',
                'last_name' => 'Sharma',
            ])
            ->assertForbidden();

        $this->actingAs($employee)
            ->putJson("/api/employees/{$employee->id}/profile", [
                'first_name' => 'Ava',
                'last_name' => 'Sharma',
                'display_name' => 'Ava Sharma',
                'gender' => 'female',
                'phone' => '9999999999',
                'personal_email' => 'ava.personal@test.com',
                'city' => 'Bengaluru',
                'state' => 'Karnataka',
            ])
            ->assertOk()
            ->assertJsonPath('first_name', 'Ava');

        $this->actingAs($admin)
            ->putJson("/api/employees/{$employee->id}/work-info", [
                'employee_code' => 'EMP-1001',
                'report_group_id' => $department->id,
                'designation' => 'Operations Executive',
                'reporting_manager_id' => $manager->id,
                'work_location' => 'Bengaluru HQ',
                'employment_type' => 'Full Time',
                'joining_date' => now()->subMonths(4)->toDateString(),
                'employment_status' => 'active',
                'work_mode' => 'hybrid',
            ])
            ->assertOk()
            ->assertJsonPath('employee_code', 'EMP-1001');

        $this->actingAs($admin)
            ->post("/api/employees/{$employee->id}/documents", [
                'title' => 'Offer Letter',
                'category' => 'offer_letter',
                'review_status' => 'verified',
                'file' => UploadedFile::fake()->create('offer-letter.pdf', 120, 'application/pdf'),
            ])
            ->assertCreated()
            ->assertJsonPath('title', 'Offer Letter');

        $this->actingAs($admin)
            ->post("/api/employees/{$employee->id}/government-ids", [
                'id_type' => 'PAN',
                'id_number' => 'ABCDE1234F',
                'status' => 'verified',
            ])
            ->assertCreated()
            ->assertJsonPath('id_type', 'PAN');

        $this->actingAs($admin)
            ->postJson("/api/employees/{$employee->id}/bank-accounts", [
                'account_holder_name' => 'Ava Sharma',
                'bank_name' => 'HDFC Bank',
                'account_number' => '9876543210',
                'ifsc_swift' => 'HDFC0000456',
                'payout_method' => 'bank_transfer',
                'verification_status' => 'verified',
                'is_default' => true,
            ])
            ->assertCreated()
            ->assertJsonPath('bank_name', 'HDFC Bank');

        $this->actingAs($admin)
            ->getJson("/api/employees/{$employee->id}/workspace")
            ->assertOk()
            ->assertJsonPath('employee.id', $employee->id)
            ->assertJsonPath('about.first_name', 'Ava')
            ->assertJsonPath('work_info.employee_code', 'EMP-1001')
            ->assertJsonPath('payroll.profile.user_id', $employee->id)
            ->assertJsonPath('overview.documents_uploaded', 1)
            ->assertJsonCount(1, 'government_ids')
            ->assertJsonCount(1, 'bank_accounts')
            ->assertJsonCount(1, 'documents');
    }

    public function test_only_admin_can_delete_users(): void
    {
        $this->withMiddleware();

        $org = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-delete',
        ]);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin-delete@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);

        $manager = User::create([
            'name' => 'Manager User',
            'email' => 'manager-delete@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'organization_id' => $org->id,
        ]);

        $employee = User::create([
            'name' => 'Delete Me',
            'email' => 'employee-delete@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
        ]);

        $this->withHeaders($this->apiHeadersFor($manager))
            ->deleteJson("/api/users/{$employee->id}")
            ->assertForbidden();

        $this->assertDatabaseHas('users', [
            'id' => $employee->id,
            'email' => 'employee-delete@carevance.test',
        ]);

        $this->withHeaders($this->apiHeadersFor($admin))
            ->deleteJson("/api/users/{$employee->id}")
            ->assertOk()
            ->assertJsonPath('message', 'User deleted');

        $this->assertDatabaseMissing('users', [
            'id' => $employee->id,
        ]);
    }

    public function test_profile_360_includes_employee_assignment_and_project_breakdown(): void
    {
        $org = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-profile-360',
        ]);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin-profile@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);

        $manager = User::create([
            'name' => 'Manager User',
            'email' => 'manager-profile@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'organization_id' => $org->id,
        ]);

        $employee = User::create([
            'name' => 'Ava Employee',
            'email' => 'employee-profile@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
        ]);

        $group = ReportGroup::create([
            'organization_id' => $org->id,
            'name' => 'Operations',
        ]);

        $manager->groups()->sync([$group->id]);
        $employee->groups()->sync([$group->id]);

        $this->actingAs($admin)
            ->putJson("/api/employees/{$employee->id}/work-info", [
                'employee_code' => 'EMP-420',
                'report_group_id' => $group->id,
                'designation' => 'Operations Executive',
                'reporting_manager_id' => $manager->id,
                'employment_status' => 'active',
            ])
            ->assertOk();

        $project = Project::create([
            'organization_id' => $org->id,
            'name' => 'Migration Project',
            'status' => 'active',
        ]);

        $task = Task::create([
            'group_id' => $group->id,
            'project_id' => $project->id,
            'assignee_id' => $employee->id,
            'title' => 'Clean imported records',
            'status' => 'in_progress',
            'priority' => 'high',
        ]);

        TimeEntry::create([
            'user_id' => $employee->id,
            'project_id' => $project->id,
            'task_id' => $task->id,
            'start_time' => now()->subHours(3),
            'end_time' => now()->subHours(2),
            'duration' => 3600,
            'billable' => true,
        ]);

        TimeEntry::create([
            'user_id' => $employee->id,
            'project_id' => null,
            'task_id' => $task->id,
            'start_time' => now()->subHours(2),
            'end_time' => now()->subHour(),
            'duration' => 3600,
            'billable' => false,
        ]);

        $this->actingAs($admin)
            ->getJson("/api/users/{$employee->id}/profile-360")
            ->assertOk()
            ->assertJsonPath('assignments.primary_group.name', 'Operations')
            ->assertJsonPath('assignments.reporting_manager.name', 'Manager User')
            ->assertJsonPath('assignments.assigned_projects.0.name', 'Migration Project')
            ->assertJsonPath('project_breakdown.0.project.name', 'Migration Project')
            ->assertJsonPath('project_breakdown.0.entries_count', 2)
            ->assertJsonPath('project_breakdown.0.tracked_duration', 7200)
            ->assertJsonPath('project_breakdown.0.billable_duration', 3600)
            ->assertJsonPath('project_breakdown.0.non_billable_duration', 3600);
    }

    public function test_profile_360_falls_back_to_group_manager_when_explicit_manager_is_missing(): void
    {
        $org = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance-group-manager-fallback',
        ]);

        $admin = User::create([
            'name' => 'Admin User',
            'email' => 'admin-fallback@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);

        $manager = User::create([
            'name' => 'Group Manager',
            'email' => 'group-manager@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'manager',
            'organization_id' => $org->id,
        ]);

        $employee = User::create([
            'name' => 'Employee User',
            'email' => 'employee-fallback@carevance.test',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
        ]);

        $group = ReportGroup::create([
            'organization_id' => $org->id,
            'name' => 'Digital Marketing',
        ]);

        $manager->groups()->sync([$group->id]);
        $employee->groups()->sync([$group->id]);

        $this->actingAs($admin)
            ->putJson("/api/employees/{$employee->id}/work-info", [
                'employee_code' => 'EMP-777',
                'report_group_id' => $group->id,
                'designation' => 'Executive',
                'employment_status' => 'active',
            ])
            ->assertOk();

        $this->actingAs($admin)
            ->getJson("/api/users/{$employee->id}/profile-360")
            ->assertOk()
            ->assertJsonPath('assignments.primary_group.name', 'Digital Marketing')
            ->assertJsonPath('assignments.reporting_manager.name', 'Group Manager')
            ->assertJsonPath('assignments.reporting_manager.email', 'group-manager@carevance.test');
    }
}
