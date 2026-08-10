<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Separate the contracted monthly gross from the gross actually earned.
 *
 * `gross_salary` carried the full month's figure while loss of pay sat in the
 * deduction block. Every statutory return reads that one field — ECR gross
 * wages, ESI monthly wages, 24Q gross total income, Form 16 annual gross — and
 * all four are earned-wage returns, so a full-month gross beside a positive
 * NCP day count is self-contradictory on the face of the return and inflates
 * Form 16 with income never credited.
 *
 * `gross_salary` becomes the earned figure. The contracted monthly rate moves
 * here, where the payslip's optional "actual" column, arrears and CTC letters
 * can still reach it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('payroll_items')) {
            return;
        }

        if (! Schema::hasColumn('payroll_items', 'gross_full_month')) {
            Schema::table('payroll_items', function (Blueprint $table) {
                $table->decimal('gross_full_month', 12, 2)->nullable()->after('gross_salary');
            });
        }

        // Existing rows stored the full month in gross_salary, so that is what
        // the contracted rate was. Copy it across before anything starts
        // writing the earned figure, or the two become indistinguishable.
        DB::table('payroll_items')
            ->whereNull('gross_full_month')
            ->update(['gross_full_month' => DB::raw('gross_salary')]);
    }

    public function down(): void
    {
        if (Schema::hasTable('payroll_items') && Schema::hasColumn('payroll_items', 'gross_full_month')) {
            Schema::table('payroll_items', function (Blueprint $table) {
                $table->dropColumn('gross_full_month');
            });
        }
    }
};
