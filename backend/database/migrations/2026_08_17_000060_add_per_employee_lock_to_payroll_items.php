<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Per-employee locking, and payslip publication decoupled from it.
 *
 * A 200-person run always has three exceptions. Until now the only lock was the
 * run's own status, so those three held the other 197: either everybody was
 * locked or nobody was.
 *
 * greytHR has the better tier model and Keka has the better input discipline,
 * so the design takes both halves. The four tiers, from the outside in:
 *
 *   1. INPUTS LOCK    — PayrollPeriodGuard, already built and wired into
 *                       attendance regularisation, attendance sync and leave
 *                       approval. Keka's contribution: a late input should be
 *                       structurally impossible, not merely detectable.
 *   2. MONTH LOCK     — payroll_monthly_runs.status, already exists.
 *   3. PER-EMPLOYEE   — this migration. Lock 197, keep working on 3.
 *   4. PAYSLIP PUBLISH— also this migration, and deliberately NOT the same
 *                       thing as being locked. Publishing is what the employee
 *                       sees; locking is whether the figure can still move.
 *                       Tying them means either publishing figures still under
 *                       correction, or withholding 197 correct payslips
 *                       because 3 are disputed.
 *
 * Keka's own documentation shows per-employee rollback as the workaround for
 * having only a single month lock, which is the clearest evidence that one lock
 * is not enough in practice.
 *
 * Guarded throughout — the schema has drifted from the migrations before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('payroll_items')) {
            return;
        }

        Schema::table('payroll_items', function (Blueprint $table) {
            if (! Schema::hasColumn('payroll_items', 'locked_at')) {
                // Tier 3. Null means this employee is still open even if the
                // run around them is not.
                $table->timestamp('locked_at')->nullable();
            }

            if (! Schema::hasColumn('payroll_items', 'locked_by')) {
                $table->unsignedBigInteger('locked_by')->nullable();
            }

            if (! Schema::hasColumn('payroll_items', 'payslip_published_at')) {
                // Tier 4, independent of tier 3 on purpose.
                $table->timestamp('payslip_published_at')->nullable();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('payroll_items')) {
            return;
        }

        Schema::table('payroll_items', function (Blueprint $table) {
            foreach (['locked_at', 'locked_by', 'payslip_published_at'] as $column) {
                if (Schema::hasColumn('payroll_items', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
