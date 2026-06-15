<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('perquisite_records', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('type'); // car, accommodation, esop, sweeper, gardener, domestic_help, gas_electricity, free_food, education, others
            $table->string('description')->nullable();
            $table->decimal('monthly_value', 12, 2)->default(0);
            $table->decimal('annual_value', 12, 2)->default(0);
            $table->decimal('taxable_value', 12, 2)->default(0);
            $table->decimal('employee_contribution', 12, 2)->default(0);
            $table->date('from_date')->nullable();
            $table->date('to_date')->nullable();
            $table->json('details')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'user_id', 'type']);
            $table->index(['user_id', 'is_active']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('perquisite_records');
    }
};
