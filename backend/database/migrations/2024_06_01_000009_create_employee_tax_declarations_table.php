<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('employee_tax_declarations')) {
            Schema::create('employee_tax_declarations', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->string('financial_year'); // e.g. 2024-2025
                $table->string('status')->default('draft'); // draft, submitted, approved, rejected
                $table->string('proof_status')->default('pending'); // pending, partial, complete
                $table->decimal('total_declared_amount', 14, 2)->default(0);
                $table->decimal('approved_amount', 14, 2)->default(0);
                $table->timestamp('submitted_at')->nullable();
                $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
                $table->timestamp('approved_at')->nullable();
                $table->text('remarks')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_tax_declarations');
    }
};
