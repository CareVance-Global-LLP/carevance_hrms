<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Add the shared poll reference to notifications.
        Schema::table('app_notifications', function (Blueprint $table) {
            $table->foreignId('poll_id')->nullable()->after('id')->constrained('polls')->nullOnDelete();
        });

        // Repoint each existing notification to its (single) poll.
        DB::table('polls')
            ->whereNotNull('app_notification_id')
            ->orderBy('id')
            ->chunkById(100, function ($polls) {
                foreach ($polls as $poll) {
                    DB::table('app_notifications')
                        ->where('id', $poll->app_notification_id)
                        ->update(['poll_id' => $poll->id]);
                }
            });

        // Drop the old one-to-one column from polls.
        Schema::table('polls', function (Blueprint $table) {
            $table->dropForeign(['app_notification_id']);
            $table->dropIndex(['app_notification_id']);
            $table->dropColumn('app_notification_id');
        });
    }

    public function down(): void
    {
        Schema::table('polls', function (Blueprint $table) {
            $table->foreignId('app_notification_id')->constrained()->cascadeOnDelete();
            $table->index('app_notification_id');
        });

        // Restore the original one-to-one link (best effort for shared polls).
        DB::table('app_notifications')
            ->whereNotNull('poll_id')
            ->orderBy('id')
            ->chunkById(100, function ($notifications) {
                foreach ($notifications as $notification) {
                    DB::table('polls')
                        ->where('id', $notification->poll_id)
                        ->update(['app_notification_id' => $notification->id]);
                }
            });

        Schema::table('app_notifications', function (Blueprint $table) {
            $table->dropForeign(['poll_id']);
            $table->dropColumn('poll_id');
        });
    }
};
