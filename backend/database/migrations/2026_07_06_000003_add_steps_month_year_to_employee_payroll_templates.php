<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Add steps_month_year column to employee_payroll_templates.
 *
 * This column tracks which month the step completions apply to,
 * fixing the bug where April completions were showing as complete
 * in May. When steps_month_year !== requested month, all steps
 * appear incomplete (fresh start for the new month).
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            $table->string('steps_month_year', 7)->nullable()->after('current_step');
        });
    }

    public function down(): void
    {
        $driver = DB::connection()->getDriverName();

        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            $table->dropColumn('steps_month_year');
        });
    }
};
