<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Freeze the per-day salary divisor onto every payroll item.
 *
 * The divisor that turns a monthly salary into a daily rate was never stored.
 * It was re-derived from live attendance and live org config every time a
 * payslip, register or filing was rendered, so changing the setting silently
 * rewrote the arithmetic of already-paid months and no historical payslip
 * could be reproduced.
 *
 * `template_snapshot` on this table is the existing precedent for freezing
 * config into a row; this does the same for the one number every earnings
 * figure is divided by.
 *
 * Guarded throughout — the schema has drifted from the migrations before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('payroll_items')) {
            return;
        }

        Schema::table('payroll_items', function (Blueprint $table) {
            if (! Schema::hasColumn('payroll_items', 'salary_day_basis')) {
                // calendar = actual days in the month, the statutory default.
                // fixed_30 / fixed_26 = policy divisors. attendance = the
                // working-day count, kept only so pre-existing rows stay
                // reproducible.
                $table->string('salary_day_basis', 20)->nullable()->after('attendance_calculation_mode');
            }

            if (! Schema::hasColumn('payroll_items', 'salary_divisor_days')) {
                $table->decimal('salary_divisor_days', 5, 2)->nullable()->after('salary_day_basis');
            }
        });

        // Existing rows were all produced by the attendance-derived divisor.
        // Stamping them keeps their payslips reproducible rather than letting
        // them re-derive against whatever the setting becomes.
        DB::table('payroll_items')
            ->whereNull('salary_day_basis')
            ->update([
                'salary_day_basis' => 'attendance',
                'salary_divisor_days' => DB::raw('total_working_days'),
            ]);
    }

    public function down(): void
    {
        if (! Schema::hasTable('payroll_items')) {
            return;
        }

        Schema::table('payroll_items', function (Blueprint $table) {
            foreach (['salary_day_basis', 'salary_divisor_days'] as $column) {
                if (Schema::hasColumn('payroll_items', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
