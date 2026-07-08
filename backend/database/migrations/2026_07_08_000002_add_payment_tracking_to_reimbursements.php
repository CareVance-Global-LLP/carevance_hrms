<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add payment tracking so an approved claim can be split from the
     * "paid" state (mirrors Keka's Within / Outside Payroll flow):
     *   payout_mode       → 'payroll' (added to salary) or 'outside_payroll'
     *   paid_at           → stamped when finance marks the claim paid
     *   payment_reference → bank/UTR reference for outside-payroll payouts
     */
    public function up(): void
    {
        Schema::table('reimbursements', function (Blueprint $table) {
            $table->string('payout_mode', 16)->nullable()->after('approved_at');
            $table->timestamp('paid_at')->nullable()->after('payout_mode');
            $table->string('payment_reference', 255)->nullable()->after('paid_at');
        });
    }

    public function down(): void
    {
        Schema::table('reimbursements', function (Blueprint $table) {
            $table->dropColumn(['payout_mode', 'paid_at', 'payment_reference']);
        });
    }
};
