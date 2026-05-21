<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('organizations')) {
            Schema::table('organizations', function (Blueprint $table) {
                if (!Schema::hasColumn('organizations', 'max_seats')) {
                    $table->integer('max_seats')->default(5)->after('settings');
                }
            });

            DB::table('organizations')
                ->where('plan_code', 'starter')
                ->update(['plan_code' => 'basic']);

            DB::table('organizations')
                ->where('plan_code', 'growth')
                ->update(['plan_code' => 'advanced_tracker']);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('organizations')) {
            Schema::table('organizations', function (Blueprint $table) {
                if (Schema::hasColumn('organizations', 'max_seats')) {
                    $table->dropColumn('max_seats');
                }
            });

            DB::table('organizations')
                ->where('plan_code', 'basic')
                ->update(['plan_code' => 'starter']);

            DB::table('organizations')
                ->where('plan_code', 'advanced_tracker')
                ->update(['plan_code' => 'growth']);
        }
    }
};
