<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     * 
     * This migration adds Indian payroll compliance fields to existing tables
     * and creates standalone payroll time tracking table.
     */
    public function up(): void
    {
        // Add Indian payroll compliance fields to employee_profiles
        Schema::table('employee_profiles', function (Blueprint $table) {
            $table->string('pan_number', 10)->nullable()->after('emergency_contact_relationship')->comment('Permanent Account Number for TDS');
            $table->string('uan_number', 12)->nullable()->after('pan_number')->comment('Universal Account Number for PF');
            $table->string('esi_ip_number', 17)->nullable()->after('uan_number')->comment('ESI Insured Person Number');
            $table->enum('tax_regime', ['new', 'old'])->default('new')->after('esi_ip_number')->comment('Income tax regime selection');
            $table->boolean('is_metro_city')->default(false)->after('tax_regime')->comment('For HRA calculation (50% vs 40%)');
            $table->string('pt_state', 50)->nullable()->after('is_metro_city')->comment('State for Professional Tax calculation');
        });

        // Create standalone payroll time tracking table (separate from timetracker time_entries)
        Schema::create('payroll_time_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->date('work_date');
            $table->timestamp('check_in')->nullable();
            $table->timestamp('check_out')->nullable();
            $table->integer('duration_seconds')->default(0)->comment('Total working duration in seconds');
            $table->integer('break_seconds')->default(0)->comment('Total break duration in seconds');
            $table->decimal('payable_hours', 5, 2)->default(0)->comment('Hours to be paid');
            $table->enum('status', ['active', 'completed', 'absent', 'leave'])->default('active');
            $table->text('notes')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();

            // Indexes
            $table->index(['organization_id', 'user_id', 'work_date'], 'payroll_time_entries_org_user_date_idx');
            $table->index(['user_id', 'work_date'], 'payroll_time_entries_user_date_idx');
            $table->unique(['user_id', 'work_date'], 'payroll_time_entries_user_date_unique');
        });

        // Add organization payroll settings
        Schema::table('organizations', function (Blueprint $table) {
            $table->string('pt_state', 50)->nullable()->after('settings')->comment('Default PT state for organization');
            $table->json('pt_configuration')->nullable()->after('pt_state')->comment('State-specific PT configuration');
            $table->json('payroll_settings')->nullable()->after('pt_configuration')->comment('Organization payroll settings');
        });

        // Add payment tracking to pay_run_items
        Schema::table('pay_run_items', function (Blueprint $table) {
            $table->string('payment_reference')->nullable()->after('payout_status')->comment('Payment gateway/bank reference');
            $table->timestamp('paid_at')->nullable()->after('payment_reference');
            $table->json('payment_meta')->nullable()->after('paid_at');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('payroll_time_entries');

        Schema::table('employee_profiles', function (Blueprint $table) {
            $table->dropColumn([
                'pan_number',
                'uan_number',
                'esi_ip_number',
                'tax_regime',
                'is_metro_city',
                'pt_state',
            ]);
        });

        Schema::table('organizations', function (Blueprint $table) {
            $table->dropColumn([
                'pt_state',
                'pt_configuration',
                'payroll_settings',
            ]);
        });

        Schema::table('pay_run_items', function (Blueprint $table) {
            $table->dropColumn([
                'payment_reference',
                'paid_at',
                'payment_meta',
            ]);
        });
    }
};
