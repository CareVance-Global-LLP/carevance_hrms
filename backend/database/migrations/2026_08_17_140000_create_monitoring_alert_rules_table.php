<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Rules that decide when a monitoring figure is worth telling somebody about.
 *
 * The reports have always been able to show that an employee tracked nothing
 * yesterday; nothing has ever said so unprompted. Every defect found on
 * 17 Aug 2026 — a capped analytics query, a stranded offline queue, a timer
 * left running overnight — looked exactly like a quiet day on screen, and was
 * only caught because somebody went looking.
 *
 * A rule is deliberately small: one metric, one threshold, one audience. The
 * evaluator runs daily off the scheduler.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('monitoring_alert_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            // Which figure to watch. Kept as a string rather than an enum so a
            // new metric is a code change, not a migration on every deployment.
            $table->string('metric', 60);
            /*
             * Compared against the metric in its own natural unit — seconds for
             * durations, whole percent for shares. Stored as an integer because
             * every metric this watches is countable; a float threshold would
             * invite "tracked less than 6.5 hours" phrasing that reads
             * precisely and means nothing at this resolution.
             */
            $table->integer('threshold');
            // Null means every employee the organization can see.
            $table->foreignId('group_id')->nullable()->constrained('groups')->nullOnDelete();
            $table->boolean('is_enabled')->default(true);
            $table->timestamp('last_evaluated_at')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'is_enabled']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('monitoring_alert_rules');
    }
};
