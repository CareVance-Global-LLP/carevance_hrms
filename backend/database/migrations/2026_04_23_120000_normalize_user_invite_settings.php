<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('users', 'settings')) {
            return;
        }

        DB::table('users')
            ->select(['id', 'role', 'settings'])
            ->orderBy('id')
            ->chunkById(100, function ($users) {
                foreach ($users as $user) {
                    $settings = json_decode((string) ($user->settings ?? ''), true);
                    if (! is_array($settings)) {
                        $settings = [];
                    }

                    $interval = (int) ($settings['monitoring_interval_minutes'] ?? 10);
                    if (! in_array($interval, [1, 3, 5, 10, 15, 30], true)) {
                        $interval = 10;
                    }

                    $settings['monitoring_interval_minutes'] = $interval;
                    $settings['attendance_monitoring'] = array_key_exists('attendance_monitoring', $settings)
                        ? (bool) $settings['attendance_monitoring']
                        : true;
                    $settings['can_edit_time'] = array_key_exists('can_edit_time', $settings)
                        ? (bool) $settings['can_edit_time']
                        : true;
                    $settings['task_assignment_access'] = array_key_exists('task_assignment_access', $settings)
                        ? (bool) $settings['task_assignment_access']
                        : true;

                    if (($user->role ?? null) === 'employee') {
                        $settings['payroll_visibility'] = false;
                    } elseif (! array_key_exists('payroll_visibility', $settings)) {
                        $settings['payroll_visibility'] = true;
                    }

                    DB::table('users')
                        ->where('id', $user->id)
                        ->update(['settings' => json_encode($settings)]);
                }
            });
    }

    public function down(): void
    {
        // Intentionally non-destructive: these settings may have been edited after migration.
    }
};
