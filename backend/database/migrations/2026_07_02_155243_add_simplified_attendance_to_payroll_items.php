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
        Schema::table('payroll_items', function (Blueprint $table) {
            // Simplified attendance fields (your plan's fields)
            $table->decimal('present_days', 5, 2)->default(0)->after('lOP_days')
                ->comment('Number of days present based on check-in existence');
            $table->decimal('paid_leave_days', 5, 2)->default(0)->after('present_days')
                ->comment('Full-day paid leave days');
            $table->decimal('unpaid_leave_days', 5, 2)->default(0)->after('paid_leave_days')
                ->comment('Full-day unpaid leave days');
            $table->decimal('half_day_present', 5, 2)->default(0)->after('unpaid_leave_days')
                ->comment('Half-day paid leave (counted as 0.5 present)');
            $table->decimal('half_day_absent', 5, 2)->default(0)->after('half_day_present')
                ->comment('Half-day unpaid leave (counted as 0.5 absent)');
            $table->decimal('absent_days', 5, 2)->default(0)->after('half_day_absent')
                ->comment('Full absent days (no check-in, no leave)');
            $table->decimal('total_payable_days', 5, 2)->default(0)->after('absent_days')
                ->comment('Total payable days = present + paid leave + (half_day_present * 0.5)');
            $table->decimal('total_lop_days', 5, 2)->default(0)->after('total_payable_days')
                ->comment('Total LOP days = absent + unpaid leave + (half_day_absent * 0.5)');
            $table->enum('attendance_calculation_mode', ['simplified', 'hours_based'])->default('simplified')->after('total_lop_days')
                ->comment('Which calculation mode was used');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('payroll_items', function (Blueprint $table) {
            $table->dropColumn([
                'present_days',
                'paid_leave_days',
                'unpaid_leave_days',
                'half_day_present',
                'half_day_absent',
                'absent_days',
                'total_payable_days',
                'total_lop_days',
                'attendance_calculation_mode',
            ]);
        });
    }
};
