<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('fbp_components')) {
            Schema::create('fbp_components', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->string('code')->unique();
                $table->string('category')->default('food'); // food, travel, communication, office, other
                $table->decimal('max_exempt_limit', 12, 2)->default(0);
                $table->boolean('requires_proof')->default(false);
                $table->boolean('is_taxable')->default(false);
                $table->text('description')->nullable();
                $table->boolean('is_active')->default(true);
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('fbp_components');
    }
};
