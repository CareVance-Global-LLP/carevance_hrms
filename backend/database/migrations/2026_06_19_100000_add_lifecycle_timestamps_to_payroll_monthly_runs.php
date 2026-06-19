<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds lifecycle audit timestamps + actor columns to `payroll_monthly_runs`.
 *
 * Background:
 *   - For the "perfect payroll flow" we want every lifecycle transition
 *     (locked, approved, released, disbursed) to record WHO did it and WHEN.
 *   - `approved_by` and `approved_at` already exist from earlier work.
 *   - This migration adds the missing four columns:
 *       - `locked_at`    — when run was locked (no more edits)
 *       - `locked_by`    — user who locked
 *       - `released_at`  — when bank file was generated/uploaded
 *       - `released_by`  — user who released
 *       - `disbursed_at` — when run transitioned to terminal disbursed state
 *       - `disbursed_by` — user who disbursed
 *       - `lock_reason`  — optional reason when run was locked partially
 *
 * Idempotent via Schema::hasColumn guards so this migration is safe to re-run.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            if (! Schema::hasColumn('payroll_monthly_runs', 'locked_at')) {
                $table->timestamp('locked_at')->nullable()->after('approved_at');
            }
            if (! Schema::hasColumn('payroll_monthly_runs', 'locked_by')) {
                $table->unsignedBigInteger('locked_by')->nullable()->after('locked_at');
            }
            if (! Schema::hasColumn('payroll_monthly_runs', 'lock_reason')) {
                $table->text('lock_reason')->nullable()->after('locked_by');
            }
            if (! Schema::hasColumn('payroll_monthly_runs', 'released_at')) {
                $table->timestamp('released_at')->nullable()->after('lock_reason');
            }
            if (! Schema::hasColumn('payroll_monthly_runs', 'released_by')) {
                $table->unsignedBigInteger('released_by')->nullable()->after('released_at');
            }
            if (! Schema::hasColumn('payroll_monthly_runs', 'disbursed_at')) {
                $table->timestamp('disbursed_at')->nullable()->after('released_by');
            }
            if (! Schema::hasColumn('payroll_monthly_runs', 'disbursed_by')) {
                $table->unsignedBigInteger('disbursed_by')->nullable()->after('disbursed_at');
            }
        });
    }

    public function down(): void
    {
        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            foreach (['locked_at', 'locked_by', 'lock_reason', 'released_at', 'released_by', 'disbursed_at', 'disbursed_by'] as $col) {
                if (Schema::hasColumn('payroll_monthly_runs', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
