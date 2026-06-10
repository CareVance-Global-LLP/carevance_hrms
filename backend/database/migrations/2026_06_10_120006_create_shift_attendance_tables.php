<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Shift Management
        Schema::create('shifts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            
            // Shift Details
            $table->string('name');
            $table->string('code', 50);
            $table->enum('type', ['general', 'morning', 'evening', 'night', 'rotating'])->default('general');
            $table->text('description')->nullable();
            
            // Timings
            $table->time('start_time');
            $table->time('end_time');
            $table->integer('duration_minutes');
            $table->integer('break_duration_minutes')->default(60);
            $table->boolean('is_night_shift')->default(false);
            $table->time('night_shift_start')->nullable();
            $table->time('night_shift_end')->nullable();
            
            // Shift Differential
            $table->boolean('has_shift_differential')->default(false);
            $table->decimal('differential_percentage', 5, 2)->default(0)->comment('Additional % of basic hourly rate');
            $table->decimal('differential_fixed', 10, 2)->default(0)->comment('Fixed amount per night shift hour');
            
            // Weekend Differential
            $table->boolean('has_weekend_differential')->default(false);
            $table->decimal('weekend_differential_percentage', 5, 2)->default(0);
            $table->decimal('weekend_differential_fixed', 10, 2)->default(0);
            
            // Overtime Rules
            $table->decimal('overtime_multiplier', 3, 2)->default(2.00)->comment('2x for normal, 1.5x for night');
            
            // Grace Period
            $table->integer('grace_period_minutes')->default(10);
            $table->integer('early_exit_grace_minutes')->default(10);
            
            // Status
            $table->boolean('is_active')->default(true);
            $table->json('applicable_days')->nullable()->comment('Days of week this shift applies');
            
            $table->timestamps();
            
            // Indexes
            $table->unique(['organization_id', 'code'], 'shift_org_code_unique');
            $table->index(['organization_id', 'is_active'], 'shift_org_active_idx');
        });

        // Employee Shift Assignments
        Schema::create('employee_shifts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('shift_id')->constrained()->cascadeOnDelete();
            
            // Assignment Period
            $table->date('effective_from');
            $table->date('effective_to')->nullable();
            $table->boolean('is_active')->default(true);
            
            // Override Settings
            $table->decimal('custom_differential_rate', 10, 2)->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->index(['user_id', 'effective_from'], 'emp_shift_user_from_idx');
            $table->index(['organization_id', 'is_active'], 'emp_shift_org_active_idx');
        });

        // Comp-off Management
        Schema::create('comp_off_balance', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            
            // Balance Details
            $table->integer('earned_days')->default(0);
            $table->integer('used_days')->default(0);
            $table->integer('expired_days')->default(0);
            $table->integer('balance_days')->default(0);
            
            // Year Tracking
            $table->string('applicable_year', 4);
            $table->date('expiry_date')->nullable();
            
            // History
            $table->json('transaction_history')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->unique(['user_id', 'applicable_year'], 'compoff_user_year_unique');
            $table->index(['organization_id', 'applicable_year'], 'compoff_org_year_idx');
        });

        // Comp-off Transactions
        Schema::create('comp_off_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('comp_off_balance_id')->constrained()->cascadeOnDelete();
            
            // Transaction Details
            $table->enum('type', ['earned', 'used', 'expired', 'lapsed', 'adjusted']);
            $table->integer('days');
            $table->date('transaction_date');
            
            // Reference
            $table->enum('reference_type', ['weekend_work', 'holiday_work', 'leave_application', 'expiry', 'payroll'])->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            
            // Details
            $table->text('description')->nullable();
            $table->decimal('monetary_value', 12, 2)->default(0)->comment('Value if encashed');
            
            $table->timestamps();
            
            // Indexes
            $table->index(['user_id', 'transaction_date'], 'comptxn_user_date_idx');
            $table->index(['reference_type', 'reference_id'], 'comptxn_ref_idx');
        });

        // Late/Early Deduction Rules
        Schema::create('attendance_deduction_rules', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            
            // Rule Type
            $table->enum('rule_type', ['late_coming', 'early_exit', 'both'])->default('late_coming');
            $table->string('name');
            
            // Thresholds (in minutes)
            $table->integer('threshold_minutes'); // e.g., 15 minutes
            $table->integer('max_occurrences')->nullable(); // e.g., 3 occurrences per month
            
            // Deduction Type
            $table->enum('deduction_type', ['fixed', 'percentage_of_basic', 'percentage_of_daily'])->default('fixed');
            $table->decimal('deduction_value', 10, 2)->default(0);
            
            // Progressive Penalty
            $table->boolean('is_progressive')->default(false);
            $table->json('progressive_slabs')->nullable()->comment('e.g., [{"occurrence": 1, "deduction": 0}, {"occurrence": 2, "deduction": 100}]');
            
            // Application
            $table->enum('application', ['per_instance', 'daily_max', 'monthly_max'])->default('per_instance');
            
            // Status
            $table->boolean('is_active')->default(true);
            $table->integer('priority')->default(0);
            
            $table->timestamps();
            
            // Indexes
            $table->index(['organization_id', 'rule_type', 'is_active'], 'attrule_org_type_active_idx');
        });

        // Attendance Violations (Late/Early)
        Schema::create('attendance_violations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            
            // Violation Details
            $table->date('violation_date');
            $table->enum('violation_type', ['late_coming', 'early_exit']);
            $table->integer('minutes_delayed');
            
            // Time Details
            $table->time('scheduled_time');
            $table->time('actual_time');
            
            // Deduction Applied
            $table->foreignId('deduction_rule_id')->nullable()->constrained('attendance_deduction_rules')->nullOnDelete();
            $table->decimal('deduction_amount', 10, 2)->default(0);
            
            // Status
            $table->enum('status', ['pending', 'approved', 'waived', 'applied'])->default('pending');
            $table->foreignId('waived_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('waiver_reason')->nullable();
            
            $table->timestamps();
            
            // Indexes
            $table->index(['user_id', 'violation_date'], 'attviol_user_date_idx');
            $table->index(['status'], 'attviol_status_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('attendance_violations');
        Schema::dropIfExists('attendance_deduction_rules');
        Schema::dropIfExists('comp_off_transactions');
        Schema::dropIfExists('comp_off_balance');
        Schema::dropIfExists('employee_shifts');
        Schema::dropIfExists('shifts');
    }
};
