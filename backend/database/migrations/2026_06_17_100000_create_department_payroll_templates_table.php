<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('department_payroll_templates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('department_id')->constrained('groups')->cascadeOnDelete();

            $table->decimal('default_annual_ctc', 12, 2)->default(0);

            $table->decimal('basic_percentage', 5, 2)->default(40.00);
            $table->decimal('hra_percentage', 5, 2)->default(50.00);
            $table->decimal('da_percentage', 5, 2)->default(0);
            $table->decimal('conveyance_allowance', 10, 2)->default(1600.00);
            $table->decimal('medical_allowance', 10, 2)->default(0);
            $table->decimal('special_allowance', 10, 2)->default(0);

            $table->boolean('pf_enabled')->default(true);
            $table->boolean('esi_enabled')->default(true);
            $table->boolean('pt_enabled')->default(true);
            $table->boolean('tds_enabled')->default(true);
            $table->boolean('lwf_enabled')->default(false);
            $table->boolean('nps_enabled')->default(false);
            $table->boolean('vpf_enabled')->default(false);

            $table->decimal('pf_employee_percentage', 5, 2)->default(12.00);
            $table->decimal('pf_employer_percentage', 5, 2)->default(12.00);
            $table->decimal('pf_wage_cap', 10, 2)->default(15000.00);
            $table->boolean('pf_above_cap')->default(false);
            $table->decimal('esi_employee_percentage', 5, 2)->default(0.75);
            $table->decimal('esi_employer_percentage', 5, 2)->default(3.25);
            $table->decimal('esi_threshold', 10, 2)->default(21000.00);

            $table->string('pt_state', 64)->default('maharashtra');
            $table->string('tax_regime', 16)->default('new');
            $table->boolean('is_metro_city')->default(true);

            $table->json('component_settings')->nullable();
            $table->json('custom_earnings')->nullable();
            $table->json('custom_deductions')->nullable();

            $table->boolean('is_active')->default(true);

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('updated_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            $table->unique(['organization_id', 'department_id'], 'dept_payroll_templates_org_dept_unique');
            $table->index(['organization_id', 'is_active'], 'dept_payroll_templates_org_active_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('department_payroll_templates');
    }
};
