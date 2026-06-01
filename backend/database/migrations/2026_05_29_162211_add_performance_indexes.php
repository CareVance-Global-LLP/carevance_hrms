<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Add indexes for activities table
        Schema::table('activities', function (Blueprint $table) {
            if (! $this->indexExists('activities', 'activities_user_id_classification_recorded_at_index')) {
                $table->index(['user_id', 'type', 'recorded_at'], 'activities_user_id_classification_recorded_at_index');
            }
        });

        // Add indexes for time_entries table
        Schema::table('time_entries', function (Blueprint $table) {
            if (! $this->indexExists('time_entries', 'time_entries_user_project_start_index')) {
                $table->index(['user_id', 'project_id', 'start_time'], 'time_entries_user_project_start_index');
            }
        });

        // Add indexes for leave_requests table
        Schema::table('leave_requests', function (Blueprint $table) {
            if (! $this->indexExists('leave_requests', 'leave_requests_org_status_created_index')) {
                $table->index(['organization_id', 'status', 'created_at'], 'leave_requests_org_status_created_index');
            }
        });

        // Add indexes for attendance_records table
        Schema::table('attendance_records', function (Blueprint $table) {
            if (! $this->indexExists('attendance_records', 'attendance_user_status_date_index')) {
                $table->index(['user_id', 'status', 'attendance_date'], 'attendance_user_status_date_index');
            }
        });
    }

    public function down(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            $table->dropIndex('activities_user_id_classification_recorded_at_index');
        });

        Schema::table('time_entries', function (Blueprint $table) {
            $table->dropIndex('time_entries_user_project_start_index');
        });

        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropIndex('leave_requests_org_status_created_index');
        });

        Schema::table('attendance_records', function (Blueprint $table) {
            $table->dropIndex('attendance_user_status_date_index');
        });
    }

    private function indexExists(string $table, string $index): bool
    {
        $indexes = Schema::getIndexes($table);

        return collect($indexes)->contains(fn ($idx) => $idx['name'] === $index);
    }
};
