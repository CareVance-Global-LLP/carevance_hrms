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
        Schema::table('resignations', function (Blueprint $table) {
            $table->foreignId('escalated_to_user_id')->nullable()->constrained('users')->onDelete('set null')->after('approved_by');
            $table->json('escalation_history')->nullable()->after('escalated_to_user_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('resignations', function (Blueprint $table) {
            $table->dropConstrainedForeignId('escalated_to_user_id');
            $table->dropColumn('escalation_history');
        });
    }
};
