<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Add month_year to payroll_items if missing. Backfill from payroll_monthly_runs.
        if (!Schema::hasColumn('payroll_items', 'month_year')) {
            Schema::table('payroll_items', function (Blueprint $table) {
                $table->string('month_year', 7)->nullable()->after('payroll_run_id');
                $table->index(['organization_id', 'month_year']);
                $table->index(['user_id', 'month_year']);
            });
            // Backfill from the linked run.
            DB::statement("
                UPDATE payroll_items pi
                SET month_year = pmr.month_year
                FROM payroll_monthly_runs pmr
                WHERE pi.payroll_run_id = pmr.id
                  AND pi.month_year IS NULL
            ");
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('payroll_items', 'month_year')) {
            Schema::table('payroll_items', function (Blueprint $table) {
                $table->dropIndex(['organization_id', 'month_year']);
                $table->dropIndex(['user_id', 'month_year']);
                $table->dropColumn('month_year');
            });
        }
    }
};
