<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('leave_encashments')) {
            Schema::create('leave_encashments', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('payroll_run_id')->nullable()->constrained('payroll_monthly_runs')->nullOnDelete();
                $table->string('leave_type')->default('earned'); // earned, casual, sick
                $table->integer('eligible_days')->default(0);
                $table->integer('encashed_days')->default(0);
                $table->integer('balance_days')->default(0);
                $table->decimal('rate_per_day', 12, 2)->default(0);
                $table->decimal('total_amount', 12, 2)->default(0);
                $table->decimal('pf_deduction', 12, 2)->default(0);
                $table->decimal('tax_deduction', 12, 2)->default(0);
                $table->decimal('net_amount', 12, 2)->default(0);
                $table->string('status')->default('draft'); // draft, approved, rejected, paid
                $table->string('month_year')->nullable();
                $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('approved_at')->nullable();
                $table->text('rejection_reason')->nullable();
                $table->text('notes')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_encashments');
    }
};
