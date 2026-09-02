<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('employee_payroll_templates') && !Schema::hasColumn('employee_payroll_templates', 'draft_month_year')) {
            Schema::table('employee_payroll_templates', function (Blueprint $table) {
                // Month gate — same pattern as steps_month_year
                $table->string('draft_month_year', 7)->nullable()->after('steps_month_year');
                // Step 1 drafts
                $table->decimal('draft_working_days', 5, 2)->nullable()->after('draft_month_year');
                $table->decimal('draft_days_present', 5, 2)->nullable()->after('draft_working_days');
                $table->decimal('draft_lop_days', 5, 2)->nullable()->after('draft_days_present');
                $table->decimal('draft_paid_leave_days', 5, 2)->nullable()->after('draft_lop_days');
                $table->decimal('draft_overtime_hours', 7, 2)->nullable()->after('draft_paid_leave_days');
                $table->decimal('draft_overtime_pay', 12, 2)->nullable()->after('draft_overtime_hours');
                // Step 2 drafts
                $table->json('draft_custom_earnings')->nullable()->after('draft_overtime_pay');
                $table->json('draft_custom_deductions')->nullable()->after('draft_custom_earnings');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('employee_payroll_templates') && Schema::hasColumn('employee_payroll_templates', 'draft_month_year')) {
            Schema::table('employee_payroll_templates', function (Blueprint $table) {
                $table->dropColumn([
                    'draft_month_year',
                    'draft_working_days',
                    'draft_days_present',
                    'draft_lop_days',
                    'draft_paid_leave_days',
                    'draft_overtime_hours',
                    'draft_overtime_pay',
                    'draft_custom_earnings',
                    'draft_custom_deductions',
                ]);
            });
        }
    }
};
