<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            if (!Schema::hasColumn('employee_payroll_templates', 'salary_template_id')) {
                $table->foreignId('salary_template_id')->nullable()->after('user_id')
                    ->constrained('salary_templates')->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            if (Schema::hasColumn('employee_payroll_templates', 'salary_template_id')) {
                $table->dropForeign(['salary_template_id']);
                $table->dropColumn('salary_template_id');
            }
        });
    }
};
