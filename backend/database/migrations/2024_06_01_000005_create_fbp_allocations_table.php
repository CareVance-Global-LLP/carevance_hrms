<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (!Schema::hasTable('fbp_allocations')) {
            Schema::create('fbp_allocations', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('fbp_component_id')->constrained()->cascadeOnDelete();
                $table->string('financial_year'); // e.g. 2024-2025
                $table->decimal('allocated_amount', 12, 2)->default(0);
                $table->decimal('utilized_amount', 12, 2)->default(0);
                $table->decimal('claimed_amount', 12, 2)->default(0);
                $table->decimal('approved_amount', 12, 2)->default(0);
                $table->string('status')->default('active'); // active, closed
                $table->timestamps();
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('fbp_allocations');
    }
};
