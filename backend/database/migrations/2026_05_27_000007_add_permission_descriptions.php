<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $descriptions = [
            // Dashboard
            'dashboard.view' => 'Access the main dashboard with overview of key metrics and activities',
            
            // Timer
            'timer.use' => 'Start/stop time tracking and manage work sessions using the desktop timer',
            
            // Employees
            'employees.view' => 'View employee list, profiles, and basic information',
            'employees.manage' => 'Create, edit, and manage employee accounts and details',
            
            // Groups
            'groups.view' => 'View department/team groups and their members',
            'groups.manage' => 'Create, edit, and organize employee groups and departments',
            
            // Attendance
            'attendance.view' => 'View attendance records, check-ins, and work hours',
            'selfies.view' => 'View location-based selfie check-in photos on map (requires monitoring feature)',
            
            // Reports
            'reports.view' => 'Generate and view work reports, time sheets, and analytics',
            
            // Monitoring
            'monitoring.view' => 'View real-time activity monitoring and productivity insights',
            'screenshots.view' => 'View automated screenshots captured during work sessions (requires screenshot feature)',
            
            // Settings
            'geofence.manage' => 'Set up and manage geo-fenced locations for attendance tracking (requires geo-fencing)',
            'settings.view' => 'View organization and workspace settings',
            'settings.manage' => 'Configure organization settings, preferences, and configurations',
            'productivity.manage' => 'Define productivity rules and app/website classifications',
            'roles.manage' => 'Create and manage custom roles and permissions (requires multi-role access)',
            
            // Leave
            'leave.view' => 'View leave requests, balances, and leave history',
            'leave.manage' => 'Approve, reject, and manage employee leave requests (requires leave management)',
            
            // Overtime
            'overtime.view' => 'View overtime records and overtime summaries',
            'overtime.approve' => 'Review and approve overtime requests from employees',
            
            // Projects
            'projects.view' => 'View project list, details, and progress (requires project tracking)',
            'projects.manage' => 'Create, edit, and manage projects and budgets (requires project tracking)',
            
            // Tasks
            'tasks.view' => 'View assigned tasks and task lists (requires task tracking)',
            'tasks.manage' => 'Create, assign, and manage tasks for team members (requires task tracking)',
            
            // Chat
            'chat.use' => 'Send and receive messages via the built-in chat system (requires chat feature)',
            
            // Notifications
            'notifications.publish' => 'Send announcements and notifications to employees',
            
            // Audit
            'audit.view' => 'View system audit logs and track important actions',
        ];

        foreach ($descriptions as $key => $description) {
            DB::table('permissions')
                ->where('key', $key)
                ->update(['description' => $description]);
        }
    }

    public function down(): void
    {
        DB::table('permissions')
            ->whereNotNull('description')
            ->update(['description' => null]);
    }
};
