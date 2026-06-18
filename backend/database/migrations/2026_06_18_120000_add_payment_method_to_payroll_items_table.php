<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Adds the missing `payment_method` column to `payroll_items`.
 *
 * Background:
 *   - PayrollItem::$fillable declares `payment_method`
 *   - The original migration declared it
 *   - But on some databases it was never created (or was dropped)
 *   - Both `markItemPaid` (new) and `processRunPayment` (existing) write
 *     this column, so both fail with SQLSTATE[42703] until it's added.
 *
 * Idempotent via Schema::hasColumn guard.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('payroll_items', function (Blueprint $table) {
            if (! Schema::hasColumn('payroll_items', 'payment_method')) {
                $table->string('payment_method', 30)
                    ->nullable()
                    ->comment('bank_transfer, cash, cheque, upi')
                    ->after('payment_reference');
            }
        });
    }

    public function down(): void
    {
        Schema::table('payroll_items', function (Blueprint $table) {
            if (Schema::hasColumn('payroll_items', 'payment_method')) {
                $table->dropColumn('payment_method');
            }
        });
    }
};
