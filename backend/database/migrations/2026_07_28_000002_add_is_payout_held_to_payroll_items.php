<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Duplicate of 2026_07_27_000002_add_is_payout_held_to_payroll_items — the
 * same change was committed twice a day apart. Adding the column
 * unconditionally aborted every fresh migration run with
 * "duplicate column name: is_payout_held", so the guard below makes this file
 * inert while keeping its migration-log entry intact for installs that already
 * recorded it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('payroll_items', 'is_payout_held')) {
            return;
        }

        Schema::table('payroll_items', function (Blueprint $table) {
            $table->boolean('is_payout_held')->default(false)->after('payment_status');
        });
    }

    public function down(): void
    {
        // Ownership of this column belongs to the 07_27 migration; dropping it
        // here would silently revert that one's change.
    }
};
