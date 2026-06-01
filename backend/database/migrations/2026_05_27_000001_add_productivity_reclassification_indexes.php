<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('activities')) {
            try { DB::statement('CREATE INDEX IF NOT EXISTS idx_activities_reclassify ON activities (user_id, normalized_domain, software_name)'); } catch (\Throwable $e) {}
            try { DB::statement('CREATE INDEX IF NOT EXISTS idx_activities_name_lookup ON activities (user_id, name)'); } catch (\Throwable $e) {}
        }

        if (Schema::hasTable('activity_sessions')) {
            try { DB::statement('CREATE INDEX IF NOT EXISTS idx_sessions_reclassify ON activity_sessions (user_id, normalized_domain, software_name)'); } catch (\Throwable $e) {}
            try { DB::statement('CREATE INDEX IF NOT EXISTS idx_sessions_name_lookup ON activity_sessions (user_id, display_name)'); } catch (\Throwable $e) {}
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('activities')) {
            try { DB::statement('DROP INDEX IF EXISTS idx_activities_reclassify'); } catch (\Throwable) {}
            try { DB::statement('DROP INDEX IF EXISTS idx_activities_name_lookup'); } catch (\Throwable) {}
        }

        if (Schema::hasTable('activity_sessions')) {
            try { DB::statement('DROP INDEX IF EXISTS idx_sessions_reclassify'); } catch (\Throwable) {}
            try { DB::statement('DROP INDEX IF EXISTS idx_sessions_name_lookup'); } catch (\Throwable) {}
        }
    }
};
