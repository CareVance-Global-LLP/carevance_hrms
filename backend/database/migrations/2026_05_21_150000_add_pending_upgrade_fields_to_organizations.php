<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('organizations')) {
            Schema::table('organizations', function (Blueprint $table) {
                if (!Schema::hasColumn('organizations', 'pending_plan_code')) {
                    $table->string('pending_plan_code')->nullable()->after('max_seats');
                }
                if (!Schema::hasColumn('organizations', 'pending_billing_cycle')) {
                    $table->string('pending_billing_cycle')->nullable()->after('pending_plan_code');
                }
                if (!Schema::hasColumn('organizations', 'pending_seats')) {
                    $table->integer('pending_seats')->nullable()->after('pending_billing_cycle');
                }
                if (!Schema::hasColumn('organizations', 'pending_upgrade_amount')) {
                    $table->decimal('pending_upgrade_amount', 10, 2)->nullable()->after('pending_seats');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('organizations')) {
            Schema::table('organizations', function (Blueprint $table) {
                if (Schema::hasColumn('organizations', 'pending_upgrade_amount')) {
                    $table->dropColumn('pending_upgrade_amount');
                }
                if (Schema::hasColumn('organizations', 'pending_seats')) {
                    $table->dropColumn('pending_seats');
                }
                if (Schema::hasColumn('organizations', 'pending_billing_cycle')) {
                    $table->dropColumn('pending_billing_cycle');
                }
                if (Schema::hasColumn('organizations', 'pending_plan_code')) {
                    $table->dropColumn('pending_plan_code');
                }
            });
        }
    }
};
