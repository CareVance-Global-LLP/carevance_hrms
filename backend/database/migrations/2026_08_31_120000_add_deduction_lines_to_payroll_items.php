<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * What the deductions on a payslip were FOR.
 *
 * `payroll_items` carried three deduction columns — `lOP_deduction`,
 * `custom_deductions` and `total_deductions` — and only the first of those
 * names what it is. An employee with a loan and a salary advance had
 * `custom_deductions = 14000.00` stored against their month and no way, from
 * the payslip, to learn that it was 8,000 of one and 6,000 of the other.
 *
 * `custom_deductions` is also not purely loans: wizard-entered deductions land
 * in the same total, so it cannot be decomposed after the fact even by
 * inference. The breakdown existed only in the process response and was thrown
 * away the moment the request ended.
 *
 * Nullable, because every row written before this migration genuinely has no
 * breakdown — and a payslip that says nothing is more honest than one that
 * invents a single line from a total it cannot decompose.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_items', function (Blueprint $table) {
            $table->json('deduction_lines')->nullable()->after('custom_deductions');
        });
    }

    public function down(): void
    {
        Schema::table('payroll_items', function (Blueprint $table) {
            $table->dropColumn('deduction_lines');
        });
    }
};
