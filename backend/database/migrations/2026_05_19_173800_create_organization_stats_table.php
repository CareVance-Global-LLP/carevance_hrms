<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::create('organization_stats', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->onDelete('cascade');
            $table->integer('total_users')->default(0);
            $table->integer('active_users')->default(0);
            $table->bigInteger('storage_used')->default(0); // in bytes
            $table->timestamp('last_activity')->nullable();
            $table->timestamps();
            
            $table->unique('organization_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('organization_stats');
    }
};
