<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Employee Payroll Templates - Customizable per employee
        if (!Schema::hasTable('employee_payroll_templates')) {
            Schema::create('employee_payroll_templates', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                
                // Earnings Configuration
                $table->decimal('basic_percentage', 5, 2)->default(40.00)->comment('Basic as % of CTC');
                $table->decimal('hra_percentage', 5, 2)->default(50.00)->comment('HRA as % of Basic');
                $table->decimal('conveyance_allowance', 10, 2)->default(1600.00);
                $table->decimal('medical_allowance', 10, 2)->default(0);
                $table->decimal('special_allowance', 10, 2)->default(0);
                
                // Deductions Enable/Disable
                $table->boolean('pf_enabled')->default(true);
                $table->boolean('esi_enabled')->default(true);
                $table->boolean('pt_enabled')->default(true);
                $table->boolean('tds_enabled')->default(true);
                $table->boolean('lwf_enabled')->default(false);
                
                // PF Configuration
                $table->decimal('pf_employee_percentage', 5, 2)->default(12.00);
                $table->decimal('pf_employer_percentage', 5, 2)->default(12.00);
                $table->decimal('pf_wage_cap', 10, 2)->default(15000.00);
                $table->boolean('pf_above_cap')->default(false)->comment('Opt-in for PF above wage cap');
                
                // ESI Configuration
                $table->decimal('esi_employee_percentage', 5, 2)->default(0.75);
                $table->decimal('esi_employer_percentage', 5, 2)->default(3.25);
                $table->decimal('esi_threshold', 10, 2)->default(21000.00);
                
                // PT Configuration
                $table->string('pt_state', 50)->nullable();
                
                // Tax Configuration
                $table->enum('tax_regime', ['new', 'old'])->default('new');
                $table->boolean('is_metro_city')->default(true);
                
                // Additional Components
                $table->json('custom_earnings')->nullable()->comment('Custom earning components');
                $table->json('custom_deductions')->nullable()->comment('Custom deduction components');
                
                // Metadata
                $table->boolean('is_active')->default(true);
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamps();
                
                $table->unique(['organization_id', 'user_id'], 'emp_payroll_templates_org_user_unique');
            });
        }

        // Payroll Runs - Monthly payroll processing
        if (!Schema::hasTable('payroll_monthly_runs')) {
            Schema::create('payroll_monthly_runs', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('month_year', 7)->comment('YYYY-MM format');
                $table->string('status', 30)->default('draft')->comment('draft, processing, processed, paid, locked');
                $table->date('pay_date')->nullable();
                
                // Summary Fields
                $table->integer('total_employees')->default(0);
                $table->decimal('total_gross', 15, 2)->default(0);
                $table->decimal('total_deductions', 15, 2)->default(0);
                $table->decimal('total_net_pay', 15, 2)->default(0);
                $table->decimal('total_employer_contributions', 15, 2)->default(0);
                
                // Breakdown
                $table->decimal('total_pf_employee', 15, 2)->default(0);
                $table->decimal('total_pf_employer', 15, 2)->default(0);
                $table->decimal('total_esi_employee', 15, 2)->default(0);
                $table->decimal('total_esi_employer', 15, 2)->default(0);
                $table->decimal('total_pt', 15, 2)->default(0);
                $table->decimal('total_tds', 15, 2)->default(0);
                
                // Audit
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('approved_at')->nullable();
                $table->text('notes')->nullable();
                $table->timestamps();
                
                $table->unique(['organization_id', 'month_year'], 'payroll_runs_org_month_unique');
                $table->index(['organization_id', 'status'], 'payroll_runs_org_status_idx');
            });
        }

        // Payroll Items - Individual employee payroll per month
        if (!Schema::hasTable('payroll_items')) {
            Schema::create('payroll_items', function (Blueprint $table) {
                $table->id();
                $table->foreignId('payroll_run_id')->constrained('payroll_monthly_runs')->cascadeOnDelete();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('department_id')->nullable()->constrained('groups')->nullOnDelete();
                
                // Time Tracking Integration
                $table->integer('total_working_days')->default(0);
                $table->integer('days_present')->default(0);
                $table->integer('days_absent')->default(0);
                $table->integer('days_leave')->default(0);
                $table->decimal('lOP_days', 5, 2)->default(0);
                
                // Time Tracking (from TimeTracker if integrated)
                $table->integer('total_worked_seconds')->default(0)->comment('From time_entries');
                $table->integer('total_productive_seconds')->default(0);
                $table->integer('total_idle_seconds')->default(0);
                $table->integer('total_unproductive_seconds')->default(0);
                $table->decimal('activity_percentage', 5, 2)->default(0);
                $table->decimal('productivity_score', 5, 2)->default(0);
                
                // Overtime
                $table->integer('overtime_seconds')->default(0);
                $table->decimal('overtime_pay', 12, 2)->default(0);
                
                // Earnings
                $table->decimal('basic', 12, 2)->default(0);
                $table->decimal('hra', 12, 2)->default(0);
                $table->decimal('conveyance', 12, 2)->default(0);
                $table->decimal('medical', 12, 2)->default(0);
                $table->decimal('special_allowance', 12, 2)->default(0);
                $table->decimal('custom_earnings', 12, 2)->default(0);
                $table->decimal('gross_salary', 12, 2)->default(0);
                
                // Deductions
                $table->decimal('pf_employee', 12, 2)->default(0);
                $table->decimal('esi_employee', 12, 2)->default(0);
                $table->decimal('pt', 12, 2)->default(0);
                $table->decimal('tds', 12, 2)->default(0);
                $table->decimal('lOP_deduction', 12, 2)->default(0);
                $table->decimal('custom_deductions', 12, 2)->default(0);
                $table->decimal('total_deductions', 12, 2)->default(0);
                
                // Employer Contributions
                $table->decimal('pf_employer', 12, 2)->default(0);
                $table->decimal('eps', 12, 2)->default(0);
                $table->decimal('epf', 12, 2)->default(0);
                $table->decimal('esi_employer', 12, 2)->default(0);
                $table->decimal('gratuity', 12, 2)->default(0);
                $table->decimal('total_employer_contributions', 12, 2)->default(0);
                
                // Net Pay
                $table->decimal('net_pay', 12, 2)->default(0);
                
                // Status
                $table->string('payment_status', 30)->default('pending')->comment('pending, processing, paid, failed');
                $table->string('payment_method', 30)->nullable()->comment('bank_transfer, razorpay, cash');
                $table->string('payment_reference')->nullable();
                $table->timestamp('paid_at')->nullable();
                
                // Configuration Snapshot
                $table->json('template_snapshot')->nullable()->comment('Snapshot of payroll template used');
                
                $table->timestamps();
                
                $table->unique(['payroll_run_id', 'user_id'], 'payroll_items_run_user_unique');
                $table->index(['organization_id', 'department_id'], 'payroll_items_org_dept_idx');
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_items');
        Schema::dropIfExists('payroll_monthly_runs');
        Schema::dropIfExists('employee_payroll_templates');
    }
};
