<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Form 16 Generation
        Schema::create('form16_documents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            
            // Financial Year
            $table->string('financial_year', 9)->comment('YYYY-YY format');
            $table->string('assessment_year', 9)->comment('YYYY-YY format');
            
            // Part A (Employer Details from TRACES)
            $table->string('tan_number', 10)->nullable();
            $table->string('pan_deductor', 10)->nullable();
            $table->string('pan_employee', 10)->nullable();
            $table->string('assessment_year_part_a', 9)->nullable();
            $table->string('period_from', 10)->nullable()->comment('DD/MM/YYYY');
            $table->string('period_to', 10)->nullable()->comment('DD/MM/YYYY');
            
            // Summary of Tax Deducted
            $table->decimal('total_gross', 12, 2)->default(0);
            $table->decimal('total_chapter6', 12, 2)->default(0)->comment('80C, 80CCC, etc.');
            $table->decimal('total_taxable', 12, 2)->default(0);
            $table->decimal('total_tds', 12, 2)->default(0);
            
            // Quarterly Breakdown
            $table->json('quarterly_breakdown')->nullable();
            
            // Part B (Employee Details & Salary)
            $table->json('salary_details')->nullable()->comment('Gross, 80C exemptions, etc.');
            $table->json('other_income')->nullable();
            $table->json('deductions_under_chapter6')->nullable();
            $table->json('tax_computation')->nullable();
            
            // Document Details
            $table->string('file_path')->nullable();
            $table->string('file_name')->nullable();
            $table->string('verification_code', 10)->nullable();
            $table->enum('status', ['draft', 'generated', 'submitted', 'accepted'])->default('draft');
            
            // TRACES Integration
            $table->timestamp('traces_downloaded_at')->nullable();
            $table->json('traces_data')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->unique(['user_id', 'financial_year'], 'form16_user_year_unique');
            $table->index(['organization_id', 'financial_year'], 'form16_org_year_idx');
        });

        // Form 24Q (TDS Return)
        Schema::create('form24q_returns', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            
            // Return Details
            $table->string('financial_year', 9);
            $table->enum('quarter', ['Q1', 'Q2', 'Q3', 'Q4']);
            $table->enum('return_type', ['regular', 'correction', 'revised'])->default('regular');
            $table->string('receipt_number', 20)->nullable()->comment('Generated after filing');
            
            // Employer Details
            $table->string('tan_number', 10);
            $table->string('pan_deductor', 10);
            $table->string('assessee_type', 10)->default(' Govt'); // Govt, Private, etc.
            
            // Summary
            $table->integer('total_employees')->default(0);
            $table->decimal('total_salary_paid', 15, 2)->default(0);
            $table->decimal('total_tds_deducted', 15, 2)->default(0);
            $table->decimal('total_tds_deposited', 15, 2)->default(0);
            
            // Challan Details
            $table->json('challan_details')->nullable();
            
            // Annexures
            $table->json('annexure_i')->nullable()->comment('Salary details');
            $table->json('annexure_ii')->nullable()->comment('New joinees');
            
            // Filing Status
            $table->enum('status', ['draft', 'ready', 'filed', 'accepted', 'rejected'])->default('draft');
            $table->string('acknowledgment_number')->nullable();
            $table->timestamp('filed_at')->nullable();
            $table->string('token_number')->nullable();
            $table->text('rejection_reason')->nullable();
            $table->json('filed_data')->nullable();
            
            // File Storage
            $table->string('file_path')->nullable();
            $table->string('validation_report_path')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->unique(['organization_id', 'financial_year', 'quarter'], 'form24q_unique_return');
            $table->index(['status'], 'form24q_status_idx');
        });

        // PF/ESI Challans
        Schema::create('compliance_challans', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            
            // Challan Details
            $table->enum('challan_type', ['pf_monthly', 'pf_ecr', 'esi_monthly', 'pt_monthly', 'lwf_monthly']);
            $table->string('month_year', 7)->comment('YYYY-MM');
            $table->string('challan_number', 50)->nullable();
            $table->date('challan_date')->nullable();
            
            // Employer Details
            $table->string('establishment_code')->nullable();
            $table->string('epf_code', 20)->nullable();
            $table->string('esi_code', 20)->nullable();
            
            // Contribution Summary
            $table->integer('total_employees')->default(0);
            $table->decimal('total_wages', 15, 2)->default(0);
            $table->decimal('employee_contribution', 15, 2)->default(0);
            $table->decimal('employer_contribution', 15, 2)->default(0);
            $table->decimal('total_contribution', 15, 2)->default(0);
            $table->decimal('admin_charges', 15, 2)->default(0);
            $table->decimal('interest', 15, 2)->default(0);
            $table->decimal('damages', 15, 2)->default(0);
            
            // Payment Details
            $table->decimal('total_amount', 15, 2)->default(0);
            $table->enum('payment_status', ['pending', 'paid', 'failed'])->default('pending');
            $table->string('payment_method')->nullable();
            $table->string('transaction_id')->nullable();
            $table->timestamp('paid_at')->nullable();
            
            // Status
            $table->enum('status', ['draft', 'generated', 'validated', 'filed', 'paid'])->default('draft');
            
            // Files
            $table->string('challan_file_path')->nullable();
            $table->string('receipt_file_path')->nullable();
            $table->json('employee_details')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->unique(['organization_id', 'challan_type', 'month_year'], 'challan_unique');
            $table->index(['status'], 'challan_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('compliance_challans');
        Schema::dropIfExists('form24q_returns');
        Schema::dropIfExists('form16_documents');
    }
};
