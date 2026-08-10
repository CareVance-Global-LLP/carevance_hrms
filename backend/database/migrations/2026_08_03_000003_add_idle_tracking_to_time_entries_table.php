<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Idle was measured but never persisted: the desktop client POSTs
     * idle_seconds / last_activity_at on every auto-stop, the controller
     * validates them, uses them for the notification email, and then throws
     * them away because no column existed to hold them.
     *
     * idle_seconds and trailing_idle_seconds are deliberately separate. Idle
     * inside [start_time, end_time] is subtracted from the span to get billed
     * time; idle after end_time is the tail that triggered the auto-stop and is
     * already excluded by rewinding end_time to the last keypress. Merging them
     * into one column would subtract the tail twice.
     *
     * duration_reconciled_at is the trust flag. TimeEntryDurationService raises
     * a stored duration back to the row's own span when it looks like an
     * un-backfilled zero; without a marker it would undo every idle adjustment
     * the stop paths make.
     *
     * stop_reason exists because three code paths (client stop, in-request
     * server fallback, timers:close-idle) all write the same
     * auto_stopped_for_idle boolean with three different duration rules, and
     * the daily-boundary close writes none at all — leaving it indistinguishable
     * from a real manual stop.
     */
    public function up(): void
    {
        if (! Schema::hasTable('time_entries')) {
            return;
        }

        Schema::table('time_entries', function (Blueprint $table) {
            if (! Schema::hasColumn('time_entries', 'idle_seconds')) {
                $table->unsignedInteger('idle_seconds')->default(0)->after('duration');
            }

            if (! Schema::hasColumn('time_entries', 'trailing_idle_seconds')) {
                $table->unsignedInteger('trailing_idle_seconds')->default(0)->after('idle_seconds');
            }

            if (! Schema::hasColumn('time_entries', 'last_activity_at')) {
                $table->timestamp('last_activity_at')->nullable()->after('trailing_idle_seconds');
            }

            if (! Schema::hasColumn('time_entries', 'duration_reconciled_at')) {
                $table->timestamp('duration_reconciled_at')->nullable()->after('last_activity_at');
            }

            if (! Schema::hasColumn('time_entries', 'stop_reason')) {
                $table->string('stop_reason', 32)->nullable()->after('auto_stopped_for_idle');
            }
        });

        if (! $this->hasIndex('time_entries_user_last_activity_idx')) {
            Schema::table('time_entries', function (Blueprint $table) {
                $table->index(['user_id', 'last_activity_at'], 'time_entries_user_last_activity_idx');
            });
        }
    }

    private function hasIndex(string $name): bool
    {
        try {
            return Schema::getConnection()
                ->getSchemaBuilder()
                ->hasIndex('time_entries', $name);
        } catch (\Throwable) {
            return false;
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('time_entries')) {
            return;
        }

        Schema::table('time_entries', function (Blueprint $table) {
            if ($this->hasIndex('time_entries_user_last_activity_idx')) {
                $table->dropIndex('time_entries_user_last_activity_idx');
            }

            foreach ([
                'idle_seconds',
                'trailing_idle_seconds',
                'last_activity_at',
                'duration_reconciled_at',
                'stop_reason',
            ] as $column) {
                if (Schema::hasColumn('time_entries', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
