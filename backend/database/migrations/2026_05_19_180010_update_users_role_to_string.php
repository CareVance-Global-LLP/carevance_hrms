<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        // Convert role column from enum to string to support super_admin
        DB::statement("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
        
        // Change role column to string to allow any role value
        Schema::table('users', function (Blueprint $table) {
            $table->string('role')->default('employee')->change();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        // Revert back to enum (this might fail if super_admin users exist)
        Schema::table('users', function (Blueprint $table) {
            $table->enum('role', ['admin', 'manager', 'employee'])->default('employee')->change();
        });
    }
};
