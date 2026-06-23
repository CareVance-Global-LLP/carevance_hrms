<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add per-step completion tracking to employee_payroll_templates.
 *
 * Each wizard step (1..6) has a boolean column that records whether
 * the admin marked the step as complete for the employee. The Bulk
 * Payroll Matrix view in the frontend reads these columns to render
 * the left-side progress sidebar and the "X of 4 employees on this
 * step" footer.
 *
 * The `current_step` string column stores the wizard's last-known
 * position (1..6). It is read by the BulkPayrollMatrix component when
 * the user enters the matrix to highlight the step they were on.
 *
 * Defaults are all `false` / '1' so existing rows render as "not yet
 * started" without any data migration.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            $table->boolean('step1_completed')->default(false);
            $table->boolean('step2_completed')->default(false);
            $table->boolean('step3_completed')->default(false);
            $table->boolean('step4_completed')->default(false);
            $table->boolean('step5_completed')->default(false);
            $table->boolean('step6_completed')->default(false);
            $table->string('current_step', 4)->default('1');
        });
    }

    public function down(): void
    {
        $driver = DB::connection()->getDriverName();

        // SQLite/MySQL/MariaDB/PostgreSQL all support DROP COLUMN.
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            $table->dropColumn([
                'step1_completed',
                'step2_completed',
                'step3_completed',
                'step4_completed',
                'step5_completed',
                'step6_completed',
                'current_step',
            ]);
        });
    }
};
