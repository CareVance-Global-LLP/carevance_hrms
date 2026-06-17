<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Idempotent: an earlier comprehensive-components migration
        // (2026_06_10_120000) already adds da_percentage on fresh DBs.
        // We only need to add it if the column is missing.
        if (Schema::hasColumn('employee_payroll_templates', 'da_percentage')) {
            return;
        }
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            $table->decimal('da_percentage', 5, 2)->default(0)->after('hra_percentage');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            $table->dropColumn('da_percentage');
        });
    }
};
