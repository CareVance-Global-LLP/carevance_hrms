<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Activities table - critical for timeline performance
        Schema::table('activities', function (Blueprint $table) {
            // Composite index for user_id + recorded_at (most common query pattern)
            if (!$this->indexExists('activities', 'idx_activities_user_recorded')) {
                $table->index(['user_id', 'recorded_at'], 'idx_activities_user_recorded');
            }
            
            // Index for time_entry_id lookups
            if (!$this->indexExists('activities', 'idx_activities_time_entry')) {
                $table->index(['time_entry_id', 'recorded_at'], 'idx_activities_time_entry');
            }
            
            // Index for type-based filtering
            if (!$this->indexExists('activities', 'idx_activities_type_recorded')) {
                $table->index(['type', 'recorded_at'], 'idx_activities_type_recorded');
            }
            
            // Index for classification-based queries
            if (!$this->indexExists('activities', 'idx_activities_classification')) {
                $table->index(['classification', 'recorded_at'], 'idx_activities_classification');
            }
        });

        // Activity Sessions table - heavily used in timeline
        Schema::table('activity_sessions', function (Blueprint $table) {
            // Composite index for user_id + started_at/ended_at
            if (!$this->indexExists('activity_sessions', 'idx_sessions_user_started')) {
                $table->index(['user_id', 'started_at'], 'idx_sessions_user_started');
            }
            
            if (!$this->indexExists('activity_sessions', 'idx_sessions_user_ended')) {
                $table->index(['user_id', 'ended_at'], 'idx_sessions_user_ended');
            }
            
            // Index for time_entry_id
            if (!$this->indexExists('activity_sessions', 'idx_sessions_time_entry')) {
                $table->index(['time_entry_id', 'started_at'], 'idx_sessions_time_entry');
            }
            
            // Index for overlap queries (started_at + ended_at)
            if (!$this->indexExists('activity_sessions', 'idx_sessions_overlap')) {
                $table->index(['started_at', 'ended_at'], 'idx_sessions_overlap');
            }
        });

        // Time entries - additional indexes for better performance (only existing columns)
        Schema::table('time_entries', function (Blueprint $table) {
            // Index for active timers (null end_time) - user_id + end_time
            if (!$this->indexExists('time_entries', 'idx_time_entries_active')) {
                $table->index(['user_id', 'end_time'], 'idx_time_entries_active');
            }
            
            // Index for user + start_time (common query pattern)
            if (!$this->indexExists('time_entries', 'idx_time_entries_user_start')) {
                $table->index(['user_id', 'start_time'], 'idx_time_entries_user_start');
            }
            
            // Index for project + start_time
            if (!$this->indexExists('time_entries', 'idx_time_entries_project_start')) {
                $table->index(['project_id', 'start_time'], 'idx_time_entries_project_start');
            }
            
            // Index for created_at (for sorting)
            if (!$this->indexExists('time_entries', 'idx_time_entries_created_at')) {
                $table->index(['created_at'], 'idx_time_entries_created_at');
            }
        });

        // Attendance records - for dashboard performance
        Schema::table('attendance_records', function (Blueprint $table) {
            if (!$this->indexExists('attendance_records', 'idx_attendance_user_date')) {
                $table->index(['user_id', 'attendance_date'], 'idx_attendance_user_date');
            }
            
            if (!$this->indexExists('attendance_records', 'idx_attendance_org_date')) {
                $table->index(['organization_id', 'attendance_date'], 'idx_attendance_org_date');
            }
        });

        // Leave requests - for dashboard performance
        Schema::table('leave_requests', function (Blueprint $table) {
            if (!$this->indexExists('leave_requests', 'idx_leaves_user_status')) {
                $table->index(['user_id', 'status', 'start_date', 'end_date'], 'idx_leaves_user_status');
            }
            
            if (!$this->indexExists('leave_requests', 'idx_leaves_org_status')) {
                $table->index(['organization_id', 'status', 'start_date', 'end_date'], 'idx_leaves_org_status');
            }
        });
    }

    public function down(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            if ($this->indexExists('activities', 'idx_activities_user_recorded')) {
                $table->dropIndex('idx_activities_user_recorded');
            }
            if ($this->indexExists('activities', 'idx_activities_time_entry')) {
                $table->dropIndex('idx_activities_time_entry');
            }
            if ($this->indexExists('activities', 'idx_activities_type_recorded')) {
                $table->dropIndex('idx_activities_type_recorded');
            }
            if ($this->indexExists('activities', 'idx_activities_classification')) {
                $table->dropIndex('idx_activities_classification');
            }
        });

        Schema::table('activity_sessions', function (Blueprint $table) {
            if ($this->indexExists('activity_sessions', 'idx_sessions_user_started')) {
                $table->dropIndex('idx_sessions_user_started');
            }
            if ($this->indexExists('activity_sessions', 'idx_sessions_user_ended')) {
                $table->dropIndex('idx_sessions_user_ended');
            }
            if ($this->indexExists('activity_sessions', 'idx_sessions_time_entry')) {
                $table->dropIndex('idx_sessions_time_entry');
            }
            if ($this->indexExists('activity_sessions', 'idx_sessions_overlap')) {
                $table->dropIndex('idx_sessions_overlap');
            }
        });

        Schema::table('time_entries', function (Blueprint $table) {
            if ($this->indexExists('time_entries', 'idx_time_entries_active')) {
                $table->dropIndex('idx_time_entries_active');
            }
            if ($this->indexExists('time_entries', 'idx_time_entries_user_start')) {
                $table->dropIndex('idx_time_entries_user_start');
            }
            if ($this->indexExists('time_entries', 'idx_time_entries_project_start')) {
                $table->dropIndex('idx_time_entries_project_start');
            }
            if ($this->indexExists('time_entries', 'idx_time_entries_created_at')) {
                $table->dropIndex('idx_time_entries_created_at');
            }
        });

        Schema::table('attendance_records', function (Blueprint $table) {
            if ($this->indexExists('attendance_records', 'idx_attendance_user_date')) {
                $table->dropIndex('idx_attendance_user_date');
            }
            if ($this->indexExists('attendance_records', 'idx_attendance_org_date')) {
                $table->dropIndex('idx_attendance_org_date');
            }
        });

        Schema::table('leave_requests', function (Blueprint $table) {
            if ($this->indexExists('leave_requests', 'idx_leaves_user_status')) {
                $table->dropIndex('idx_leaves_user_status');
            }
            if ($this->indexExists('leave_requests', 'idx_leaves_org_status')) {
                $table->dropIndex('idx_leaves_org_status');
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
