<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('reimbursements')) {
            Schema::create('reimbursements', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
                $table->string('category'); // travel, food, medical, internet, mobile, other
                $table->decimal('amount', 12, 2)->default(0);
                $table->string('currency')->default('INR');
                $table->date('expense_date')->nullable();
                $table->text('description')->nullable();
                $table->string('receipt_url')->nullable();
                $table->string('merchant_name')->nullable();
                $table->string('location')->nullable();
                $table->string('status')->default('pending'); // pending, approved, rejected, paid
                $table->timestamp('approved_at')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('reimbursements');
    }
};
