<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Records that a punch was closed FOR somebody rather than BY them.
 *
 * Attendance used to be closed as a side effect of the timer's idle sweep. Now
 * that a punch no longer creates a timer, nothing closed a forgotten check-out
 * at all — so a punch stayed open indefinitely and the day never totalled.
 *
 * The sweeper that fixes that has to leave a mark. "Checked out at 18:00" and
 * "was still open at 18:00, so we closed it there" are materially different
 * facts when somebody disputes a day's hours, and a column is the only place
 * that difference can survive. The timer side already records `stop_reason` for
 * exactly this reason; this is its counterpart.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('attendance_punches')) {
            return;
        }

        if (Schema::hasColumn('attendance_punches', 'auto_closed_reason')) {
            return;
        }

        Schema::table('attendance_punches', function (Blueprint $table) {
            $table->string('auto_closed_reason', 40)->nullable();
        });
    }

    public function down(): void
    {
        if (! Schema::hasColumn('attendance_punches', 'auto_closed_reason')) {
            return;
        }

        Schema::table('attendance_punches', function (Blueprint $table) {
            $table->dropColumn('auto_closed_reason');
        });
    }
};
