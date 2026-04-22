<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            if (! Schema::hasColumn('activities', 'app_name')) {
                $table->string('app_name')->nullable()->after('name');
            }

            if (! Schema::hasColumn('activities', 'window_title')) {
                $table->string('window_title')->nullable()->after('app_name');
            }

            if (! Schema::hasColumn('activities', 'url')) {
                $table->text('url')->nullable()->after('window_title');
            }
        });

        DB::statement('CREATE INDEX IF NOT EXISTS activities_user_type_recorded_at_index ON activities (user_id, type, recorded_at)');
    }

    public function down(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            DB::statement('DROP INDEX IF EXISTS activities_user_type_recorded_at_index');

            $columnsToDrop = array_values(array_filter([
                Schema::hasColumn('activities', 'app_name') ? 'app_name' : null,
                Schema::hasColumn('activities', 'window_title') ? 'window_title' : null,
                Schema::hasColumn('activities', 'url') ? 'url' : null,
            ]));

            if ($columnsToDrop !== []) {
                $table->dropColumn($columnsToDrop);
            }
        });
    }
};
