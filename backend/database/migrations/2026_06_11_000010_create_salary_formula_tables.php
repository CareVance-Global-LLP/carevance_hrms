<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('salary_formulas', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('salary_component_id')->nullable()->constrained('salary_components')->cascadeOnDelete();
            $table->string('name');
            $table->string('formula_expression');
            $table->string('description')->nullable();
            $table->string('effective_from')->nullable();
            $table->string('effective_to')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'salary_component_id']);
        });

        Schema::create('salary_lookup_components', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->unique();
            $table->string('lookup_type'); // category, grade, location, department, designation
            $table->json('value_map')->nullable();
            $table->string('default_value')->nullable();
            $table->string('data_type')->default('number'); // number, percentage, amount
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'lookup_type']);
        });

        Schema::create('salary_slab_components', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name');
            $table->string('code')->unique();
            $table->string('slab_type'); // range, percentage, flat
            $table->json('slabs')->nullable();
            $table->string('applicable_on')->nullable(); // gross, basic, ctc
            $table->decimal('default_value', 12, 2)->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'slab_type']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('salary_slab_components');
        Schema::dropIfExists('salary_lookup_components');
        Schema::dropIfExists('salary_formulas');
    }
};
