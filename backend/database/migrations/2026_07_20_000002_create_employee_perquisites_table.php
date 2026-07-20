<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('employee_perquisites', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('perquisite_type', 100);
            $table->text('description')->nullable();
            $table->decimal('annual_value', 12, 2);
            $table->decimal('taxable_value', 12, 2);
            $table->string('financial_year', 9);
            $table->enum('status', ['active', 'revoked'])->default('active');
            $table->timestamps();

            $table->index(['organization_id', 'user_id', 'financial_year']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('employee_perquisites');
    }
};
