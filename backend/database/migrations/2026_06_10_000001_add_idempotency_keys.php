<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add local_id and device_id columns for offline sync idempotency.
     *
     * These columns allow the desktop tracker to safely re-upload records
     * without creating duplicates. The (local_id, device_id) pair acts as
     * a unique idempotency key for each offline-generated record.
     */
    public function up(): void
    {
        // Attendance punches
        Schema::table('attendance_punches', function (Blueprint $table) {
            $table->string('local_id', 120)->nullable()->index();
            $table->string('device_id', 120)->nullable()->index();
            $table->unique(['local_id', 'device_id'], 'attendance_punches_idempotent');
        });

        // Screenshots
        Schema::table('screenshots', function (Blueprint $table) {
            $table->string('local_id', 120)->nullable()->index();
            $table->string('device_id', 120)->nullable()->index();
            $table->unique(['local_id', 'device_id'], 'screenshots_idempotent');
        });

        // Activities
        Schema::table('activities', function (Blueprint $table) {
            $table->string('local_id', 120)->nullable()->index();
            $table->string('device_id', 120)->nullable()->index();
            $table->unique(['local_id', 'device_id'], 'activities_idempotent');
        });

        // Activity sessions
        Schema::table('activity_sessions', function (Blueprint $table) {
            $table->string('local_id', 120)->nullable()->index();
            $table->string('device_id', 120)->nullable()->index();
            $table->unique(['local_id', 'device_id'], 'activity_sessions_idempotent');
        });

        // Time entries
        Schema::table('time_entries', function (Blueprint $table) {
            $table->string('local_id', 120)->nullable()->index();
            $table->string('device_id', 120)->nullable()->index();
            $table->unique(['local_id', 'device_id'], 'time_entries_idempotent');
        });
    }

    /**
     * Reverse the migration.
     */
    public function down(): void
    {
        Schema::table('attendance_punches', function (Blueprint $table) {
            $table->dropUnique('attendance_punches_idempotent');
            $table->dropIndex(['local_id']);
            $table->dropIndex(['device_id']);
            $table->dropColumn(['local_id', 'device_id']);
        });

        Schema::table('screenshots', function (Blueprint $table) {
            $table->dropUnique('screenshots_idempotent');
            $table->dropIndex(['local_id']);
            $table->dropIndex(['device_id']);
            $table->dropColumn(['local_id', 'device_id']);
        });

        Schema::table('activities', function (Blueprint $table) {
            $table->dropUnique('activities_idempotent');
            $table->dropIndex(['local_id']);
            $table->dropIndex(['device_id']);
            $table->dropColumn(['local_id', 'device_id']);
        });

        Schema::table('activity_sessions', function (Blueprint $table) {
            $table->dropUnique('activity_sessions_idempotent');
            $table->dropIndex(['local_id']);
            $table->dropIndex(['device_id']);
            $table->dropColumn(['local_id', 'device_id']);
        });

        Schema::table('time_entries', function (Blueprint $table) {
            $table->dropUnique('time_entries_idempotent');
            $table->dropIndex(['local_id']);
            $table->dropIndex(['device_id']);
            $table->dropColumn(['local_id', 'device_id']);
        });
    }
};
