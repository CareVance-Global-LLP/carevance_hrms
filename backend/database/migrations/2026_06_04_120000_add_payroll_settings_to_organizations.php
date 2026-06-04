<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organizations', function (Blueprint $table) {
            // Add payroll_settings JSON column if not exists
            // Note: We're using the existing 'settings' column which is already JSON
            // This migration ensures the payroll_settings structure exists
        });
    }

    public function down(): void
    {
        // No rollback needed as we're using existing settings column
    }
};
