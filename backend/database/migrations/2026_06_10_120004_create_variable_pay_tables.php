<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('variable_pay_components', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            
            // Component Details
            $table->string('name');
            $table->string('code', 50)->unique();
            $table->enum('type', ['monthly', 'quarterly', 'annual', 'performance', 'retention', 'signing', 'referral', 'spot'])->default('monthly');
            $table->text('description')->nullable();
            
            // Calculation
            $table->enum('calculation_basis', ['fixed', 'percentage_of_basic', 'percentage_of_gross', 'percentage_of_ctc', 'custom_formula'])->default('fixed');
            $table->decimal('default_value', 12, 2)->default(0);
            $table->text('custom_formula')->nullable()->comment('For complex calculations');
            
            // Eligibility
            $table->enum('eligibility', ['all', 'department_specific', 'designation_specific', 'tenure_based', 'performance_based'])->default('all');
            $table->json('eligibility_criteria')->nullable();
            
            // Tax Treatment
            $table->boolean('is_taxable')->default(true);
            $table->boolean('is_pf_applicable')->default(false);
            $table->boolean('is_esi_applicable')->default(false);
            
            // Timing
            $table->enum('payout_month', ['current', 'next', 'april'])->default('current')->comment('When to pay this component');
            $table->integer('payout_day')->nullable()->comment('Specific day of month for payout');
            
            // Status
            $table->boolean('is_active')->default(true);
            $table->json('meta')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->index(['organization_id', 'type', 'is_active'], 'varpay_org_type_active_idx');
            $table->index(['code'], 'varpay_code_idx');
        });

        // Employee Variable Pay - Individual assignments
        Schema::create('employee_variable_pay', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('variable_pay_component_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_run_id')->nullable()->constrained('payroll_monthly_runs')->nullOnDelete();
            
            // Assignment Details
            $table->string('applicable_year', 4)->comment('YYYY');
            $table->enum('applicable_quarter', ['Q1', 'Q2', 'Q3', 'Q4', 'NA'])->default('NA');
            $table->string('applicable_month', 7)->nullable()->comment('YYYY-MM for monthly components');
            
            // Amount
            $table->decimal('target_amount', 12, 2);
            $table->decimal('achieved_percentage', 5, 2)->default(100.00);
            $table->decimal('payable_amount', 12, 2);
            
            // Performance Linkage
            $table->foreignId('performance_review_id')->nullable()->constrained()->nullOnDelete();
            $table->decimal('performance_score', 5, 2)->nullable();
            $table->json('performance_breakdown')->nullable();
            
            // Status
            $table->enum('status', ['draft', 'approved', 'processed', 'paid'])->default('draft');
            
            // Approval
            $table->foreignId('created_by')->constrained('users');
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->text('notes')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->index(['organization_id', 'user_id', 'applicable_year'], 'empvarpay_org_user_year_idx');
            $table->index(['payroll_run_id'], 'empvarpay_run_idx');
            $table->index(['status'], 'empvarpay_status_idx');
            $table->unique(['user_id', 'variable_pay_component_id', 'applicable_year', 'applicable_quarter'], 'empvarpay_unique_assignment');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_variable_pay');
        Schema::dropIfExists('variable_pay_components');
    }
};
