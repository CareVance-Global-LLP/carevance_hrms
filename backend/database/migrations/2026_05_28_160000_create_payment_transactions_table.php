<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('payment_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->string('provider', 20)->default('razorpay'); // razorpay, stripe, mock
            $table->string('provider_order_id', 255)->nullable();
            $table->string('provider_payment_id', 255)->nullable();
            $table->decimal('amount', 12, 2)->default(0);
            $table->string('currency', 8)->default('INR');
            $table->string('status', 20)->default('created'); // created, completed, failed, refunded
            $table->string('payment_type', 30)->default('subscription'); // subscription, upgrade, add_seats, renewal
            $table->json('metadata')->nullable();
            $table->json('provider_response')->nullable();
            $table->timestamp('paid_at')->nullable();
            $table->timestamp('refunded_at')->nullable();
            $table->decimal('refund_amount', 12, 2)->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'status'], 'payment_transactions_org_status_idx');
            $table->index(['provider', 'provider_order_id'], 'payment_transactions_provider_order_idx');
            $table->index(['provider', 'provider_payment_id'], 'payment_transactions_provider_payment_idx');
            $table->index('created_at', 'payment_transactions_created_at_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payment_transactions');
    }
};
