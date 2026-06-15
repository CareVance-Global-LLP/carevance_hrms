<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_checklist_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('category'); // employee_data, attendance, declarations, compliance, bank_details
            $table->string('check_code')->unique();
            $table->string('label');
            $table->text('description')->nullable();
            $table->string('severity')->default('error'); // error, warning
            $table->string('affected_entity')->nullable(); // user, payroll_item
            $table->integer('sort_order')->default(0);
            $table->boolean('is_auto_resolvable')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('payroll_run_checklists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_run_id')->constrained('payroll_monthly_runs')->cascadeOnDelete();
            $table->foreignId('checklist_item_id')->constrained('payroll_checklist_items')->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('status')->default('pending'); // pending, passed, warning, failed
            $table->text('message')->nullable();
            $table->text('resolution')->nullable();
            $table->boolean('is_resolved')->default(false);
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamps();

            $table->index(['payroll_run_id', 'status']);
            $table->index(['organization_id', 'status']);
        });

        Schema::create('stop_payment_flags', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('month_year');
            $table->string('reason')->nullable();
            $table->foreignId('raised_by')->constrained('users')->cascadeOnDelete();
            $table->boolean('is_active')->default(true);
            $table->timestamp('resolved_at')->nullable();
            $table->foreignId('resolved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['user_id', 'month_year']);
            $table->index(['organization_id', 'month_year', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('stop_payment_flags');
        Schema::dropIfExists('payroll_run_checklists');
        Schema::dropIfExists('payroll_checklist_items');
    }
};
