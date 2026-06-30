<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('full_and_final_settlements')) {
            Schema::create('full_and_final_settlements', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('payroll_run_id')->nullable()->constrained('payroll_monthly_runs')->nullOnDelete();
                $table->date('resignation_date')->nullable();
                $table->date('last_working_date')->nullable();
                $table->date('settlement_date')->nullable();
                $table->string('exit_type')->default('resignation'); // resignation, termination, retrenchment
                $table->text('exit_reason')->nullable();
                $table->integer('notice_period_days')->default(0);
                $table->integer('served_days')->default(0);
                $table->integer('shortfall_days')->default(0);
                $table->decimal('notice_pay_recovery', 12, 2)->default(0);
                $table->decimal('notice_pay_payable', 12, 2)->default(0);
                $table->decimal('basic_salary', 12, 2)->default(0);
                $table->decimal('current_month_salary', 12, 2)->default(0);
                $table->decimal('salary_in_arrears', 12, 2)->default(0);
                $table->integer('earned_leave_balance')->default(0);
                $table->decimal('leave_encashment', 12, 2)->default(0);
                $table->integer('comp_off_balance')->default(0);
                $table->decimal('comp_off_value', 12, 2)->default(0);
                $table->decimal('years_of_service', 5, 2)->default(0);
                $table->decimal('gratuity_amount', 12, 2)->default(0);
                $table->boolean('is_gratuity_eligible')->default(false);
                $table->decimal('retrenchment_compensation', 12, 2)->default(0);
                $table->decimal('severance_package', 12, 2)->default(0);
                $table->decimal('loan_recovery', 12, 2)->default(0);
                $table->decimal('advance_recovery', 12, 2)->default(0);
                $table->decimal('asset_recovery', 12, 2)->default(0);
                $table->decimal('other_deductions', 12, 2)->default(0);
                $table->json('deduction_breakdown')->nullable();
                $table->decimal('total_earnings', 12, 2)->default(0);
                $table->decimal('total_deductions', 12, 2)->default(0);
                $table->decimal('net_settlement_amount', 12, 2)->default(0);
                $table->decimal('tds_on_settlement', 12, 2)->default(0);
                $table->boolean('is_tds_applicable')->default(false);
                $table->string('status')->default('draft'); // draft, approved, rejected, paid
                $table->foreignId('prepared_by')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('approved_at')->nullable();
                $table->text('rejection_reason')->nullable();
                $table->text('notes')->nullable();
                $table->string('payment_method')->nullable();
                $table->string('payment_reference')->nullable();
                $table->timestamp('paid_at')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('full_and_final_settlements');
    }
};
