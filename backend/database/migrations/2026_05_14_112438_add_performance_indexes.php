<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Time entries - frequently queried by user_id and date ranges
        Schema::table('time_entries', function (Blueprint $table) {
            if (!$this->indexExists('time_entries', 'idx_time_entries_user_start')) {
                $table->index(['user_id', 'start_time'], 'idx_time_entries_user_start');
            }
            if (!$this->indexExists('time_entries', 'idx_time_entries_project_start')) {
                $table->index(['project_id', 'start_time'], 'idx_time_entries_project_start');
            }
        });

        // Activities - frequently queried by user and date ranges
        Schema::table('activities', function (Blueprint $table) {
            if (!$this->indexExists('activities', 'idx_activities_user_created')) {
                $table->index(['user_id', 'created_at'], 'idx_activities_user_created');
            }
            if (!$this->indexExists('activities', 'idx_activities_user_type_created')) {
                $table->index(['user_id', 'type', 'created_at'], 'idx_activities_user_type_created');
            }
        });

        // Screenshots - queried by time_entry (not user_id directly)
        Schema::table('screenshots', function (Blueprint $table) {
            if (!$this->indexExists('screenshots', 'idx_screenshots_time_entry_created')) {
                $table->index(['time_entry_id', 'created_at'], 'idx_screenshots_time_entry_created');
            }
        });

        // Tasks - queried by project and assignee
        Schema::table('tasks', function (Blueprint $table) {
            if (!$this->indexExists('tasks', 'idx_tasks_project_status')) {
                $table->index(['project_id', 'status'], 'idx_tasks_project_status');
            }
            // group_id index already exists from migration 2026_04_01_110100
        });

        // Notifications - indexes already exist from migration 2026_03_06_160000
        // app_notifications already has: user_id+is_read+created_at, org_id+type

        // Audit logs - indexes already exist from migration 2026_03_11_180000
        // audit_logs already has: org_id+created_at, actor_user_id+created_at, action+created_at
    }

    public function down(): void
    {
        Schema::table('time_entries', function (Blueprint $table) {
            if ($this->indexExists('time_entries', 'idx_time_entries_user_start')) {
                $table->dropIndex('idx_time_entries_user_start');
            }
            if ($this->indexExists('time_entries', 'idx_time_entries_project_start')) {
                $table->dropIndex('idx_time_entries_project_start');
            }
        });

        Schema::table('activities', function (Blueprint $table) {
            if ($this->indexExists('activities', 'idx_activities_user_created')) {
                $table->dropIndex('idx_activities_user_created');
            }
            if ($this->indexExists('activities', 'idx_activities_user_type_created')) {
                $table->dropIndex('idx_activities_user_type_created');
            }
        });

        Schema::table('screenshots', function (Blueprint $table) {
            if ($this->indexExists('screenshots', 'idx_screenshots_time_entry_created')) {
                $table->dropIndex('idx_screenshots_time_entry_created');
            }
        });

        Schema::table('tasks', function (Blueprint $table) {
            if ($this->indexExists('tasks', 'idx_tasks_project_status')) {
                $table->dropIndex('idx_tasks_project_status');
            }
        });
    }

    /**
     * Check if an index exists on a table (PostgreSQL compatible)
     */
    private function indexExists(string $table, string $index): bool
    {
        $result = DB::select(
            "SELECT indexname FROM pg_indexes WHERE tablename = ? AND indexname = ?",
            [$table, $index]
        );
        return count($result) > 0;
    }
};
