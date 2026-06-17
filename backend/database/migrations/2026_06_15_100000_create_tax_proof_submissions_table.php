<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('tax_proof_submissions')) {
            return;
        }
        Schema::create('tax_proof_submissions', function (Blueprint $table) {
            $table->id();

            $table->foreignId('organization_id')
                ->constrained('organizations')
                ->cascadeOnDelete();

            $table->foreignId('user_id')
                ->constrained('users')
                ->cascadeOnDelete();

            $table->foreignId('declaration_item_id')
                ->constrained('employee_tax_declaration_items')
                ->cascadeOnDelete();

            $table->string('financial_year', 9);                  // "2024-2025"
            $table->string('declaration_type', 30);               // 80C, 80D, HRA, 80CCD1B, ...
            $table->string('description', 500)->nullable();
            $table->decimal('amount', 12, 2)->default(0);

            // File storage — relative to the local disk's root
            $table->string('proof_file_path', 500);
            $table->string('proof_filename', 255);
            $table->unsignedBigInteger('proof_size_bytes')->nullable();
            $table->string('proof_mime', 50)->nullable();

            // Lifecycle: submitted → approved | rejected | auto_approved
            $table->enum('status', [
                'submitted', 'auto_approved', 'approved', 'rejected',
            ])->default('submitted');

            $table->foreignId('reviewed_by')
                ->nullable()
                ->constrained('users')
                ->nullOnDelete();

            $table->timestamp('reviewed_at')->nullable();
            $table->text('review_notes')->nullable();

            $table->timestamps();

            // Indexes for the most common list/admin queries.
            $table->index(['organization_id', 'status']);
            $table->index(['organization_id', 'financial_year']);
            $table->index(['user_id', 'financial_year']);
            $table->index('declaration_item_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('tax_proof_submissions');
    }
};
