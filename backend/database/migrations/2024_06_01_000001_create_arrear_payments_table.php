<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('arrear_payments')) {
            Schema::create('arrear_payments', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('payroll_run_id')->nullable()->constrained('payroll_monthly_runs')->nullOnDelete();
                $table->string('arrear_month'); // e.g. 2024-06
                $table->string('calculation_month')->nullable();
                $table->string('arrear_type')->default('salary'); // salary, increment, promotion, retrospective
                $table->decimal('original_basic', 12, 2)->default(0);
                $table->decimal('revised_basic', 12, 2)->default(0);
                $table->decimal('basic_difference', 12, 2)->default(0);
                $table->decimal('original_gross', 12, 2)->default(0);
                $table->decimal('revised_gross', 12, 2)->default(0);
                $table->decimal('gross_difference', 12, 2)->default(0);
                $table->decimal('pf_on_arrear', 12, 2)->default(0);
                $table->decimal('esi_on_arrear', 12, 2)->default(0);
                $table->decimal('tds_on_arrear', 12, 2)->default(0);
                $table->decimal('pt_on_arrear', 12, 2)->default(0);
                $table->decimal('net_arrear_amount', 12, 2)->default(0);
                $table->string('status')->default('draft'); // draft, approved, rejected, paid
                $table->text('reason')->nullable();
                $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('approved_at')->nullable();
                $table->text('rejection_reason')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('arrear_payments');
    }
};
