<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('variable_pay_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->unique();
            $table->string('calculation_type'); // percentage, slab, fixed
            $table->decimal('default_percentage', 5, 2)->nullable();
            $table->decimal('max_percentage', 5, 2)->nullable();
            $table->string('frequency')->default('monthly'); // monthly, quarterly, annual, onetime
            $table->json('slabs')->nullable();
            $table->json('eligibility_criteria')->nullable();
            $table->boolean('is_performance_based')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });

        Schema::create('variable_pay_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('variable_pay_rule_id')->constrained('variable_pay_rules')->cascadeOnDelete();
            $table->decimal('percentage', 5, 2)->nullable();
            $table->decimal('fixed_amount', 12, 2)->nullable();
            $table->string('month_year')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['user_id', 'month_year']);
            $table->index(['organization_id', 'is_active']);
        });

        Schema::create('shift_allowance_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->unique();
            $table->string('shift_type'); // night, weekend, holiday, general, hazardous
            $table->decimal('allowance_per_hour', 10, 2)->default(0);
            $table->decimal('allowance_per_shift', 10, 2)->default(0);
            $table->string('allowance_type')->default('percentage'); // percentage, fixed
            $table->decimal('percentage_value', 5, 2)->nullable();
            $table->string('applicable_days')->nullable(); // mon,tue,wed,thu,fri,sat,sun
            $table->time('start_time')->nullable();
            $table->time('end_time')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'shift_type']);
        });

        Schema::create('ot_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->unique();
            $table->decimal('rate_multiplier', 4, 2)->default(1.50);
            $table->decimal('daily_limit_hours', 4, 2)->nullable();
            $table->decimal('weekly_limit_hours', 4, 2)->nullable();
            $table->decimal('monthly_limit_hours', 4, 2)->nullable();
            $table->boolean('holiday_ot_enabled')->default(true);
            $table->decimal('holiday_rate_multiplier', 4, 2)->default(2.00);
            $table->boolean('comp_off_enabled')->default(false);
            $table->decimal('comp_off_hours_per_ot_hour', 4, 2)->default(1.00);
            $table->string('applicable_days')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ot_rules');
        Schema::dropIfExists('shift_allowance_rules');
        Schema::dropIfExists('variable_pay_assignments');
        Schema::dropIfExists('variable_pay_rules');
    }
};
