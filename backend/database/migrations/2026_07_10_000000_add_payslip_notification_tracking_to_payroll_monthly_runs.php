<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds payslip-publish notification tracking to `payroll_monthly_runs`.
 *
 * When a run is disbursed, every employee in the run is notified that their
 * payslip is ready (in-app notification + email). These columns record the
 * status of that broadcast so the UI can show "Sent / Not sent" and allow a
 * resend.
 *
 *   - payslips_notified_at    — when the last notification broadcast ran
 *   - payslips_notified_status — 'sent' | 'failed' | null (not yet sent)
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            if (! Schema::hasColumn('payroll_monthly_runs', 'payslips_notified_at')) {
                $table->timestamp('payslips_notified_at')->nullable()->after('disbursed_by');
            }
            if (! Schema::hasColumn('payroll_monthly_runs', 'payslips_notified_status')) {
                $table->string('payslips_notified_status')->nullable()->after('payslips_notified_at');
            }
            if (! Schema::hasColumn('payroll_monthly_runs', 'payslips_notified_failed_count')) {
                $table->unsignedInteger('payslips_notified_failed_count')->default(0)->after('payslips_notified_status');
            }
        });
    }

    public function down(): void
    {
        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            foreach (['payslips_notified_at', 'payslips_notified_status', 'payslips_notified_failed_count'] as $col) {
                if (Schema::hasColumn('payroll_monthly_runs', $col)) {
                    $table->dropColumn($col);
                }
            }
        });
    }
};
