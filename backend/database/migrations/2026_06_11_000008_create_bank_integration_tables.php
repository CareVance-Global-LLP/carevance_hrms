<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('bank_api_configs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('bank_name'); // ICICI, HDFC, AXIS, SBI, KOTAK, YES_BANK
            $table->string('api_endpoint')->nullable();
            $table->string('api_key')->nullable();
            $table->string('api_secret')->nullable();
            $table->string('api_token')->nullable();
            $table->string('account_number')->nullable();
            $table->string('beneficiary_validation_endpoint')->nullable();
            $table->string('bulk_transfer_endpoint')->nullable();
            $table->string('status_callback_endpoint')->nullable();
            $table->boolean('is_active')->default(false);
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'bank_name']);
        });

        Schema::create('bank_transfer_batches', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_run_id')->nullable()->constrained('payroll_monthly_runs')->nullOnDelete();
            $table->string('batch_reference')->unique();
            $table->string('bank_name');
            $table->decimal('total_amount', 14, 2)->default(0);
            $table->integer('total_transactions')->default(0);
            $table->integer('success_count')->default(0);
            $table->integer('failure_count')->default(0);
            $table->string('status')->default('pending'); // pending, processing, completed, failed, partially_completed
            $table->string('file_format')->default('csv'); // csv, xml
            $table->string('file_path')->nullable();
            $table->json('api_response')->nullable();
            $table->string('error_message')->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->foreignId('created_by')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'status']);
            $table->index(['payroll_run_id']);
        });

        Schema::create('bank_transfer_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('bank_transfer_batch_id')->constrained('bank_transfer_batches')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_item_id')->nullable()->constrained('payroll_items')->nullOnDelete();
            $table->string('beneficiary_name');
            $table->string('beneficiary_account');
            $table->string('beneficiary_ifsc');
            $table->decimal('amount', 12, 2);
            $table->string('status')->default('pending'); // pending, success, failed, reversed
            $table->string('transaction_reference')->nullable();
            $table->string('failure_reason')->nullable();
            $table->json('api_response')->nullable();
            $table->timestamp('processed_at')->nullable();
            $table->timestamps();

            $table->index(['bank_transfer_batch_id', 'status']);
            $table->index(['organization_id', 'status']);
            $table->index(['user_id']);
        });

        Schema::create('payment_reversals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('payroll_item_id')->constrained('payroll_items')->cascadeOnDelete();
            $table->foreignId('bank_transfer_item_id')->nullable()->constrained('bank_transfer_items')->nullOnDelete();
            $table->decimal('amount', 12, 2);
            $table->string('reason');
            $table->string('status')->default('pending'); // pending, approved, completed, rejected
            $table->string('transaction_reference')->nullable();
            $table->foreignId('requested_by')->constrained('users')->cascadeOnDelete();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'status']);
            $table->index(['payroll_item_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_reversals');
        Schema::dropIfExists('bank_transfer_items');
        Schema::dropIfExists('bank_transfer_batches');
        Schema::dropIfExists('bank_api_configs');
    }
};
