<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Screenshots table indexes - CRITICAL for monitoring page
        Schema::table('screenshots', function (Blueprint $table) {
            if (!$this->indexExists('screenshots', 'idx_screenshots_time_entry')) {
                $table->index(['time_entry_id', 'created_at'], 'idx_screenshots_time_entry');
            }
            if (!$this->indexExists('screenshots', 'idx_screenshots_created_at')) {
                $table->index(['created_at'], 'idx_screenshots_created_at');
            }
        });

        // Attendance records additional indexes
        Schema::table('attendance_records', function (Blueprint $table) {
            if (!$this->indexExists('attendance_records', 'idx_attendance_org_date_status')) {
                $table->index(['organization_id', 'attendance_date', 'status'], 'idx_attendance_org_date_status');
            }
        });

        // Attendance punches indexes
        Schema::table('attendance_punches', function (Blueprint $table) {
            if (!$this->indexExists('attendance_punches', 'idx_punches_user_record')) {
                $table->index(['user_id', 'attendance_record_id', 'punch_in_at'], 'idx_punches_user_record');
            }
        });

        // Time entries additional indexes
        Schema::table('time_entries', function (Blueprint $table) {
            if (!$this->indexExists('time_entries', 'idx_time_entries_user_slot')) {
                $table->index(['user_id', 'timer_slot', 'start_time'], 'idx_time_entries_user_slot');
            }
            if (!$this->indexExists('time_entries', 'idx_time_entries_created_at')) {
                $table->index(['created_at'], 'idx_time_entries_created_at');
            }
        });

        // Activity sessions additional indexes
        Schema::table('activity_sessions', function (Blueprint $table) {
            if (!$this->indexExists('activity_sessions', 'idx_sessions_activity_kind')) {
                $table->index(['activity_kind', 'started_at'], 'idx_sessions_activity_kind');
            }
        });

        // Add partial index for active/running time entries (commonly queried)
        DB::statement('
            CREATE INDEX IF NOT EXISTS idx_time_entries_running 
            ON time_entries (user_id, start_time) 
            WHERE end_time IS NULL
        ');
    }

    public function down(): void
    {
        Schema::table('screenshots', function (Blueprint $table) {
            if ($this->indexExists('screenshots', 'idx_screenshots_time_entry')) {
                $table->dropIndex('idx_screenshots_time_entry');
            }
            if ($this->indexExists('screenshots', 'idx_screenshots_created_at')) {
                $table->dropIndex('idx_screenshots_created_at');
            }
        });

        Schema::table('attendance_records', function (Blueprint $table) {
            if ($this->indexExists('attendance_records', 'idx_attendance_org_date_status')) {
                $table->dropIndex('idx_attendance_org_date_status');
            }
        });

        Schema::table('attendance_punches', function (Blueprint $table) {
            if ($this->indexExists('attendance_punches', 'idx_punches_user_record')) {
                $table->dropIndex('idx_punches_user_record');
            }
        });

        Schema::table('time_entries', function (Blueprint $table) {
            if ($this->indexExists('time_entries', 'idx_time_entries_user_slot')) {
                $table->dropIndex('idx_time_entries_user_slot');
            }
            if ($this->indexExists('time_entries', 'idx_time_entries_created_at')) {
                $table->dropIndex('idx_time_entries_created_at');
            }
        });

        Schema::table('activity_sessions', function (Blueprint $table) {
            if ($this->indexExists('activity_sessions', 'idx_sessions_activity_kind')) {
                $table->dropIndex('idx_sessions_activity_kind');
            }
        });

        DB::statement('DROP INDEX IF EXISTS idx_time_entries_running');
    }

    private function indexExists(string $table, string $index): bool
    {
        $result = DB::select(
            "SELECT indexname FROM pg_indexes WHERE tablename = ? AND indexname = ?",
            [$table, $index]
        );
        return count($result) > 0;
    }
};
