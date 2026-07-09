<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('assets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->string('asset_tag');
            $table->string('name');
            $table->string('category');
            $table->string('serial_number')->nullable();
            $table->enum('status', ['available', 'assigned'])->default('available');
            $table->date('purchase_date')->nullable();
            $table->softDeletes();
            $table->timestamps();

            $table->unique(['organization_id', 'asset_tag']);
            $table->index(['organization_id', 'status']);
            $table->index(['organization_id', 'category']);
        });

        Schema::create('asset_assignments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();
            $table->foreignId('asset_id')->constrained('assets')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('assigned_by')->nullable()->constrained('users')->nullOnDelete();
            $table->date('assigned_date');
            $table->date('returned_date')->nullable();
            $table->timestamps();

            $table->index(['asset_id', 'returned_date']);
            $table->index(['user_id', 'returned_date']);
            $table->index(['organization_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('asset_assignments');
        Schema::dropIfExists('assets');
    }
};
