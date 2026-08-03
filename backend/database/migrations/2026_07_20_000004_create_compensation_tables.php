<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ctc_bands', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->decimal('min_ctc', 14, 2);
            $table->decimal('max_ctc', 14, 2);
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });

        // SUPERSEDED: daily_wage_structures is owned by
        // 2026_06_11_000009_create_custom_reports_and_gl_tables, whose columns
        // (code, daily_wage, working_days_per_month, overtime_rate_multiplier,
        // allowances, pf_applicable, esi_applicable) are what the
        // DailyWageStructure model actually reads. The definition below used
        // daily_rate/monthly_equivalent, which no code consumes.
        if (Schema::hasTable('daily_wage_structures')) {
            return;
        }

        Schema::create('daily_wage_structures', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 100);
            $table->decimal('daily_rate', 12, 2);
            $table->decimal('monthly_equivalent', 12, 2);
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('daily_wage_structures');
        Schema::dropIfExists('ctc_bands');
    }
};
