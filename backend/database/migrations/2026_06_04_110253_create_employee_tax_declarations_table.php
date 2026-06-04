<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_tax_declarations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('financial_year', 9)->comment('e.g., 2025-26');
            $table->string('status', 20)->default('draft')->comment('draft, submitted, approved, rejected');
            $table->decimal('total_declared_amount', 15, 2)->default(0);
            $table->decimal('approved_amount', 15, 2)->default(0);
            $table->timestamp('submitted_at')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('approved_at')->nullable();
            $table->text('remarks')->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'financial_year'], 'tax_declaration_user_year_unique');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_tax_declarations');
    }
};
