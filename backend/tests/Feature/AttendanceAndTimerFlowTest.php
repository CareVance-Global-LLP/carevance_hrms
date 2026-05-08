<?php

namespace Tests\Feature;

use App\Mail\IdleTimerStoppedMail;
use App\Models\Activity;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class AttendanceAndTimerFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_check_in_creates_attendance_record_and_open_punch(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'employee@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $headers = $this->apiHeadersFor($user);

        $this->postJson('/api/attendance/check-in', [], $headers)->assertOk();

        $record = AttendanceRecord::firstOrFail();
        $this->assertNotNull($record->check_in_at);
        $this->assertDatabaseHas('attendance_punches', [
            'attendance_record_id' => $record->id,
            'user_id' => $user->id,
            'punch_out_at' => null,
        ]);
    }

    public function test_check_in_uses_organization_late_threshold(): void
    {
        $organization = Organization::create([
            'name' => 'Org',
            'slug' => 'org',
            'settings' => [
                'attendance' => [
                    'late_after_time' => '09:15:00',
                ],
            ],
        ]);
        $onTimeUser = User::create([
            'name' => 'On Time Employee',
            'email' => 'on-time@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);
        $lateUser = User::create([
            'name' => 'Late Employee',
            'email' => 'late@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        try {
            Carbon::setTestNow(Carbon::parse('2026-05-05 09:15:00', 'Asia/Kolkata'));
            $this->postJson('/api/attendance/check-in', [], $this->apiHeadersFor($onTimeUser))->assertOk();

            Carbon::setTestNow(Carbon::parse('2026-05-05 09:16:00', 'Asia/Kolkata'));
            $this->postJson('/api/attendance/check-in', [], $this->apiHeadersFor($lateUser))->assertOk();
        } finally {
            Carbon::setTestNow();
        }

        $onTimeRecord = AttendanceRecord::query()->where('user_id', $onTimeUser->id)->firstOrFail();
        $lateRecord = AttendanceRecord::query()->where('user_id', $lateUser->id)->firstOrFail();

        $this->assertSame('2026-05-05', Carbon::parse($onTimeRecord->attendance_date)->toDateString());
        $this->assertSame('present', $onTimeRecord->status);
        $this->assertSame(0, (int) $onTimeRecord->late_minutes);
        $this->assertSame('2026-05-05', Carbon::parse($lateRecord->attendance_date)->toDateString());
        $this->assertSame('present', $lateRecord->status);
        $this->assertSame(1, (int) $lateRecord->late_minutes);
    }

    public function test_check_out_closes_an_active_attendance_punch(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'employee@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $headers = $this->apiHeadersFor($user);

        $this->postJson('/api/attendance/check-in', [], $headers)->assertOk();

        $this->postJson('/api/attendance/check-out', [], $headers)
            ->assertOk()
            ->assertJsonPath('message', 'Punched out successfully');

        $record = AttendanceRecord::firstOrFail();
        $record->refresh();
        $this->assertNotNull($record->check_out_at);
        $this->assertGreaterThanOrEqual(0, (int) $record->worked_seconds);
        $this->assertDatabaseMissing('attendance_punches', [
            'attendance_record_id' => $record->id,
            'punch_out_at' => null,
        ]);
    }

    public function test_timer_start_and_stop_manage_primary_time_entry_and_attendance(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'timer@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $headers = $this->apiHeadersFor($user);

        $startResponse = $this->postJson('/api/time-entries/start', [
            'description' => 'Primary timer',
            'timer_slot' => 'primary',
        ], $headers);

        $startResponse
            ->assertCreated()
            ->assertJsonPath('user_id', $user->id)
            ->assertJsonPath('timer_slot', 'primary');

        $entry = TimeEntry::firstOrFail();
        $this->assertNull($entry->end_time);

        $attendance = AttendanceRecord::firstOrFail();
        $this->assertSame('present', $attendance->status);
        $this->assertSame(1, AttendancePunch::where('attendance_record_id', $attendance->id)->whereNull('punch_out_at')->count());

        $this->postJson('/api/time-entries/stop', [
            'timer_slot' => 'primary',
        ], $headers)
            ->assertOk()
            ->assertJsonPath('id', $entry->id);

        $entry->refresh();
        $attendance->refresh();

        $this->assertNotNull($entry->end_time);
        $this->assertGreaterThanOrEqual(0, (int) $entry->duration);
        $this->assertNotNull($attendance->check_out_at);
        $this->assertDatabaseMissing('time_entries', [
            'id' => $entry->id,
            'end_time' => null,
        ]);
    }

    public function test_timer_start_uses_organization_late_threshold_for_attendance(): void
    {
        $organization = Organization::create([
            'name' => 'Org',
            'slug' => 'org',
            'settings' => [
                'attendance' => [
                    'late_after_time' => '09:15:00',
                ],
            ],
        ]);
        $user = User::create([
            'name' => 'Timer Employee',
            'email' => 'timer-late-threshold@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        try {
            Carbon::setTestNow(Carbon::parse('2026-05-05 09:16:00', 'Asia/Kolkata'));
            $this->postJson('/api/time-entries/start', [
                'description' => 'Primary timer',
                'timer_slot' => 'primary',
            ], $this->apiHeadersFor($user))->assertCreated();
        } finally {
            Carbon::setTestNow();
        }

        $record = AttendanceRecord::query()->where('user_id', $user->id)->firstOrFail();

        $this->assertSame('2026-05-05', Carbon::parse($record->attendance_date)->toDateString());
        $this->assertSame('present', $record->status);
        $this->assertSame(1, (int) $record->late_minutes);
    }

    public function test_half_day_leave_keeps_check_in_allowed_and_halves_shift_target(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'half-day-timer@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        LeaveRequest::create([
            'organization_id' => $organization->id,
            'user_id' => $user->id,
            'start_date' => now()->toDateString(),
            'end_date' => now()->toDateString(),
            'leave_type' => 'half_day',
            'status' => 'approved',
        ]);

        $headers = $this->apiHeadersFor($user);

        $this->getJson('/api/attendance/today', $headers)
            ->assertOk()
            ->assertJsonPath('has_approved_leave_today', false)
            ->assertJsonPath('has_half_day_leave_today', true)
            ->assertJsonPath('shift_target_seconds', 14400);

        $this->postJson('/api/attendance/check-in', [], $headers)->assertOk();

        $this->assertDatabaseHas('time_entries', [
            'user_id' => $user->id,
            'timer_slot' => 'primary',
            'end_time' => null,
        ]);

        $this->getJson('/api/attendance/today', $headers)
            ->assertOk()
            ->assertJsonPath('record.shift_target_seconds', 14400)
            ->assertJsonPath('record.leave_type', 'half_day');
    }

    public function test_attendance_summary_marks_approved_leave_day_as_leave_not_absent(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'attendance-summary-admin@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'attendance-summary-employee@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        try {
            Carbon::setTestNow(Carbon::parse('2026-05-08 10:00:00', 'Asia/Kolkata'));

            LeaveRequest::create([
                'organization_id' => $organization->id,
                'user_id' => $employee->id,
                'start_date' => '2026-05-08',
                'end_date' => '2026-05-08',
                'leave_type' => 'full_day',
                'status' => 'approved',
            ]);

            AttendanceRecord::create([
                'organization_id' => $organization->id,
                'user_id' => $employee->id,
                'attendance_date' => '2026-05-08',
                'status' => 'absent',
                'check_in_at' => null,
                'check_out_at' => null,
                'worked_seconds' => 0,
                'late_minutes' => 0,
            ]);

            $response = $this->getJson('/api/attendance/summary?start_date=2026-05-08&end_date=2026-05-08', $this->apiHeadersFor($admin))
                ->assertOk();
        } finally {
            Carbon::setTestNow();
        }

        $employeeSummary = collect($response->json('data'))
            ->firstWhere('user.id', $employee->id);

        $this->assertNotNull($employeeSummary);
        $this->assertTrue((bool) ($employeeSummary['has_approved_leave_today'] ?? false));
        $this->assertTrue((bool) ($employeeSummary['is_leave'] ?? false));
        $this->assertSame('leave', $employeeSummary['attendance_status'] ?? null);
    }

    public function test_timer_start_with_task_moves_task_to_in_progress(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'task-timer@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Delivery',
            'is_active' => true,
        ]);
        $group->users()->attach($user->id);

        $project = Project::create([
            'organization_id' => $organization->id,
            'name' => 'Client Rollout',
            'status' => 'active',
        ]);

        $task = Task::create([
            'group_id' => $group->id,
            'project_id' => $project->id,
            'assignee_id' => $user->id,
            'title' => 'Prepare rollout plan',
            'status' => 'todo',
            'priority' => 'medium',
        ]);

        $headers = $this->apiHeadersFor($user);

        $this->postJson('/api/time-entries/start', [
            'task_id' => $task->id,
            'timer_slot' => 'primary',
        ], $headers)
            ->assertCreated()
            ->assertJsonPath('task_id', $task->id)
            ->assertJsonPath('project_id', $project->id);

        $task->refresh();
        $this->assertSame('in_progress', $task->status);
    }

    public function test_profile360_current_project_falls_back_to_active_task_title(): void
    {
        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin-task-profile@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee-task-profile@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $group = Group::create([
            'organization_id' => $organization->id,
            'name' => 'Delivery',
            'is_active' => true,
        ]);
        $group->users()->attach($employee->id);

        $task = Task::create([
            'group_id' => $group->id,
            'project_id' => null,
            'assignee_id' => $employee->id,
            'title' => 'Prepare rollout plan',
            'status' => 'in_progress',
            'priority' => 'medium',
        ]);

        TimeEntry::create([
            'user_id' => $employee->id,
            'project_id' => null,
            'task_id' => $task->id,
            'start_time' => now()->subMinutes(20),
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $this->getJson("/api/users/{$employee->id}/profile-360", $this->apiHeadersFor($admin))
            ->assertOk()
            ->assertJsonPath('status.is_working', true)
            ->assertJsonPath('status.current_project', 'Prepare rollout plan');
    }

    public function test_idle_auto_stop_stop_request_sends_email_to_employee(): void
    {
        Mail::fake();

        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'timer@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $headers = $this->apiHeadersFor($user);

        $this->postJson('/api/time-entries/start', [
            'description' => 'Primary timer',
            'timer_slot' => 'primary',
        ], $headers)->assertCreated();

        $timeEntry = TimeEntry::query()->latest('id')->firstOrFail();
        $timeEntry->update([
            'start_time' => now()->subMinutes(10),
        ]);

        $this->postJson('/api/time-entries/stop', [
            'timer_slot' => 'primary',
            'auto_stopped_for_idle' => true,
            'idle_seconds' => 300,
        ], $headers)->assertOk();

        Mail::assertQueued(IdleTimerStoppedMail::class, function (IdleTimerStoppedMail $mail) use ($user) {
            return $mail->hasTo($user->email)
                && $mail->idleSeconds === 300
                && $mail->idleDurationLabel === '5 minutes';
        });
    }

    public function test_idle_activity_updates_do_not_auto_stop_the_timer_or_send_email(): void
    {
        Mail::fake();

        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'idle-activity@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $headers = $this->apiHeadersFor($user);

        $startResponse = $this->postJson('/api/time-entries/start', [
            'description' => 'Primary timer',
            'timer_slot' => 'primary',
        ], $headers)->assertCreated();

        $timeEntryId = (int) $startResponse->json('id');
        TimeEntry::query()->whereKey($timeEntryId)->update([
            'start_time' => now()->subMinutes(10),
        ]);

        $activityResponse = $this->postJson('/api/activities', [
            'time_entry_id' => $timeEntryId,
            'type' => 'idle',
            'name' => 'System Idle - Visual Studio Code',
            'duration' => 180,
            'recorded_at' => now()->subMinutes(2)->toIso8601String(),
        ], $headers)->assertCreated();

        $activityId = (int) $activityResponse->json('id');

        $this->putJson("/api/activities/{$activityId}", [
            'duration' => 300,
            'recorded_at' => now()->toIso8601String(),
        ], $headers)->assertOk();

        $timeEntry = TimeEntry::findOrFail($timeEntryId);
        $this->assertNull($timeEntry->end_time);
        Mail::assertNothingQueued();
    }

    public function test_idle_auto_stop_requires_true_continuous_idle_before_stopping(): void
    {
        Mail::fake();

        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'validation@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $headers = $this->apiHeadersFor($user);

        $startResponse = $this->postJson('/api/time-entries/start', [
            'description' => 'Primary timer',
            'timer_slot' => 'primary',
        ], $headers)->assertCreated();

        $timeEntryId = (int) $startResponse->json('id');
        TimeEntry::query()->whereKey($timeEntryId)->update([
            'start_time' => now()->subMinutes(10),
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $timeEntryId,
            'type' => 'app',
            'name' => 'Visual Studio Code',
            'duration' => 10,
            'recorded_at' => now()->subSeconds(10),
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $timeEntryId,
            'type' => 'idle',
            'name' => 'System Idle - Visual Studio Code',
            'duration' => 300,
            'recorded_at' => now(),
        ]);

        $response = $this->postJson('/api/time-entries/stop', [
            'timer_slot' => 'primary',
            'auto_stopped_for_idle' => true,
            'idle_seconds' => 300,
        ], $headers)
            ->assertStatus(409)
            ->assertJsonPath('message', 'Idle auto-stop validation failed because recent activity was detected.')
            ->assertJsonPath('error_code', 'IDLE_VALIDATION_FAILED');

        $this->assertGreaterThanOrEqual(1, (int) $response->json('retry_after_seconds'));
        $this->assertLessThanOrEqual(300, (int) $response->json('retry_after_seconds'));

        $timeEntry = TimeEntry::findOrFail($timeEntryId);
        $this->assertNull($timeEntry->end_time);
        Mail::assertNothingQueued();
    }

    public function test_idle_auto_stop_threshold_respects_configuration_value(): void
    {
        Mail::fake();
        config()->set('time_tracking.idle_auto_stop_threshold_seconds', 240);

        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'threshold@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $headers = $this->apiHeadersFor($user);

        $startResponse = $this->postJson('/api/time-entries/start', [
            'description' => 'Primary timer',
            'timer_slot' => 'primary',
        ], $headers)->assertCreated();

        $timeEntryId = (int) $startResponse->json('id');
        TimeEntry::query()->whereKey($timeEntryId)->update([
            'start_time' => now()->subMinutes(10),
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $timeEntryId,
            'type' => 'idle',
            'name' => 'System Idle - Visual Studio Code',
            'duration' => 240,
            'recorded_at' => now(),
        ]);

        $this->postJson('/api/time-entries/stop', [
            'timer_slot' => 'primary',
            'auto_stopped_for_idle' => true,
            'idle_seconds' => 240,
        ], $headers)->assertOk();

        Mail::assertQueued(IdleTimerStoppedMail::class, function (IdleTimerStoppedMail $mail) use ($user) {
            return $mail->hasTo($user->email)
                && $mail->idleSeconds === 240
                && $mail->idleDurationLabel === '4 minutes';
        });
    }

    public function test_idle_auto_stop_email_duration_does_not_round_up_to_the_next_minute(): void
    {
        Mail::fake();

        $organization = Organization::create(['name' => 'Org', 'slug' => 'org']);
        $user = User::create([
            'name' => 'Employee',
            'email' => 'format@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        $headers = $this->apiHeadersFor($user);

        $startResponse = $this->postJson('/api/time-entries/start', [
            'description' => 'Primary timer',
            'timer_slot' => 'primary',
        ], $headers)->assertCreated();

        $timeEntryId = (int) $startResponse->json('id');
        TimeEntry::query()->whereKey($timeEntryId)->update([
            'start_time' => now()->subMinutes(10),
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $timeEntryId,
            'type' => 'idle',
            'name' => 'System Idle - Visual Studio Code',
            'duration' => 301,
            'recorded_at' => now(),
        ]);

        $this->postJson('/api/time-entries/stop', [
            'timer_slot' => 'primary',
            'auto_stopped_for_idle' => true,
            'idle_seconds' => 301,
        ], $headers)->assertOk();

        Mail::assertQueued(IdleTimerStoppedMail::class, function (IdleTimerStoppedMail $mail) use ($user) {
            return $mail->hasTo($user->email)
                && $mail->idleSeconds === 301
                && $mail->idleDurationLabel === '5 minutes 1 second';
        });
    }
}
