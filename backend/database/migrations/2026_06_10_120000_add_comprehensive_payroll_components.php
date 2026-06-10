<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Add missing columns to employee_payroll_templates
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            // Additional Allowances
            $table->decimal('da_percentage', 5, 2)->default(0)->after('hra_percentage')->comment('Dearness Allowance percentage');
            $table->decimal('cca_amount', 10, 2)->default(0)->after('conveyance_allowance')->comment('City Compensatory Allowance');
            $table->decimal('education_allowance', 10, 2)->default(0)->after('cca_amount')->comment('Children Education Allowance');
            $table->decimal('hostel_allowance', 10, 2)->default(0)->after('education_allowance')->comment('Hostel Expenditure Allowance');
            $table->decimal('internet_allowance', 10, 2)->default(0)->after('hostel_allowance')->comment('Internet/Phone Allowance');
            $table->decimal('meal_allowance', 10, 2)->default(0)->after('internet_allowance')->comment('Meal/Food Allowance');
            $table->decimal('transport_allowance', 10, 2)->default(0)->after('meal_allowance')->comment('Transport Allowance');
            $table->decimal('uniform_allowance', 10, 2)->default(0)->after('transport_allowance')->comment('Uniform Allowance');
            $table->decimal('books_periodicals', 10, 2)->default(0)->after('uniform_allowance')->comment('Books & Periodicals Allowance');
            $table->decimal('fuel_maintenance', 10, 2)->default(0)->after('books_periodicals')->comment('Fuel & Maintenance Allowance');
            
            // Statutory Components
            $table->boolean('nps_enabled')->default(false)->after('tds_enabled')->comment('National Pension System');
            $table->decimal('nps_employee_percentage', 5, 2)->default(10.00)->after('nps_enabled');
            $table->boolean('vpf_enabled')->default(false)->after('nps_enabled')->comment('Voluntary PF');
            $table->decimal('vpf_percentage', 5, 2)->default(0)->after('vpf_enabled');
            
            // Component Settings
            $table->json('component_settings')->nullable()->after('custom_deductions')->comment('Advanced component configuration');
        });

        // Add missing columns to payroll_items
        Schema::table('payroll_items', function (Blueprint $table) {
            // Additional Earnings
            $table->decimal('da', 12, 2)->default(0)->after('special_allowance')->comment('Dearness Allowance');
            $table->decimal('cca', 12, 2)->default(0)->after('da')->comment('City Compensatory Allowance');
            $table->decimal('education', 12, 2)->default(0)->after('cca')->comment('Education Allowance');
            $table->decimal('hostel', 12, 2)->default(0)->after('education')->comment('Hostel Allowance');
            $table->decimal('internet', 12, 2)->default(0)->after('hostel')->comment('Internet Allowance');
            $table->decimal('meal', 12, 2)->default(0)->after('internet')->comment('Meal Allowance');
            $table->decimal('transport', 12, 2)->default(0)->after('meal')->comment('Transport Allowance');
            $table->decimal('uniform', 12, 2)->default(0)->after('transport')->comment('Uniform Allowance');
            $table->decimal('books_periodicals_amount', 12, 2)->default(0)->after('uniform')->comment('Books & Periodicals');
            $table->decimal('fuel_maintenance', 12, 2)->default(0)->after('books_periodicals_amount')->comment('Fuel & Maintenance');
            
            // Variable Pay
            $table->decimal('variable_pay', 12, 2)->default(0)->after('fuel_maintenance')->comment('Variable Pay/Bonus');
            $table->decimal('performance_bonus', 12, 2)->default(0)->after('variable_pay')->comment('Performance Bonus');
            $table->decimal('retention_bonus', 12, 2)->default(0)->after('performance_bonus')->comment('Retention Bonus');
            
            // Arrears
            $table->decimal('arrears', 12, 2)->default(0)->after('retention_bonus')->comment('Arrear Payments');
            $table->decimal('arrears_pf', 12, 2)->default(0)->after('arrears')->comment('PF on Arrears');
            
            // Leave Encashment
            $table->decimal('leave_encashment', 12, 2)->default(0)->after('arrears_pf')->comment('Leave Encashment');
            $table->integer('encashed_leave_days')->default(0)->after('leave_encashment');
            
            // Notice Pay
            $table->decimal('notice_pay_recovery', 12, 2)->default(0)->after('encashed_leave_days')->comment('Notice Pay Recovery');
            $table->decimal('notice_pay_addition', 12, 2)->default(0)->after('notice_pay_recovery')->comment('Notice Pay Addition');
            
            // Additional Deductions
            $table->decimal('nps_employee', 12, 2)->default(0)->after('tds')->comment('NPS Employee Contribution');
            $table->decimal('vpf_employee', 12, 2)->default(0)->after('nps_employee')->comment('VPF Contribution');
            $table->decimal('lwf', 12, 2)->default(0)->after('vpf_employee')->comment('Labour Welfare Fund');
            $table->decimal('medical_insurance', 12, 2)->default(0)->after('lwf')->comment('Medical Insurance Premium');
            $table->decimal('life_insurance', 12, 2)->default(0)->after('medical_insurance')->comment('Life Insurance Premium');
            
            // Employer Contributions
            $table->decimal('nps_employer', 12, 2)->default(0)->after('gratuity')->comment('NPS Employer Contribution');
            $table->decimal('superannuation', 12, 2)->default(0)->after('nps_employer')->comment('Superannuation');
            $table->decimal('medical_insurance_employer', 12, 2)->default(0)->after('superannuation')->comment('Medical Insurance Employer');
            
            // Shift & Attendance
            $table->decimal('shift_differential', 12, 2)->default(0)->after('overtime_pay')->comment('Shift Differential Pay');
            $table->integer('night_shift_hours')->default(0)->after('shift_differential');
            $table->integer('weekend_hours')->default(0)->after('night_shift_hours');
            
            // Tracking fields
            $table->boolean('is_full_and_final')->default(false)->after('total_employer_contributions')->comment('Is F&F Settlement');
            $table->string('settlement_type', 20)->nullable()->after('is_full_and_final')->comment('regular, fnf, arrears');
            $table->json('additional_components')->nullable()->after('template_snapshot')->comment('Dynamic components');
        });

        // Add columns to payroll_monthly_runs
        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            $table->decimal('total_arrears', 15, 2)->default(0)->after('total_tds')->comment('Total Arrears');
            $table->decimal('total_variable_pay', 15, 2)->default(0)->after('total_arrears')->comment('Total Variable Pay');
            $table->decimal('total_leave_encashment', 15, 2)->default(0)->after('total_variable_pay')->comment('Total Leave Encashment');
            $table->decimal('total_nps', 15, 2)->default(0)->after('total_leave_encashment')->comment('Total NPS');
            $table->decimal('total_vpf', 15, 2)->default(0)->after('total_nps')->comment('Total VPF');
            $table->decimal('total_lwf', 15, 2)->default(0)->after('total_vpf')->comment('Total LWF');
            $table->boolean('is_full_and_final_run')->default(false)->after('notes')->comment('Is F&F Run');
        });
    }

    public function down(): void
    {
        Schema::table('employee_payroll_templates', function (Blueprint $table) {
            $table->dropColumn([
                'da_percentage', 'cca_amount', 'education_allowance', 'hostel_allowance',
                'internet_allowance', 'meal_allowance', 'transport_allowance', 'uniform_allowance',
                'books_periodicals', 'fuel_maintenance', 'nps_enabled', 'nps_employee_percentage',
                'vpf_enabled', 'vpf_percentage', 'component_settings'
            ]);
        });

        Schema::table('payroll_items', function (Blueprint $table) {
            $table->dropColumn([
                'da', 'cca', 'education', 'hostel', 'internet', 'meal', 'transport', 'uniform',
                'books_periodicals_amount', 'fuel_maintenance', 'variable_pay', 'performance_bonus',
                'retention_bonus', 'arrears', 'arrears_pf', 'leave_encashment', 'encashed_leave_days',
                'notice_pay_recovery', 'notice_pay_addition', 'nps_employee', 'vpf_employee', 'lwf',
                'medical_insurance', 'life_insurance', 'nps_employer', 'superannuation',
                'medical_insurance_employer', 'shift_differential', 'night_shift_hours', 'weekend_hours',
                'is_full_and_final', 'settlement_type', 'additional_components'
            ]);
        });

        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            $table->dropColumn([
                'total_arrears', 'total_variable_pay', 'total_leave_encashment', 'total_nps',
                'total_vpf', 'total_lwf', 'is_full_and_final_run'
            ]);
        });
    }
};
