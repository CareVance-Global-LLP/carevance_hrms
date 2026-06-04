<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_tax_declaration_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('declaration_id')->constrained('employee_tax_declarations')->cascadeOnDelete();
            $table->string('section', 20)->comment('80C, 80D, 80G, 24b, HRA, LTA, 80CCD1B, etc.');
            $table->string('category', 100)->comment('PPF, ELSS, Life Insurance, etc.');
            $table->string('description')->nullable();
            $table->decimal('declared_amount', 15, 2)->default(0);
            $table->decimal('approved_amount', 15, 2)->default(0);
            $table->string('proof_path')->nullable();
            $table->string('status', 20)->default('pending')->comment('pending, approved, rejected');
            $table->text('remarks')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_tax_declaration_items');
    }
};
