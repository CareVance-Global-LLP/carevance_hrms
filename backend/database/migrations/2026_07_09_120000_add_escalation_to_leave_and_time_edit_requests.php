<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->foreignId('escalated_to_user_id')->nullable()->after('reviewed_by')->constrained('users')->nullOnDelete();
            $table->json('escalation_history')->nullable()->after('escalated_to_user_id');
            $table->index(['organization_id', 'escalated_to_user_id'], 'leave_requests_org_escalated_idx');
        });

        Schema::table('attendance_time_edit_requests', function (Blueprint $table) {
            $table->foreignId('escalated_to_user_id')->nullable()->after('reviewed_by')->constrained('users')->nullOnDelete();
            $table->json('escalation_history')->nullable()->after('escalated_to_user_id');
            $table->index(['organization_id', 'escalated_to_user_id'], 'attendance_time_edit_requests_org_escalated_idx');
        });
    }

    public function down(): void
    {
        Schema::table('leave_requests', function (Blueprint $table) {
            $table->dropIndex('leave_requests_org_escalated_idx');
            $table->dropConstrainedForeignId('escalated_to_user_id');
            $table->dropColumn('escalation_history');
        });

        Schema::table('attendance_time_edit_requests', function (Blueprint $table) {
            $table->dropIndex('attendance_time_edit_requests_org_escalated_idx');
            $table->dropConstrainedForeignId('escalated_to_user_id');
            $table->dropColumn('escalation_history');
        });
    }
};
