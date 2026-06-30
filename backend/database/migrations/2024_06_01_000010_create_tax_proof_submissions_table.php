<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('tax_proof_submissions')) {
            Schema::create('tax_proof_submissions', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('declaration_item_id')->nullable()->constrained('employee_tax_declaration_items')->nullOnDelete();
                $table->string('financial_year')->nullable();
                $table->string('declaration_type')->nullable(); // 80c, 80d, hra, lta, etc.
                $table->text('description')->nullable();
                $table->decimal('amount', 12, 2)->default(0);
                $table->string('proof_file_path')->nullable();
                $table->string('proof_filename')->nullable();
                $table->string('status')->default('pending'); // pending, approved, rejected, partial
                $table->foreignId('reviewed_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('reviewed_at')->nullable();
                $table->text('review_notes')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('tax_proof_submissions');
    }
};
