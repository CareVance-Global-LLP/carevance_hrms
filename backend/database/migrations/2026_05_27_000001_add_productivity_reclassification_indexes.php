<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('activities')) {
            try { DB::statement('ALTER TABLE activities ADD INDEX idx_activities_reclassify (user_id, normalized_domain(50), software_name(50))'); } catch (\Throwable) {}
            try { DB::statement('ALTER TABLE activities ADD INDEX idx_activities_name_lookup (user_id, name(50))'); } catch (\Throwable) {}
        }

        if (Schema::hasTable('activity_sessions')) {
            try { DB::statement('ALTER TABLE activity_sessions ADD INDEX idx_sessions_reclassify (user_id, normalized_domain(50), software_name(50))'); } catch (\Throwable) {}
            try { DB::statement('ALTER TABLE activity_sessions ADD INDEX idx_sessions_name_lookup (user_id, display_name(50))'); } catch (\Throwable) {}
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('activities')) {
            try { DB::statement('ALTER TABLE activities DROP INDEX idx_activities_reclassify'); } catch (\Throwable) {}
            try { DB::statement('ALTER TABLE activities DROP INDEX idx_activities_name_lookup'); } catch (\Throwable) {}
        }

        if (Schema::hasTable('activity_sessions')) {
            try { DB::statement('ALTER TABLE activity_sessions DROP INDEX idx_sessions_reclassify'); } catch (\Throwable) {}
            try { DB::statement('ALTER TABLE activity_sessions DROP INDEX idx_sessions_name_lookup'); } catch (\Throwable) {}
        }
    }
};
