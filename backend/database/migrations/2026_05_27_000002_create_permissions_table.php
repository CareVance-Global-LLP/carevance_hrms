<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('permissions', function (Blueprint $table) {
            $table->id();
            $table->string('key', 100)->unique();
            $table->string('name', 200);
            $table->string('group_name', 100);
            $table->text('description')->nullable();
            $table->string('plan_feature', 100)->nullable();
            $table->timestamps();
        });

        $permissions = [
            ['key' => 'dashboard.view', 'name' => 'View Dashboard', 'group_name' => 'Dashboard', 'plan_feature' => null],
            ['key' => 'timer.use', 'name' => 'Use Timer', 'group_name' => 'Timer', 'plan_feature' => 'desktop_timer'],
            ['key' => 'employees.view', 'name' => 'View Employees', 'group_name' => 'Employees', 'plan_feature' => 'user_management'],
            ['key' => 'employees.manage', 'name' => 'Manage Employees', 'group_name' => 'Employees', 'plan_feature' => 'user_management'],
            ['key' => 'groups.view', 'name' => 'View Groups', 'group_name' => 'Groups', 'plan_feature' => null],
            ['key' => 'groups.manage', 'name' => 'Manage Groups', 'group_name' => 'Groups', 'plan_feature' => null],
            ['key' => 'attendance.view', 'name' => 'View Attendance', 'group_name' => 'Attendance', 'plan_feature' => null],
            ['key' => 'selfies.view', 'name' => 'View Selfies Map', 'group_name' => 'Attendance', 'plan_feature' => 'monitoring'],
            ['key' => 'reports.view', 'name' => 'View Reports', 'group_name' => 'Reports', 'plan_feature' => 'reports'],
            ['key' => 'monitoring.view', 'name' => 'View Monitoring', 'group_name' => 'Monitoring', 'plan_feature' => 'monitoring'],
            ['key' => 'screenshots.view', 'name' => 'View Screenshots', 'group_name' => 'Monitoring', 'plan_feature' => 'screenshot'],
            ['key' => 'geofence.manage', 'name' => 'Manage Geofence', 'group_name' => 'Settings', 'plan_feature' => 'geo_fencing'],
            // Note: Payroll and Invoices permissions removed - not ready for production
            // ['key' => 'payroll.view', 'name' => 'View Payroll', 'group_name' => 'Payroll', 'plan_feature' => null],
            // ['key' => 'invoices.view', 'name' => 'View Invoices', 'group_name' => 'Invoices', 'plan_feature' => null],
            ['key' => 'leave.view', 'name' => 'View Leave', 'group_name' => 'Leave', 'plan_feature' => 'leave_management'],
            ['key' => 'leave.manage', 'name' => 'Manage Leave', 'group_name' => 'Leave', 'plan_feature' => 'leave_management'],
            ['key' => 'overtime.view', 'name' => 'View Overtime', 'group_name' => 'Overtime', 'plan_feature' => null],
            ['key' => 'overtime.approve', 'name' => 'Approve Overtime', 'group_name' => 'Overtime', 'plan_feature' => 'approval_workflow'],
            ['key' => 'projects.view', 'name' => 'View Projects', 'group_name' => 'Projects', 'plan_feature' => 'project_tracking'],
            ['key' => 'projects.manage', 'name' => 'Manage Projects', 'group_name' => 'Projects', 'plan_feature' => 'project_tracking'],
            ['key' => 'tasks.view', 'name' => 'View Tasks', 'group_name' => 'Tasks', 'plan_feature' => 'task_tracking'],
            ['key' => 'tasks.manage', 'name' => 'Manage Tasks', 'group_name' => 'Tasks', 'plan_feature' => 'task_tracking'],
            ['key' => 'chat.use', 'name' => 'Use Chat', 'group_name' => 'Chat', 'plan_feature' => 'chat'],
            ['key' => 'settings.view', 'name' => 'View Settings', 'group_name' => 'Settings', 'plan_feature' => null],
            ['key' => 'settings.manage', 'name' => 'Manage Settings', 'group_name' => 'Settings', 'plan_feature' => null],
            ['key' => 'productivity.manage', 'name' => 'Manage Productivity Rules', 'group_name' => 'Productivity', 'plan_feature' => null],
            ['key' => 'roles.manage', 'name' => 'Manage Roles', 'group_name' => 'Settings', 'plan_feature' => 'multi_role_access'],
            ['key' => 'notifications.publish', 'name' => 'Publish Notifications', 'group_name' => 'Notifications', 'plan_feature' => null],
            ['key' => 'audit.view', 'name' => 'View Audit Logs', 'group_name' => 'Audit', 'plan_feature' => null],
        ];

        foreach ($permissions as $perm) {
            DB::table('permissions')->insert([
                'key' => $perm['key'],
                'name' => $perm['name'],
                'group_name' => $perm['group_name'],
                'description' => null,
                'plan_feature' => $perm['plan_feature'],
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('permissions');
    }
};
