<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // SUPERSEDED: the FBP tables are owned by
        // 2026_06_11_000003_create_fbp_tables. That schema
        // (category, max_exempt_limit, requires_proof, is_taxable) is what
        // FbpService and PayrollDepartmentController actually read; the
        // definitions below (max_annual_amount, amount, reviewer_id) are used
        // by no business logic.
        //
        // Creating them unconditionally aborted every fresh migration run with
        // "table fbp_components already exists", which took the whole Feature
        // suite down with it.
        if (Schema::hasTable('fbp_components')) {
            return;
        }

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
