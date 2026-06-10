<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('arrear_payments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_run_id')->nullable()->constrained('payroll_monthly_runs')->nullOnDelete();
            
            // Arrear Details
            $table->string('arrear_month', 7)->comment('YYYY-MM for which arrear is due');
            $table->string('calculation_month', 7)->comment('YYYY-MM when arrear is paid');
            $table->enum('arrear_type', ['salary', 'increment', 'promotion', 'retrospective', 'settlement'])->default('salary');
            
            // Amount Breakdown
            $table->decimal('original_basic', 12, 2)->default(0);
            $table->decimal('revised_basic', 12, 2)->default(0);
            $table->decimal('basic_difference', 12, 2)->default(0);
            
            $table->decimal('original_gross', 12, 2)->default(0);
            $table->decimal('revised_gross', 12, 2)->default(0);
            $table->decimal('gross_difference', 12, 2)->default(0);
            
            // Statutory on Arrears
            $table->decimal('pf_on_arrear', 12, 2)->default(0);
            $table->decimal('esi_on_arrear', 12, 2)->default(0);
            $table->decimal('tds_on_arrear', 12, 2)->default(0);
            $table->decimal('pt_on_arrear', 12, 2)->default(0);
            
            $table->decimal('net_arrear_amount', 12, 2);
            
            // Status
            $table->enum('status', ['draft', 'approved', 'processed', 'rejected'])->default('draft');
            
            // Approval
            $table->text('reason')->nullable();
            $table->foreignId('requested_by')->constrained('users');
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->text('rejection_reason')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->index(['organization_id', 'user_id', 'arrear_month'], 'arrear_org_user_month_idx');
            $table->index(['payroll_run_id'], 'arrear_run_idx');
            $table->index(['status'], 'arrear_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('arrear_payments');
    }
};
