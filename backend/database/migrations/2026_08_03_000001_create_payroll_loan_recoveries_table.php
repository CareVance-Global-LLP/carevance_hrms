<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Ledger of loan/advance EMI recoveries taken through payroll.
 *
 * Recovery used to be *inferred* from `payroll_items.custom_deductions > 0`,
 * but that column also holds wizard-submitted deductions. Any employee with an
 * unrelated custom deduction therefore looked like they had already had their
 * EMI taken: the EMI kept being charged on the payslip while
 * `employee_loans.remaining_amount` was never decremented, so the loan was
 * recovered forever and never closed.
 *
 * Recording the recovery explicitly, with a unique key per (run, loan), makes
 * the operation idempotent — re-processing an employee, or retrying a job,
 * cannot double-decrement.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payroll_loan_recoveries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_run_id')->constrained('payroll_monthly_runs')->cascadeOnDelete();
            $table->foreignId('employee_loan_id')->constrained('employee_loans')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->decimal('amount', 12, 2)->default(0);
            $table->timestamp('recovered_at')->nullable();
            $table->timestamps();

            // One recovery per loan per run — this is what makes re-processing
            // and job retries safe.
            $table->unique(['payroll_run_id', 'employee_loan_id'], 'payroll_loan_recovery_unique');
            $table->index(['organization_id', 'user_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_loan_recoveries');
    }
};
