<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Middle name, stored beside first and last rather than folded into users.name.
 *
 * Statutory filings match on the name as printed on the PAN card, and a
 * mismatch is a common cause of 24Q and Form 16 rejection. Keeping the middle
 * name as its own column means the filing generators can compose the exact
 * printed name; folding it into `users.name` would make it unrecoverable,
 * because that field is split back on whitespace when a profile is rehydrated.
 *
 * Guarded on hasColumn: schema has drifted from migrations here before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('employee_profiles') && ! Schema::hasColumn('employee_profiles', 'middle_name')) {
            Schema::table('employee_profiles', function (Blueprint $table) {
                $table->string('middle_name', 120)->nullable()->after('first_name');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('employee_profiles') && Schema::hasColumn('employee_profiles', 'middle_name')) {
            Schema::table('employee_profiles', function (Blueprint $table) {
                $table->dropColumn('middle_name');
            });
        }
    }
};
