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
            $table->string('code');
            $table->text('description')->nullable();
            $table->decimal('max_annual_amount', 12, 2);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['organization_id', 'code']);
        });

        Schema::create('fbp_allocations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('fbp_component_id')->constrained('fbp_components')->cascadeOnDelete();
            $table->decimal('allocated_amount', 12, 2);
            $table->string('financial_year', 9);
            $table->enum('status', ['draft', 'submitted', 'locked'])->default('draft');
            $table->timestamps();

            $table->unique(['organization_id', 'user_id', 'fbp_component_id', 'financial_year']);
        });

        Schema::create('fbp_claims', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('fbp_component_id')->constrained('fbp_components')->cascadeOnDelete();
            $table->foreignId('fbp_allocation_id')->constrained('fbp_allocations')->cascadeOnDelete();
            $table->decimal('amount', 12, 2);
            $table->date('claim_date');
            $table->text('description')->nullable();
            $table->string('receipt_path')->nullable();
            $table->enum('status', ['draft', 'submitted', 'approved', 'rejected', 'paid'])->default('draft');
            $table->foreignId('reviewer_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('reviewer_notes')->nullable();
            $table->timestamp('reviewed_at')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'status']);
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
