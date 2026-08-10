<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Publishing an announcement writes one `app_notifications` row per recipient,
 * each carrying its own `read_at` — so "how many people opened this" has always
 * been answerable in principle. What was missing is anything marking those 85
 * rows as *one* announcement, which is why the sender could never be told.
 *
 * Rows written before this stay null and simply show no delivery figure, rather
 * than a wrong one.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('app_notifications', function (Blueprint $table) {
            $table->uuid('broadcast_id')->nullable()->after('sender_id');
            $table->index(['broadcast_id'], 'app_notifications_broadcast_id_index');
        });
    }

    public function down(): void
    {
        Schema::table('app_notifications', function (Blueprint $table) {
            $table->dropIndex('app_notifications_broadcast_id_index');
            $table->dropColumn('broadcast_id');
        });
    }
};
