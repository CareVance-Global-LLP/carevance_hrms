<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('time_entries')) {
            return;
        }

        if (!Schema::hasColumn('time_entries', 'auto_stopped_for_idle')) {
            Schema::table('time_entries', function (Blueprint $table) {
                $table->boolean('auto_stopped_for_idle')->default(false)->after('duration');
                $table->index(['user_id', 'end_time', 'auto_stopped_for_idle'], 'time_entries_user_end_autostop_idx');
            });
        }
    }

    public function down(): void
    {
        if (!Schema::hasTable('time_entries')) {
            return;
        }

        if (Schema::hasColumn('time_entries', 'auto_stopped_for_idle')) {
            Schema::table('time_entries', function (Blueprint $table) {
                $table->dropIndex('time_entries_user_end_autostop_idx');
                $table->dropColumn('auto_stopped_for_idle');
            });
        }
    }
};
