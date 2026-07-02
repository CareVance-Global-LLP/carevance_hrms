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
        Schema::create('payroll_reconciliation', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('payroll_item_id');
            $table->foreign('payroll_item_id')->references('id')->on('payroll_items')->onDelete('cascade');
            $table->decimal('old_present_days', 5, 2)->default(0)->comment('Old calculation method');
            $table->decimal('new_present_days', 5, 2)->default(0)->comment('New simplified calculation');
            $table->decimal('difference', 5, 2)->default(0)->comment('Difference between old and new');
            $table->string('month_year', 7)->comment('YYYY-MM format');
            $table->json('debug_info')->nullable()->comment('Debug information');
            $table->timestamps();
            
            // Index for quick lookups
            $table->index('payroll_item_id');
            $table->index('month_year');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('payroll_reconciliation');
    }
};
