<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('custom_report_definitions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->unique();
            $table->string('category'); // payroll_register, bank, statutory, custom
            $table->json('fields')->nullable();
            $table->json('filters')->nullable();
            $table->json('grouping')->nullable();
            $table->json('sorting')->nullable();
            $table->string('export_format')->default('csv'); // csv, xlsx, pdf
            $table->boolean('is_shared')->default(false);
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'category']);
        });

        Schema::create('gl_mapping_configs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('entity_type'); // salary_component, deduction, employer_contribution
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('gl_code')->nullable();
            $table->string('gl_name')->nullable();
            $table->string('debit_account')->nullable();
            $table->string('credit_account')->nullable();
            $table->string('cost_center')->nullable();
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'entity_type']);
        });

        Schema::create('reimbursement_payroll_links', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('reimbursement_id')->constrained('reimbursements')->cascadeOnDelete();
            $table->foreignId('payroll_item_id')->nullable()->constrained('payroll_items')->nullOnDelete();
            $table->decimal('amount', 12, 2);
            $table->string('month_year');
            $table->string('status')->default('pending'); // pending, linked, processed
            $table->timestamps();

            $table->unique(['reimbursement_id']);
            $table->index(['payroll_item_id']);
            $table->index(['organization_id', 'month_year', 'status']);
        });

        Schema::create('daily_wage_structures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->unique();
            $table->decimal('daily_wage', 10, 2);
            $table->integer('working_days_per_month')->default(26);
            $table->decimal('overtime_rate_multiplier', 4, 2)->default(2.00);
            $table->json('allowances')->nullable();
            $table->boolean('pf_applicable')->default(true);
            $table->boolean('esi_applicable')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });

        Schema::create('ctc_range_bands', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code'); // A, B, C, D
            $table->decimal('min_ctc', 12, 2)->default(0);
            $table->decimal('max_ctc', 12, 2)->default(0);
            $table->decimal('basic_percentage', 5, 2)->default(40);
            $table->decimal('hra_percentage', 5, 2)->default(50);
            $table->boolean('pf_mandatory')->default(true);
            $table->boolean('esi_mandatory')->default(false);
            $table->decimal('pf_wage_cap', 10, 2)->default(15000);
            $table->json('additional_rules')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'code']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ctc_range_bands');
        Schema::dropIfExists('daily_wage_structures');
        Schema::dropIfExists('reimbursement_payroll_links');
        Schema::dropIfExists('gl_mapping_configs');
        Schema::dropIfExists('custom_report_definitions');
    }
};
