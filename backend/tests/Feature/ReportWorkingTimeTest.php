<?php

namespace Tests\Feature;

use App\Models\Activity;
use App\Models\AttendancePunch;
use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
use App\Models\BrowserTrackingConnection;
use App\Models\Group;
use App\Models\LeaveRequest;
use App\Models\Organization;
use App\Models\Payslip;
use App\Models\Screenshot;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class ReportWorkingTimeTest extends TestCase
{
    use RefreshDatabase;

    public function test_overall_report_uses_idle_time_to_compute_working_time(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee('admin');

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-03-10 09:00:00',
            'end_time' => '2026-03-10 11:00:00',
            'duration' => 7200,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'System Idle - Test',
            'duration' => 1800,
            'recorded_at' => '2026-03-10 10:00:00',
        ]);

        $response = $this->getJson('/api/reports/overall?start_date=2026-03-10&end_date=2026-03-10', $headers);

        $response
            ->assertOk()
            ->assertJsonPath('summary.total_duration', 7200)
            ->assertJsonPath('summary.working_duration', 5400)
            ->assertJsonPath('summary.billable_duration', 5400)
            ->assertJsonPath('summary.idle_duration', 1800)
            ->assertJsonPath('by_user.0.total_duration', 7200)
            ->assertJsonPath('by_user.0.working_duration', 5400)
            ->assertJsonPath('by_user.0.idle_duration', 1800)
            ->assertJsonPath('by_day.0.total_duration', 7200)
            ->assertJsonPath('by_day.0.working_duration', 5400)
            ->assertJsonPath('by_day.0.idle_duration', 1800);

        $this->assertSame(25.0, (float) $response->json('summary.idle_percentage'));
    }

    public function test_productivity_endpoint_reports_working_time_minus_idle_time(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-03-10 09:00:00',
            'end_time' => '2026-03-10 11:00:00',
            'duration' => 7200,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'System Idle - Test',
            'duration' => 1800,
            'recorded_at' => '2026-03-10 10:00:00',
        ]);

        $this->getJson('/api/reports/productivity?start_date=2026-03-10&end_date=2026-03-10', $headers)
            ->assertOk()
            ->assertJsonPath('productivity_score', 75)
            ->assertJsonPath('tracked_time', 7200)
            ->assertJsonPath('working_time', 5400)
            ->assertJsonPath('active_time', 5400)
            ->assertJsonPath('idle_time', 1800);
    }

    public function test_productivity_endpoint_counts_exact_desktop_sessions_in_activity_totals(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => '2026-04-21 09:00:00',
            'end_time' => '2026-04-21 10:00:00',
            'duration' => 3600,
            'billable' => true,
            'timer_slot' => 'primary',
        ]);

        $this->postJson('/api/activity-sessions', [
            'time_entry_id' => $entry->id,
            'source' => 'desktop',
            'activity_kind' => 'desktop_app',
            'tool_type' => 'software',
            'display_name' => 'Visual Studio Code',
            'app_name' => 'Visual Studio Code',
            'window_title' => 'Tracking Work',
            'started_at' => '2026-04-21T09:00:00Z',
            'ended_at' => '2026-04-21T09:30:00Z',
            'confidence' => 100,
        ], $headers)->assertCreated();

        $this->getJson('/api/reports/productivity?start_date=2026-04-21&end_date=2026-04-21', $headers)
            ->assertOk()
            ->assertJsonPath('stats.activity_events', 1);
    }

    public function test_dashboard_summary_uses_working_ratio_for_productivity_score(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        $entry = TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subHours(3),
            'end_time' => now()->subHour(),
            'duration' => 7200,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $user->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'System Idle - Dashboard',
            'duration' => 1800,
            'recorded_at' => now()->subHours(2),
        ]);

        $this->getJson('/api/dashboard', $headers)
            ->assertOk()
            ->assertJsonPath('productivity_score', 75);
    }

    public function test_dashboard_summary_counts_approved_time_edits_in_tracked_time(): void
    {
        [$user, $headers] = $this->createAuthenticatedEmployee();

        TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => now()->subMinutes(44),
            'end_time' => now(),
            'duration' => 44 * 60,
            'billable' => true,
        ]);

        AttendanceRecord::create([
            'organization_id' => $user->organization_id,
            'user_id' => $user->id,
            'attendance_date' => now()->toDateString(),
            'check_in_at' => now()->subHours(2),
            'check_out_at' => now(),
            'worked_seconds' => 44 * 60,
            'manual_adjustment_seconds' => 3600,
            'late_minutes' => 0,
            'status' => 'present',
        ]);

        $this->getJson('/api/dashboard', $headers)
            ->assertOk()
            ->assertJsonPath('today_total_duration', 6240)
            ->assertJsonPath('today_total_elapsed_duration', 6240);
    }

    public function test_overall_report_counts_approved_time_edits_as_tracked_and_working_time(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-04-14 10:00:00',
            'end_time' => '2026-04-14 10:44:00',
            'duration' => 44 * 60,
            'billable' => true,
        ]);

        AttendanceRecord::create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'attendance_date' => '2026-04-14',
            'check_in_at' => '2026-04-14 09:00:00',
            'check_out_at' => '2026-04-14 10:44:00',
            'worked_seconds' => 44 * 60,
            'manual_adjustment_seconds' => 3600,
            'late_minutes' => 0,
            'status' => 'present',
        ]);

        $this->getJson('/api/reports/overall?start_date=2026-04-14&end_date=2026-04-14&user_ids[]='.$employee->id, $headers)
            ->assertOk()
            ->assertJsonPath('summary.total_duration', 6240)
            ->assertJsonPath('summary.working_duration', 6240)
            ->assertJsonPath('summary.idle_duration', 0)
            ->assertJsonPath('by_user.0.total_duration', 6240)
            ->assertJsonPath('by_user.0.working_duration', 6240)
            ->assertJsonPath('by_day.0.total_duration', 6240)
            ->assertJsonPath('by_day.0.working_duration', 6240);
    }

    public function test_profile360_counts_approved_time_edits_in_summary_totals(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-04-14 10:00:00',
            'end_time' => '2026-04-14 10:44:00',
            'duration' => 44 * 60,
            'billable' => true,
        ]);

        AttendanceRecord::create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'attendance_date' => '2026-04-14',
            'check_in_at' => '2026-04-14 09:00:00',
            'check_out_at' => '2026-04-14 10:44:00',
            'worked_seconds' => 44 * 60,
            'manual_adjustment_seconds' => 3600,
            'late_minutes' => 0,
            'status' => 'present',
        ]);

        AttendanceTimeEditRequest::create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'attendance_date' => '2026-04-14',
            'extra_seconds' => 3600,
            'message' => 'Approved extra hour',
            'status' => 'approved',
        ]);

        $this->getJson("/api/users/{$employee->id}/profile-360?start_date=2026-04-14&end_date=2026-04-14", $headers)
            ->assertOk()
            ->assertJsonPath('summary.total_duration', 6240)
            ->assertJsonPath('summary.working_duration', 6240)
            ->assertJsonPath('summary.approved_time_edit_seconds', 3600);
    }

    public function test_duplicate_idle_snapshots_are_counted_once_in_time_breakdowns(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-16 11:15:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee);

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'System Idle - Visual Studio Code',
                'duration' => 180,
                'recorded_at' => '2026-03-16 11:03:00',
            ]);

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'System Idle - Visual Studio Code',
                'duration' => 240,
                'recorded_at' => '2026-03-16 11:04:00',
            ]);

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'System Idle - Visual Studio Code',
                'duration' => 244,
                'recorded_at' => '2026-03-16 11:04:05',
            ]);

            $this->getJson('/api/reports/overall?start_date=2026-03-16&end_date=2026-03-16&user_ids[]='.$employee->id, $headers)
                ->assertOk()
                ->assertJsonPath('summary.total_duration', 1800)
                ->assertJsonPath('summary.working_duration', 1556)
                ->assertJsonPath('summary.idle_duration', 244);

            $this->getJson("/api/users/{$employee->id}/profile-360?start_date=2026-03-16&end_date=2026-03-16", $headers)
                ->assertOk()
                ->assertJsonPath('summary.total_duration', 1800)
                ->assertJsonPath('summary.working_duration', 1556)
                ->assertJsonPath('summary.idle_duration', 244);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_overall_and_employee_insights_share_the_same_normalized_idle_time(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        $entry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-03-16 10:00:00',
            'end_time' => '2026-03-16 10:03:00',
            'duration' => 180,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Visual Studio Code',
            'duration' => 61,
            'recorded_at' => '2026-03-16 10:01:00',
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Visual Studio Code',
            'duration' => 180,
            'recorded_at' => '2026-03-16 10:03:00',
        ]);

        $overallResponse = $this->getJson('/api/reports/overall?start_date=2026-03-16&end_date=2026-03-16&user_ids[]='.$employee->id, $headers)
            ->assertOk()
            ->assertJsonPath('summary.total_duration', 180)
            ->assertJsonPath('summary.idle_duration', 0)
            ->assertJsonPath('summary.working_duration', 180)
            ->assertJsonPath('by_user.0.idle_duration', 0)
            ->assertJsonPath('by_day.0.idle_duration', 0);

        $this->getJson("/api/reports/employee-insights?start_date=2026-03-16&end_date=2026-03-16&user_id={$employee->id}", $headers)
            ->assertOk()
            ->assertJsonPath('stats.total_duration', 180)
            ->assertJsonPath('stats.idle_total_duration', 0)
            ->assertJsonPath('stats.working_duration', 180);

        $this->assertSame(0, (int) $overallResponse->json('summary.idle_duration'));
    }

    public function test_admin_overall_report_counts_live_duration_for_open_time_entries(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-16 11:15:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee);

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'System Idle - Admin',
                'duration' => 300,
                'recorded_at' => '2026-03-16 11:00:00',
            ]);

            $query = http_build_query([
                'start_date' => '2026-03-16',
                'end_date' => '2026-03-16',
                'user_ids' => [$employee->id],
            ]);

            $this->getJson("/api/reports/overall?{$query}", $headers)
                ->assertOk()
                ->assertJsonPath('summary.total_duration', 1800)
                ->assertJsonPath('summary.working_duration', 1500)
                ->assertJsonPath('summary.idle_duration', 300)
                ->assertJsonPath('by_user.0.user.id', $employee->id)
                ->assertJsonPath('by_user.0.total_duration', 1800)
                ->assertJsonPath('by_user.0.working_duration', 1500)
                ->assertJsonPath('by_day.0.total_duration', 1800)
                ->assertJsonPath('by_day.0.working_duration', 1500);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_profile360_counts_live_duration_for_open_time_entries(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-16 11:15:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee);

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'System Idle - Profile',
                'duration' => 300,
                'recorded_at' => '2026-03-16 11:00:00',
            ]);

            $this->getJson("/api/users/{$employee->id}/profile-360?start_date=2026-03-16&end_date=2026-03-16", $headers)
                ->assertOk()
                ->assertJsonPath('summary.total_duration', 1800)
                ->assertJsonPath('summary.working_duration', 1500)
                ->assertJsonPath('summary.idle_duration', 300)
                ->assertJsonPath('recent_time_entries.0.duration', 1800)
                ->assertJsonPath('status.is_working', true);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_profile360_summary_uses_full_selected_range_for_attendance_and_adjustments(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        foreach (range(1, 20) as $day) {
            $date = Carbon::create(2026, 3, $day)->toDateString();
            $isAbsent = in_array($day, [5, 6, 7, 18], true);

            AttendanceRecord::create([
                'organization_id' => $employee->organization_id,
                'user_id' => $employee->id,
                'attendance_date' => $date,
                'check_in_at' => $isAbsent ? null : "{$date} 09:00:00",
                'check_out_at' => $isAbsent ? null : "{$date} 18:00:00",
                'worked_seconds' => $isAbsent ? 0 : 8 * 3600,
                'manual_adjustment_seconds' => 0,
                'late_minutes' => in_array($day, [2, 9, 16], true) ? 10 : 0,
                'status' => $isAbsent ? 'absent' : 'present',
            ]);
        }

        LeaveRequest::create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'type' => 'annual',
            'start_date' => '2026-03-05',
            'end_date' => '2026-03-07',
            'reason' => 'Approved leave',
            'status' => 'approved',
        ]);

        AttendanceTimeEditRequest::create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'attendance_date' => '2026-03-18',
            'extra_seconds' => 900,
            'message' => 'Range-scoped edit',
            'status' => 'approved',
        ]);

        AttendanceTimeEditRequest::create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'attendance_date' => '2026-03-25',
            'extra_seconds' => 1200,
            'message' => 'Outside range edit',
            'status' => 'approved',
        ]);

        Payslip::create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'period_month' => '2026-03',
            'currency' => 'INR',
            'basic_salary' => 1000,
            'total_allowances' => 0,
            'total_deductions' => 0,
            'net_salary' => 1000,
            'payment_status' => 'paid',
        ]);

        Payslip::create([
            'organization_id' => $employee->organization_id,
            'user_id' => $employee->id,
            'period_month' => '2026-04',
            'currency' => 'INR',
            'basic_salary' => 1000,
            'total_allowances' => 0,
            'total_deductions' => 0,
            'net_salary' => 1000,
            'payment_status' => 'paid',
        ]);

        $this->getJson("/api/users/{$employee->id}/profile-360?start_date=2026-03-01&end_date=2026-03-20", $headers)
            ->assertOk()
            ->assertJsonPath('summary.attendance_days', 20)
            ->assertJsonPath('summary.present_days', 16)
            ->assertJsonPath('summary.absent_days', 4)
            ->assertJsonPath('summary.late_days', 3)
            ->assertJsonPath('summary.approved_leave_days', 3)
            ->assertJsonPath('summary.approved_time_edit_seconds', 900)
            ->assertJsonPath('summary.payslips_count', 1)
            ->assertJsonCount(14, 'attendance_records');
    }

    public function test_employee_insights_counts_live_duration_for_open_time_entries(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-16 11:15:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee);

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'app',
                'name' => 'Visual Studio Code',
                'duration' => 1800,
                'recorded_at' => '2026-03-16 11:15:00',
            ]);

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'idle',
                'name' => 'System Idle - Insights',
                'duration' => 300,
                'recorded_at' => '2026-03-16 11:00:00',
            ]);

            $this->getJson("/api/reports/employee-insights?start_date=2026-03-16&end_date=2026-03-16&user_id={$employee->id}", $headers)
                ->assertOk()
                ->assertJsonPath('stats.total_duration', 1800)
                ->assertJsonPath('stats.working_duration', 1500)
                ->assertJsonPath('stats.idle_total_duration', 300)
                ->assertJsonPath('employee_rankings.by_productive_duration.0.total_duration', 1800)
                ->assertJsonPath('employee_rankings.by_productive_duration.0.working_duration', 1500)
                ->assertJsonPath('live_monitoring.selected_user.is_working', true);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_employee_insights_exposes_browser_tracking_health_for_live_monitoring(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-04-21 11:30:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee, '2026-04-21 11:00:00');

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'url',
                'name' => 'https://instagram.com/reel/1',
                'duration' => 600,
                'recorded_at' => '2026-04-21 11:20:00',
            ]);

            BrowserTrackingConnection::create([
                'organization_id' => $employee->organization_id,
                'user_id' => $employee->id,
                'device_id' => 'desktop-alpha',
                'device_label' => 'DESKTOP-ALPHA',
                'browser_name' => 'chrome',
                'browser_profile_key' => 'profile-a',
                'extension_version' => '0.1.0',
                'status' => 'disconnected',
                'connected_at' => '2026-04-21 11:00:00',
                'last_seen_at' => '2026-04-21 11:22:00',
                'last_sync_at' => '2026-04-21 11:29:40',
                'disconnected_at' => '2026-04-21 11:29:40',
                'disconnect_reason' => 'extension_missing',
                'meta' => ['extension_origin' => 'chrome-extension://tracking'],
            ]);

            $this->getJson("/api/reports/employee-insights?start_date=2026-04-21&end_date=2026-04-21&user_id={$employee->id}", $headers)
                ->assertOk()
                ->assertJsonPath('live_monitoring.selected_user.user.id', $employee->id)
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.status', 'disconnected')
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.device_label', 'DESKTOP-ALPHA')
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.disconnect_reason', 'extension_missing')
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.needs_attention', true)
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.is_exact_tracking_active', false)
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.browsers.0', 'chrome');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_employee_insights_honors_recent_screenshot_limit(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        $entry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-04-21 09:00:00',
            'end_time' => '2026-04-21 18:00:00',
            'duration' => 32400,
            'billable' => true,
        ]);

        try {
            foreach (range(1, 12) as $offset) {
                Carbon::setTestNow(Carbon::parse(sprintf('2026-04-21 12:%02d:00', $offset)));

                Screenshot::create([
                    'time_entry_id' => $entry->id,
                    'filename' => sprintf('capture-%02d.png', $offset),
                ]);
            }
        } finally {
            Carbon::setTestNow();
        }

        $this->getJson(
            "/api/reports/employee-insights?start_date=2026-04-21&end_date=2026-04-21&user_id={$employee->id}&recent_screenshot_limit=10",
            $headers
        )
            ->assertOk()
            ->assertJsonCount(10, 'recent_screenshots')
            ->assertJsonPath('recent_screenshots.0.filename', 'capture-12.png')
            ->assertJsonPath('recent_screenshots.9.filename', 'capture-03.png');
    }

    public function test_activity_timeline_caps_pages_to_ten_items(): void
    {
        Carbon::setTestNow('2026-04-21 12:00:00');

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = TimeEntry::create([
                'user_id' => $employee->id,
                'task_id' => null,
                'start_time' => Carbon::parse('2026-04-21 08:00:00'),
                'end_time' => Carbon::parse('2026-04-21 09:00:00'),
                'duration' => 3600,
                'status' => 'completed',
            ]);

            foreach (range(1, 15) as $index) {
                Activity::create([
                    'user_id' => $employee->id,
                    'time_entry_id' => $entry->id,
                    'type' => 'app',
                    'name' => sprintf('Tool %02d', $index),
                    'duration' => 60,
                    'recorded_at' => Carbon::parse('2026-04-21 08:00:00')->addMinutes($index),
                ]);
            }

            $this->getJson(
                "/api/activities?user_id={$employee->id}&start_date=2026-04-21&end_date=2026-04-21&processed=1&per_page=200",
                $headers
            )
                ->assertOk()
                ->assertJsonPath('per_page', 10)
                ->assertJsonCount(10, 'data');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_dashboard_lite_overall_report_returns_selected_employee_summary_without_activity_rollups(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-04-21 09:00:00',
            'end_time' => '2026-04-21 11:00:00',
            'duration' => 7200,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'type' => 'idle',
            'name' => 'Large idle history row',
            'duration' => 600,
            'recorded_at' => '2026-04-21 10:00:00',
        ]);

        $this->getJson(
            "/api/reports/overall?start_date=2026-04-21&end_date=2026-04-21&user_ids[]={$employee->id}&dashboard_lite=1",
            $headers
        )
            ->assertOk()
            ->assertJsonPath('summary.is_lite', true)
            ->assertJsonPath('summary.total_duration', 7200)
            ->assertJsonPath('summary.idle_duration', 600)
            ->assertJsonPath('summary.working_duration', 6600)
            ->assertJsonPath('by_user.0.entries_count', 1);
    }

    public function test_dashboard_lite_employee_insights_returns_selected_employee_shape_without_tool_rollups(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-04-21 09:00:00',
            'end_time' => '2026-04-21 11:00:00',
            'duration' => 7200,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'type' => 'idle',
            'name' => 'System idle',
            'duration' => 900,
            'recorded_at' => '2026-04-21 10:00:00',
        ]);

        $this->getJson(
            "/api/reports/employee-insights?start_date=2026-04-21&end_date=2026-04-21&user_id={$employee->id}&dashboard_lite=1",
            $headers
        )
            ->assertOk()
            ->assertJsonPath('stats.is_lite', true)
            ->assertJsonPath('stats.total_duration', 7200)
            ->assertJsonPath('stats.working_duration', 6300)
            ->assertJsonPath('stats.idle_total_duration', 900)
            ->assertJsonPath('organization_summary.idle_duration', 900)
            ->assertJsonPath('stats.activity_events', 0)
            ->assertJsonPath('live_monitoring.selected_user.user.id', $employee->id)
            ->assertJsonCount(0, 'selected_user_tools.productive');
    }

    public function test_employee_insights_marks_browser_tracking_as_not_paired_when_no_exact_connection_exists(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-04-21 11:30:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee, '2026-04-21 11:00:00');

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'url',
                'name' => 'Instagram',
                'duration' => 90,
                'recorded_at' => '2026-04-21 11:28:30',
            ]);

            $this->getJson("/api/reports/employee-insights?start_date=2026-04-21&end_date=2026-04-21&user_id={$employee->id}", $headers)
                ->assertOk()
                ->assertJsonPath('live_monitoring.selected_user.user.id', $employee->id)
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.status', 'disconnected')
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.disconnect_reason', 'not_paired')
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.needs_attention', true)
                ->assertJsonPath('live_monitoring.selected_user.browser_tracking.is_exact_tracking_active', false);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_employee_insights_prefers_recent_website_activity_over_utility_overlay_for_live_tool(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-04-21 11:48:10'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee, '2026-04-21 11:00:00');

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $entry->id,
                'type' => 'url',
                'name' => 'Instagram',
                'duration' => 10,
                'recorded_at' => '2026-04-21 11:47:21',
                'normalized_label' => 'instagram.com',
                'normalized_domain' => 'instagram.com',
                'software_name' => 'instagram',
                'tool_type' => 'website',
                'classification' => 'unproductive',
                'classification_reason' => 'Social media entertainment',
            ]);

            $this->postJson('/api/activity-sessions', [
                'time_entry_id' => $entry->id,
                'source' => 'desktop',
                'activity_kind' => 'desktop_app',
                'tool_type' => 'software',
                'display_name' => 'SnippingTool.exe',
                'app_name' => 'SnippingTool.exe',
                'window_title' => 'Snipping Tool Overlay',
                'started_at' => '2026-04-21T11:47:57Z',
                'confidence' => 100,
            ], $this->apiHeadersFor($employee))->assertCreated();

            $this->getJson("/api/reports/employee-insights?start_date=2026-04-21&end_date=2026-04-21&user_id={$employee->id}", $headers)
                ->assertOk()
                ->assertJsonPath('live_monitoring.selected_user.current_tool', 'instagram.com')
                ->assertJsonPath('live_monitoring.selected_user.tool_type', 'website')
                ->assertJsonPath('live_monitoring.selected_user.activity_type', 'url');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_employee_insights_prefers_most_recent_open_exact_session_when_multiple_sessions_are_still_live(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-04-21 11:48:10'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee, '2026-04-21 11:00:00');

            $this->postJson('/api/activity-sessions', [
                'time_entry_id' => $entry->id,
                'source' => 'desktop',
                'activity_kind' => 'desktop_app',
                'tool_type' => 'software',
                'display_name' => 'Visual Studio Code',
                'app_name' => 'Visual Studio Code',
                'window_title' => 'Tracking Work',
                'started_at' => '2026-04-21T11:47:57Z',
                'confidence' => 100,
            ], $this->apiHeadersFor($employee))->assertCreated();

            $this->postJson('/api/activity-sessions', [
                'time_entry_id' => $entry->id,
                'source' => 'browser_extension',
                'activity_kind' => 'website',
                'tool_type' => 'website',
                'display_name' => 'Time Doctor Help',
                'app_name' => 'chrome',
                'window_title' => 'How to Use the Time Doctor Chrome Browser Extension or Firefox Browser AddOn',
                'url' => 'https://support.timedoctor.com/knowledge/how-time-doctor-chrome-extension-works',
                'started_at' => '2026-04-21T11:48:05Z',
                'confidence' => 100,
            ], $this->apiHeadersFor($employee))->assertCreated();

            $this->getJson("/api/reports/employee-insights?start_date=2026-04-21&end_date=2026-04-21&user_id={$employee->id}", $headers)
                ->assertOk()
                ->assertJsonPath('live_monitoring.selected_user.current_tool', 'support.timedoctor.com')
                ->assertJsonPath('live_monitoring.selected_user.tool_type', 'website')
                ->assertJsonPath('live_monitoring.selected_user.activity_type', 'url');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_employee_insights_uses_exact_desktop_app_name_for_live_monitoring(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-04-22 10:32:26'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee, '2026-04-22 10:00:00');

            $this->postJson('/api/activity-sessions', [
                'time_entry_id' => $entry->id,
                'source' => 'desktop',
                'activity_kind' => 'desktop_app',
                'tool_type' => 'software',
                'display_name' => 'Codex',
                'app_name' => 'Codex',
                'window_title' => 'Codex',
                'started_at' => '2026-04-22T10:31:40Z',
                'confidence' => 100,
            ], $this->apiHeadersFor($employee))->assertCreated();

            $this->getJson("/api/reports/employee-insights?start_date=2026-04-22&end_date=2026-04-22&user_id={$employee->id}", $headers)
                ->assertOk()
                ->assertJsonPath('live_monitoring.selected_user.current_tool', 'Codex')
                ->assertJsonPath('live_monitoring.selected_user.tool_type', 'software')
                ->assertJsonPath('live_monitoring.selected_user.activity_type', 'app');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_employee_insights_prefers_explorer_window_title_for_live_monitoring(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-04-22 11:14:28'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $entry = $this->createOpenEntryFor($employee, '2026-04-22 11:00:00');

            $this->postJson('/api/activity-sessions', [
                'time_entry_id' => $entry->id,
                'source' => 'desktop',
                'activity_kind' => 'desktop_app',
                'tool_type' => 'software',
                'display_name' => 'This PC',
                'app_name' => 'Windows Explorer',
                'window_title' => 'This PC',
                'started_at' => '2026-04-22T11:14:04Z',
                'confidence' => 100,
            ], $this->apiHeadersFor($employee))->assertCreated();

            $this->getJson("/api/reports/employee-insights?start_date=2026-04-22&end_date=2026-04-22&user_id={$employee->id}", $headers)
                ->assertOk()
                ->assertJsonPath('live_monitoring.selected_user.current_tool', 'This PC')
                ->assertJsonPath('live_monitoring.selected_user.tool_type', 'software')
                ->assertJsonPath('live_monitoring.selected_user.activity_type', 'app');
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_employee_insights_classifies_browser_window_titles_as_unproductive_tools(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        $entry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-03-16 10:45:00',
            'end_time' => '2026-03-16 11:00:00',
            'duration' => 900,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Google Chrome - Instagram - Google Chrome',
            'duration' => 300,
            'recorded_at' => '2026-03-16 10:55:00',
        ]);

        $this->getJson("/api/reports/employee-insights?start_date=2026-03-16&end_date=2026-03-16&user_id={$employee->id}", $headers)
            ->assertOk()
            ->assertJsonPath('selected_user_tools.unproductive.0.label', 'instagram.com')
            ->assertJsonPath('selected_user_tools.unproductive.0.total_duration', 300)
            ->assertJsonPath('organization_summary.unproductive_duration', 300)
            ->assertJsonPath('employee_rankings.by_unproductive_duration.0.unproductive_duration', 300);
    }

    public function test_employee_insights_uses_saved_classification_fields_for_tool_rollups(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        $entry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-03-16 10:45:00',
            'end_time' => '2026-03-16 11:00:00',
            'duration' => 900,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'app',
            'name' => 'Visual Studio Code - app.php - demo_laravel_2 - Visual Studio Code',
            'duration' => 300,
            'recorded_at' => '2026-03-16 10:50:00',
            'normalized_label' => 'vscode',
            'software_name' => 'vscode',
            'tool_type' => 'software',
            'classification' => 'productive',
            'classification_reason' => 'Saved by classifier.',
        ]);

        $this->getJson("/api/reports/employee-insights?start_date=2026-03-16&end_date=2026-03-16&user_id={$employee->id}", $headers)
            ->assertOk()
            ->assertJsonPath('selected_user_tools.productive.0.label', 'vscode')
            ->assertJsonPath('selected_user_tools.productive.0.total_duration', 300)
            ->assertJsonPath('organization_summary.productive_duration', 300)
            ->assertJsonPath('employee_rankings.by_productive_duration.0.productive_duration', 300);
    }

    public function test_employee_insights_collapse_duplicate_tool_snapshots_before_reporting_totals(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        $entry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-03-16 10:45:00',
            'end_time' => '2026-03-16 11:00:00',
            'duration' => 900,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Instagram',
            'duration' => 120,
            'recorded_at' => '2026-03-16 10:57:00',
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Instagram',
            'duration' => 125,
            'recorded_at' => '2026-03-16 10:57:04',
        ]);

        $this->getJson("/api/reports/employee-insights?start_date=2026-03-16&end_date=2026-03-16&user_id={$employee->id}", $headers)
            ->assertOk()
            ->assertJsonPath('selected_user_tools.unproductive.0.label', 'instagram.com')
            ->assertJsonPath('selected_user_tools.unproductive.0.total_duration', 125)
            ->assertJsonPath('organization_summary.unproductive_duration', 125)
            ->assertJsonPath('employee_rankings.by_unproductive_duration.0.unproductive_duration', 125);
    }

    public function test_employee_insights_reports_unproductive_tool_duration_from_timeline_active_rows(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        $entry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-03-16 10:00:00',
            'end_time' => '2026-03-16 10:03:00',
            'duration' => 180,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'https://instagram.com/reel/1',
            'duration' => 135,
            'recorded_at' => '2026-03-16 10:02:15',
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'System Idle - Chrome',
            'duration' => 120,
            'recorded_at' => '2026-03-16 10:02:15',
        ]);

        $this->getJson("/api/reports/employee-insights?start_date=2026-03-16&end_date=2026-03-16&user_id={$employee->id}", $headers)
            ->assertOk()
            ->assertJsonPath('stats.total_duration', 180)
            ->assertJsonPath('stats.working_duration', 60)
            ->assertJsonPath('stats.idle_total_duration', 120)
            ->assertJsonPath('selected_user_tools.unproductive.0.label', 'instagram.com')
            ->assertJsonPath('selected_user_tools.unproductive.0.total_duration', 15)
            ->assertJsonPath('organization_summary.unproductive_duration', 15)
            ->assertJsonPath('employee_rankings.by_unproductive_duration.0.unproductive_duration', 15);
    }

    public function test_employee_insights_keeps_idle_only_unproductive_context_out_of_active_tool_totals(): void
    {
        [$admin, $employee, $headers] = $this->createAdminAndEmployee();

        $entry = TimeEntry::create([
            'user_id' => $employee->id,
            'start_time' => '2026-03-16 10:00:00',
            'end_time' => '2026-03-16 10:03:00',
            'duration' => 180,
            'billable' => true,
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'url',
            'name' => 'Instagram',
            'duration' => 120,
            'recorded_at' => '2026-03-16 10:02:00',
        ]);

        Activity::create([
            'user_id' => $employee->id,
            'time_entry_id' => $entry->id,
            'type' => 'idle',
            'name' => 'System Idle - Instagram',
            'duration' => 180,
            'recorded_at' => '2026-03-16 10:03:00',
        ]);

        $this->getJson("/api/reports/employee-insights?start_date=2026-03-16&end_date=2026-03-16&user_id={$employee->id}", $headers)
            ->assertOk()
            ->assertJsonPath('stats.total_duration', 180)
            ->assertJsonPath('stats.working_duration', 0)
            ->assertJsonPath('stats.idle_total_duration', 180)
            ->assertJsonPath('selected_user_tools.unproductive', [])
            ->assertJsonPath('organization_summary.unproductive_duration', 0)
            ->assertJsonPath('employee_rankings.by_unproductive_duration.0.unproductive_duration', 0);
    }

    public function test_admin_time_entries_index_returns_selected_employee_live_duration(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-16 11:15:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $this->createOpenEntryFor($employee);
            $this->createOpenEntryFor($admin, '2026-03-16 11:10:00');

            $this->getJson("/api/time-entries?user_id={$employee->id}&start_date=2026-03-16&end_date=2026-03-16", $headers)
                ->assertOk()
                ->assertJsonCount(1, 'data')
                ->assertJsonPath('data.0.user_id', $employee->id)
                ->assertJsonPath('data.0.duration', 1800);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_attendance_report_marks_employee_as_working_when_live_timer_exists(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-21 10:15:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();
            $this->createOpenEntryFor($employee, '2026-03-21 10:05:00');

            $query = http_build_query([
                'start_date' => '2026-03-01',
                'end_date' => '2026-03-21',
                'user_id' => $employee->id,
            ]);

            $this->getJson("/api/reports/attendance?{$query}", $headers)
                ->assertOk()
                ->assertJsonPath('data.0.user.id', $employee->id)
                ->assertJsonPath('data.0.is_working', true);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_attendance_report_counts_live_worked_seconds_for_open_punches(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-21 10:15:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();

            $record = AttendanceRecord::create([
                'organization_id' => $employee->organization_id,
                'user_id' => $employee->id,
                'attendance_date' => '2026-03-21',
                'check_in_at' => '2026-03-21 09:30:00',
                'check_out_at' => null,
                'worked_seconds' => 0,
                'manual_adjustment_seconds' => 600,
                'late_minutes' => 0,
                'status' => 'present',
            ]);

            AttendancePunch::create([
                'organization_id' => $employee->organization_id,
                'user_id' => $employee->id,
                'attendance_record_id' => $record->id,
                'punch_in_at' => '2026-03-21 09:30:00',
                'punch_out_at' => null,
                'worked_seconds' => 0,
            ]);

            $query = http_build_query([
                'start_date' => '2026-03-21',
                'end_date' => '2026-03-21',
                'user_id' => $employee->id,
            ]);

            $this->getJson("/api/reports/attendance?{$query}", $headers)
                ->assertOk()
                ->assertJsonPath('data.0.user.id', $employee->id)
                ->assertJsonPath('data.0.worked_seconds', 3300)
                ->assertJsonPath('data.0.worked_hours', 0.92);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_attendance_report_includes_weekends_in_calendar_day_totals(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-22 10:15:00'));

        try {
            [$admin, $employee, $headers] = $this->createAdminAndEmployee();

            AttendanceRecord::create([
                'organization_id' => $employee->organization_id,
                'user_id' => $employee->id,
                'attendance_date' => '2026-03-20',
                'check_in_at' => '2026-03-20 09:00:00',
                'check_out_at' => '2026-03-20 18:00:00',
                'worked_seconds' => 32400,
                'manual_adjustment_seconds' => 0,
                'late_minutes' => 0,
                'status' => 'present',
            ]);

            $query = http_build_query([
                'start_date' => '2026-03-20',
                'end_date' => '2026-03-22',
                'user_id' => $employee->id,
            ]);

            $this->getJson("/api/reports/attendance?{$query}", $headers)
                ->assertOk()
                ->assertJsonPath('calendar_days', 3)
                ->assertJsonPath('working_days', 1)
                ->assertJsonPath('weekend_days', 2)
                ->assertJsonPath('data.0.days_present', 1)
                ->assertJsonPath('data.0.calendar_days_in_range', 3)
                ->assertJsonPath('data.0.working_days_in_range', 1)
                ->assertJsonPath('data.0.attendance_rate', 33.33);
        } finally {
            Carbon::setTestNow();
        }
    }

    public function test_manager_employee_insights_only_returns_employee_monitoring_rows(): void
    {
        Carbon::setTestNow(Carbon::parse('2026-03-16 11:15:00'));

        try {
            $organization = Organization::create([
                'name' => 'CareVance Org',
                'slug' => 'carevance-org',
            ]);

            $manager = User::create([
                'name' => 'Manager',
                'email' => 'manager@example.com',
                'password' => Hash::make('password123'),
                'role' => 'manager',
                'organization_id' => $organization->id,
            ]);

            $employee = User::create([
                'name' => 'Employee',
                'email' => 'employee@example.com',
                'password' => Hash::make('password123'),
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);

            $anotherManager = User::create([
                'name' => 'Second Manager',
                'email' => 'second-manager@example.com',
                'password' => Hash::make('password123'),
                'role' => 'manager',
                'organization_id' => $organization->id,
            ]);

            $digitalGroup = Group::create([
                'organization_id' => $organization->id,
                'name' => 'Digital Marketing',
                'slug' => 'digital-marketing',
                'is_active' => true,
            ]);

            $itGroup = Group::create([
                'organization_id' => $organization->id,
                'name' => 'IT',
                'slug' => 'it',
                'is_active' => true,
            ]);

            $manager->groups()->sync([$digitalGroup->id]);
            $employee->groups()->sync([$digitalGroup->id]);
            $anotherManager->groups()->sync([$itGroup->id]);

            $employeeEntry = $this->createOpenEntryFor($employee);
            $managerEntry = $this->createOpenEntryFor($anotherManager, '2026-03-16 10:50:00');

            Activity::create([
                'user_id' => $employee->id,
                'time_entry_id' => $employeeEntry->id,
                'type' => 'app',
                'name' => 'VS Code',
                'duration' => 600,
                'recorded_at' => '2026-03-16 11:00:00',
            ]);

            Activity::create([
                'user_id' => $anotherManager->id,
                'time_entry_id' => $managerEntry->id,
                'type' => 'app',
                'name' => 'Slack',
                'duration' => 600,
                'recorded_at' => '2026-03-16 11:05:00',
            ]);

            $response = $this->getJson('/api/reports/employee-insights?start_date=2026-03-16&end_date=2026-03-16', $this->apiHeadersFor($manager))
                ->assertOk();

            $this->assertCount(1, $response->json('matched_users'));
            $this->assertSame($employee->id, $response->json('matched_users.0.id'));
            $this->assertCount(1, $response->json('live_monitoring.all_users'));
            $this->assertSame($employee->id, $response->json('live_monitoring.all_users.0.user.id'));
            $this->assertSame('employee', $response->json('live_monitoring.all_users.0.user.role'));
        } finally {
            Carbon::setTestNow();
        }
    }

    private function createAuthenticatedEmployee(string $role = 'employee'): array
    {
        $organization = Organization::create([
            'name' => 'CareVance Org',
            'slug' => 'carevance-org',
        ]);

        $user = User::create([
            'name' => 'Ayush',
            'email' => 'ayush@example.com',
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);

        return [$user, $this->apiHeadersFor($user)];
    }

    private function createAdminAndEmployee(): array
    {
        $organization = Organization::create([
            'name' => 'CareVance Org',
            'slug' => 'carevance-org',
        ]);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $employee = User::create([
            'name' => 'Smit',
            'email' => 'smit@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
        ]);

        return [$admin, $employee, $this->apiHeadersFor($admin)];
    }

    private function createOpenEntryFor(User $user, string $startTime = '2026-03-16 10:45:00'): TimeEntry
    {
        return TimeEntry::create([
            'user_id' => $user->id,
            'start_time' => $startTime,
            'end_time' => null,
            'duration' => 0,
            'billable' => true,
        ]);
    }
}
