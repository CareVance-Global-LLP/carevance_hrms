<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leave_encashments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_run_id')->nullable()->constrained('payroll_monthly_runs')->nullOnDelete();
            
            // Leave Details
            $table->enum('leave_type', ['earned', 'casual', 'sick', 'compensatory'])->default('earned');
            $table->integer('eligible_days');
            $table->integer('encashed_days');
            $table->integer('balance_days')->default(0);
            
            // Financial Details
            $table->decimal('rate_per_day', 12, 2);
            $table->decimal('total_amount', 12, 2);
            $table->decimal('pf_deduction', 12, 2)->default(0)->comment('PF on encashment if applicable');
            $table->decimal('tax_deduction', 12, 2)->default(0)->comment('TDS if applicable');
            $table->decimal('net_amount', 12, 2);
            
            // Status
            $table->enum('status', ['draft', 'approved', 'processed', 'rejected'])->default('draft');
            $table->string('month_year', 7)->nullable()->comment('YYYY-MM when processed');
            
            // Approval
            $table->foreignId('requested_by')->constrained('users');
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->text('rejection_reason')->nullable();
            $table->text('notes')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->index(['organization_id', 'user_id', 'status'], 'leave_enc_org_user_status_idx');
            $table->index(['payroll_run_id'], 'leave_enc_run_idx');
            $table->index(['month_year'], 'leave_enc_month_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_encashments');
    }
};
