<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('payroll_checklist_items')) {
            Schema::create('payroll_checklist_items', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('category'); // pre_payroll, statutory, compliance, data_quality
                $table->string('check_code')->unique(); // e.g. EMPLOYEE_MISSING_CTC, PF_NOT_CONFIGURED
                $table->string('label');
                $table->text('description')->nullable();
                $table->string('severity')->default('warning'); // info, warning, critical
                $table->string('affected_entity')->nullable(); // employee, pay_group, organization
                $table->integer('sort_order')->default(0);
                $table->boolean('is_auto_resolvable')->default(false);
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_checklist_items');
    }
};
