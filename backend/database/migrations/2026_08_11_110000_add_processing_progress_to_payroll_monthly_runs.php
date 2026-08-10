<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Progress fields for backgrounded run processing.
 *
 * Processing a run walks every unprocessed employee and runs a full payroll
 * calculation for each, inside the web request. That is fine for a handful of
 * people and becomes a `max_execution_time` failure part-way through a run for a
 * few hundred — the worst place to lose a request, because the run is left
 * half-populated with no record of how far it got.
 *
 * Moving the loop into a job means the HTTP response can no longer carry the
 * result, so the run has to carry it instead. These columns are what the client
 * polls while the work happens elsewhere.
 *
 * `processing_state` is deliberately not an enum: adding a state should not
 * require a migration, and Postgres enum changes are awkward.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            // idle | queued | running | completed | failed
            $table->string('processing_state', 20)->default('idle');
            $table->unsignedInteger('processing_total')->default(0);
            $table->unsignedInteger('processing_done')->default(0);
            $table->unsignedInteger('processing_failed')->default(0);
            $table->unsignedInteger('processing_skipped')->default(0);
            $table->timestamp('processing_started_at')->nullable();
            $table->timestamp('processing_finished_at')->nullable();
            $table->text('processing_message')->nullable();
        });
    }

    public function down(): void
    {
        Schema::table('payroll_monthly_runs', function (Blueprint $table) {
            $table->dropColumn([
                'processing_state',
                'processing_total',
                'processing_done',
                'processing_failed',
                'processing_skipped',
                'processing_started_at',
                'processing_finished_at',
                'processing_message',
            ]);
        });
    }
};
