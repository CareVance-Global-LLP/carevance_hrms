<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('fbp_claims')) {
            Schema::create('fbp_claims', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('fbp_allocation_id')->nullable()->constrained()->nullOnDelete();
                $table->foreignId('fbp_component_id')->nullable()->constrained()->nullOnDelete();
                $table->decimal('claimed_amount', 12, 2)->default(0);
                $table->decimal('approved_amount', 12, 2)->default(0);
                $table->string('bill_number')->nullable();
                $table->date('bill_date')->nullable();
                $table->text('description')->nullable();
                $table->string('status')->default('pending'); // pending, approved, rejected
                $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('approved_at')->nullable();
                $table->text('rejection_reason')->nullable();
                $table->string('proof_file_path')->nullable();
                $table->string('proof_filename')->nullable();
                $table->string('month_year')->nullable();
                $table->boolean('is_tax_exempt')->default(false);
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('fbp_claims');
    }
};
