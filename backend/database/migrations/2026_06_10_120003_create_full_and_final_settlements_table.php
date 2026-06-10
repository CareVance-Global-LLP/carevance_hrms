<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('full_and_final_settlements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_run_id')->nullable()->constrained('payroll_monthly_runs')->nullOnDelete();
            
            // Exit Details
            $table->date('resignation_date');
            $table->date('last_working_date');
            $table->date('settlement_date');
            $table->enum('exit_type', ['resignation', 'termination', 'retirement', 'death', 'layoff'])->default('resignation');
            $table->text('exit_reason')->nullable();
            
            // Notice Period
            $table->integer('notice_period_days')->default(30);
            $table->integer('served_days')->default(0);
            $table->integer('shortfall_days')->default(0);
            $table->decimal('notice_pay_recovery', 12, 2)->default(0);
            $table->decimal('notice_pay_payable', 12, 2)->default(0);
            
            // Salary Components
            $table->decimal('basic_salary', 12, 2);
            $table->decimal('current_month_salary', 12, 2)->default(0)->comment('Salary for current month till LWD');
            $table->decimal('salary_in_arrears', 12, 2)->default(0);
            
            // Leave & Comp-off
            $table->integer('earned_leave_balance')->default(0);
            $table->decimal('leave_encashment', 12, 2)->default(0);
            $table->integer('comp_off_balance')->default(0);
            $table->decimal('comp_off_value', 12, 2)->default(0);
            
            // Gratuity
            $table->decimal('years_of_service', 5, 2);
            $table->decimal('gratuity_amount', 12, 2)->default(0);
            $table->boolean('is_gratuity_eligible')->default(false);
            
            // Retrenchment/Compensation
            $table->decimal('retrenchment_compensation', 12, 2)->default(0);
            $table->decimal('severance_package', 12, 2)->default(0);
            
            // Outstanding Recoveries
            $table->decimal('loan_recovery', 12, 2)->default(0);
            $table->decimal('advance_recovery', 12, 2)->default(0);
            $table->decimal('asset_recovery', 12, 2)->default(0);
            $table->decimal('other_deductions', 12, 2)->default(0);
            $table->json('deduction_breakdown')->nullable();
            
            // Total Calculation
            $table->decimal('total_earnings', 12, 2)->default(0);
            $table->decimal('total_deductions', 12, 2)->default(0);
            $table->decimal('net_settlement_amount', 12, 2)->default(0);
            
            // Tax
            $table->decimal('tds_on_settlement', 12, 2)->default(0);
            $table->boolean('is_tds_applicable')->default(true);
            
            // Status & Approval
            $table->enum('status', ['draft', 'pending', 'approved', 'rejected', 'processed', 'paid'])->default('draft');
            $table->foreignId('prepared_by')->constrained('users');
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->text('rejection_reason')->nullable();
            $table->text('notes')->nullable();
            
            // Payment Details
            $table->string('payment_method', 30)->nullable();
            $table->string('payment_reference')->nullable();
            $table->timestamp('paid_at')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->unique(['user_id'], 'fnf_user_unique');
            $table->index(['organization_id', 'status'], 'fnf_org_status_idx');
            $table->index(['settlement_date'], 'fnf_date_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('full_and_final_settlements');
    }
};
