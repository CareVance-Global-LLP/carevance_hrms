<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Makes the reporting line declarable rather than only derivable.
     *
     * reporting_manager_id was previously recomputed from group membership on
     * every user or department save, so an admin could not express a reporting
     * line that did not match the group: an employee reporting outside their
     * department was inexpressible, a group with two managers picked
     * arbitrarily, and a group with none produced null. Every HRIS of
     * consequence stores this explicitly instead (BambooHR "Reports To",
     * Keka's independent reporting axis).
     *
     * 'derived'  — the system inferred it from the group; group sync may update it.
     * 'explicit' — a human set it; group sync must never overwrite it.
     */
    public function up(): void
    {
        if (! Schema::hasTable('employee_work_infos')) {
            return;
        }

        if (! Schema::hasColumn('employee_work_infos', 'reporting_manager_source')) {
            Schema::table('employee_work_infos', function (Blueprint $table) {
                $table->string('reporting_manager_source', 16)
                    ->default('derived')
                    ->after('reporting_manager_id');
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('employee_work_infos')) {
            return;
        }

        if (Schema::hasColumn('employee_work_infos', 'reporting_manager_source')) {
            Schema::table('employee_work_infos', function (Blueprint $table) {
                $table->dropColumn('reporting_manager_source');
            });
        }
    }
};
