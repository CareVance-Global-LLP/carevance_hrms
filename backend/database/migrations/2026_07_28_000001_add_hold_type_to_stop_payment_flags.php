<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // `hold_type` is already part of the stop_payment_flags create
        // migration, so adding it unconditionally aborted the run with
        // "duplicate column name: hold_type" on any freshly built database.
        if (!Schema::hasColumn('stop_payment_flags', 'hold_type')) {
            Schema::table('stop_payment_flags', function (Blueprint $table) {
                $table->enum('hold_type', ['processing', 'payout'])->default('processing')->after('reason');
            });
        }

        DB::table('stop_payment_flags')->whereNull('hold_type')->update(['hold_type' => 'processing']);
    }

    public function down(): void
    {
        if (!Schema::hasColumn('stop_payment_flags', 'hold_type')) {
            return;
        }

        Schema::table('stop_payment_flags', function (Blueprint $table) {
            $table->dropColumn('hold_type');
        });
    }
};