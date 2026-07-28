<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('stop_payment_flags', function (Blueprint $table) {
            $table->enum('hold_type', ['processing', 'payout'])->default('processing')->after('reason');
        });

        DB::table('stop_payment_flags')->whereNull('hold_type')->update(['hold_type' => 'processing']);
    }

    public function down(): void
    {
        Schema::table('stop_payment_flags', function (Blueprint $table) {
            $table->dropColumn('hold_type');
        });
    }
};