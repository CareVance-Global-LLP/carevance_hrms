<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Add read/unread tracking so the Reimbursements inbox badge
     * behaves like chat: a new claim shows a badge, opening it marks
     * it read and decrements the badge.
     *
     *   admin_read_at   → set when an admin opens the claim while it is
     *                     awaiting admin approval
     *   manager_read_at → set when the reporting manager opens the claim
     *                     while it is awaiting manager approval
     */
    public function up(): void
    {
        Schema::table('reimbursements', function (Blueprint $table) {
            $table->timestamp('manager_read_at')->nullable()->after('manager_approved_at');
            $table->timestamp('admin_read_at')->nullable()->after('manager_read_at');
        });
    }

    public function down(): void
    {
        Schema::table('reimbursements', function (Blueprint $table) {
            $table->dropColumn(['admin_read_at', 'manager_read_at']);
        });
    }
};
