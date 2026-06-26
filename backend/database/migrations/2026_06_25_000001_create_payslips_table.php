<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Payslip master record
        Schema::create('payslips', function (Blueprint $table) {
            $table->id();
            $table->foreignId('pay_group_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('employee_id')->constrained('employees')->cascadeOnDelete();
            $table->unsignedTinyInteger('pay_month'); // 1-12
            $table->unsignedSmallInteger('pay_year');  // 2026
            $table->string('payslip_number', 50)->unique();
            $table->enum('status', ['draft', 'generated', 'downloaded', 'sent'])->default('draft');

            // Attendance
            $table->decimal('total_days', 5, 1)->default(0);
            $table->decimal('days_present', 5, 1)->default(0);
            $table->decimal('paid_leave', 5, 1)->default(0);
            $table->decimal('lop_days', 5, 1)->default(0);
            $table->unsignedTinyInteger('half_days')->default(0);
            $table->decimal('overtime_hours', 5, 1)->default(0);

            // Earnings & Deductions (JSON)
            $table->json('earnings')->nullable();
            $table->decimal('total_earnings', 12, 2)->default(0);
            $table->json('deductions')->nullable();
            $table->decimal('total_deductions', 12, 2)->default(0);

            // Net
            $table->decimal('net_payable', 12, 2)->default(0);
            $table->text('net_pay_words')->nullable();

            // Statutory breakdown
            $table->decimal('pf_ee', 12, 2)->default(0);
            $table->decimal('pf_er', 12, 2)->default(0);
            $table->decimal('edli', 12, 2)->default(0);
            $table->decimal('admin_charges', 12, 2)->default(0);
            $table->decimal('esi_ee', 12, 2)->default(0);
            $table->decimal('esi_er', 12, 2)->default(0);
            $table->decimal('pt_amount', 12, 2)->default(0);
            $table->decimal('lwf_ee', 12, 2)->default(0);
            $table->decimal('lwf_er', 12, 2)->default(0);
            $table->decimal('tds', 12, 2)->default(0);
            $table->decimal('loan_emi', 12, 2)->default(0);
            $table->decimal('advance_recovery', 12, 2)->default(0);
            $table->decimal('late_penalty', 12, 2)->default(0);

            // Employer contribution
            $table->json('employer_contribution')->nullable();
            $table->decimal('total_employer_contribution', 12, 2)->default(0);

            // YTD tracking
            $table->decimal('ytd_gross', 12, 2)->default(0);
            $table->decimal('ytd_deductions', 12, 2)->default(0);
            $table->decimal('ytd_net', 12, 2)->default(0);
            $table->decimal('ytd_pf_ee', 12, 2)->default(0);
            $table->decimal('ytd_esi_ee', 12, 2)->default(0);
            $table->decimal('ytd_pt', 12, 2)->default(0);
            $table->decimal('ytd_lwf', 12, 2)->default(0);

            // PDF
            $table->string('pdf_path', 500)->nullable();
            $table->timestamp('pdf_generated_at')->nullable();

            $table->timestamps();

            $table->unique(['employee_id', 'pay_month', 'pay_year'], 'unique_payslip');
            $table->index(['pay_group_id', 'pay_month', 'pay_year'], 'payslip_group_month_idx');
        });

        // Monthly YTD history
        Schema::create('payslip_ytd_history', function (Blueprint $table) {
            $table->id();
            $table->foreignId('employee_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('pay_month');
            $table->unsignedSmallInteger('pay_year');
            $table->decimal('gross', 12, 2)->default(0);
            $table->decimal('deductions', 12, 2)->default(0);
            $table->decimal('net', 12, 2)->default(0);
            $table->decimal('pf_ee', 12, 2)->default(0);
            $table->decimal('esi_ee', 12, 2)->default(0);
            $table->decimal('pt', 12, 2)->default(0);
            $table->decimal('lwf', 12, 2)->default(0);
            $table->timestamps();

            $table->unique(['employee_id', 'pay_month', 'pay_year'], 'unique_ytd');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payslip_ytd_history');
        Schema::dropIfExists('payslips');
    }
};
