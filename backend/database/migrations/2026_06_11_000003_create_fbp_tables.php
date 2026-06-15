<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('fbp_components', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->unique();
            $table->string('category'); // medical, fuel, phone, internet, food, gift, telecom, books, others
            $table->decimal('max_exempt_limit', 12, 2)->nullable();
            $table->boolean('requires_proof')->default(true);
            $table->boolean('is_taxable')->default(false);
            $table->text('description')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'category']);
        });

        Schema::create('fbp_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('fbp_component_id')->constrained('fbp_components')->cascadeOnDelete();
            $table->string('financial_year', 9)->nullable();
            $table->decimal('allocated_amount', 12, 2)->default(0);
            $table->decimal('utilized_amount', 12, 2)->default(0);
            $table->decimal('claimed_amount', 12, 2)->default(0);
            $table->decimal('approved_amount', 12, 2)->default(0);
            $table->string('status')->default('active'); // active, exhausted, expired
            $table->timestamps();

            $table->unique(['user_id', 'fbp_component_id', 'financial_year'], 'fbp_alloc_unique');
            $table->index(['organization_id', 'status']);
        });

        Schema::create('fbp_claims', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('fbp_allocation_id')->constrained('fbp_allocations')->cascadeOnDelete();
            $table->foreignId('fbp_component_id')->constrained('fbp_components')->cascadeOnDelete();
            $table->decimal('claimed_amount', 12, 2);
            $table->decimal('approved_amount', 12, 2)->nullable();
            $table->string('bill_number')->nullable();
            $table->date('bill_date')->nullable();
            $table->text('description')->nullable();
            $table->string('status')->default('pending'); // pending, approved, rejected, paid
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->text('rejection_reason')->nullable();
            $table->string('proof_file_path')->nullable();
            $table->string('proof_filename')->nullable();
            $table->string('month_year')->nullable();
            $table->boolean('is_tax_exempt')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'status', 'month_year']);
            $table->index(['user_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('fbp_claims');
        Schema::dropIfExists('fbp_allocations');
        Schema::dropIfExists('fbp_components');
    }
};
