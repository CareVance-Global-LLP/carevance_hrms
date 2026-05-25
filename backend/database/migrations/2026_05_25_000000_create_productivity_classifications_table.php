<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('productivity_classifications', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('organization_id');
            $table->enum('target_type', ['domain', 'app']);
            $table->string('target_value', 255);
            $table->enum('classification', ['productive', 'unproductive', 'neutral']);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();

            $table->foreign('organization_id')->references('id')->on('organizations')->cascadeOnDelete();
            $table->foreign('created_by')->references('id')->on('users')->nullOnDelete();

            $table->unique(['organization_id', 'target_type', 'target_value']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('productivity_classifications');
    }
};
