<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Progress fields for backgrounded filing generation.
 *
 * Deliberately the same shape as the `processing_*` columns added alongside the
 * run-processing job, so both are read through one prefix-parameterised payload
 * helper rather than two near-identical ones.
 *
 * A generic `background_tasks` table was the obvious alternative. It was not
 * taken because it would have meant retrofitting the just-shipped, money-critical
 * run-processing path for symmetry alone, and because both of these genuinely are
 * states of a run — a run is being processed, a run's filings are being
 * generated. If a third case appears that is *not* per-run, that is the moment
 * to generalise.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            // idle | queued | running | completed | failed
            $table->string('filings_state', 20)->default('idle');
            $table->unsignedInteger('filings_total')->default(0);
            $table->unsignedInteger('filings_done')->default(0);
            $table->unsignedInteger('filings_failed')->default(0);
            $table->unsignedInteger('filings_skipped')->default(0);
            $table->timestamp('filings_started_at')->nullable();
            $table->timestamp('filings_finished_at')->nullable();
            $table->text('filings_message')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            $table->dropColumn([
                'filings_state',
                'filings_total',
                'filings_done',
                'filings_failed',
                'filings_skipped',
                'filings_started_at',
                'filings_finished_at',
                'filings_message',
            ]);
        });
    }
};
