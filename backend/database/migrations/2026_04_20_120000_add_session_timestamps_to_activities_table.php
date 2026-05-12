<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            if (!Schema::hasColumn('activities', 'session_key')) {
                $table->string('session_key', 120)->nullable()->after('time_entry_id');
            }
            if (!Schema::hasColumn('activities', 'started_at')) {
                $table->timestamp('started_at')->nullable()->after('recorded_at');
            }
            if (!Schema::hasColumn('activities', 'last_seen_at')) {
                $table->timestamp('last_seen_at')->nullable()->after('started_at');
            }
            if (!Schema::hasColumn('activities', 'ended_at')) {
                $table->timestamp('ended_at')->nullable()->after('last_seen_at');
            }

            if (!Schema::hasIndex('activities', ['user_id', 'session_key'])) {
                $table->index(['user_id', 'session_key']);
            }
            if (!Schema::hasIndex('activities', ['user_id', 'started_at'])) {
                $table->index(['user_id', 'started_at']);
            }
            if (!Schema::hasIndex('activities', ['user_id', 'ended_at'])) {
                $table->index(['user_id', 'ended_at']);
            }
        });
    }

    public function down(): void
    {
        Schema::table('activities', function (Blueprint $table) {
            $table->dropIndex(['user_id', 'session_key']);
            $table->dropIndex(['user_id', 'started_at']);
            $table->dropIndex(['user_id', 'ended_at']);
            $table->dropColumn([
                'session_key',
                'started_at',
                'last_seen_at',
                'ended_at',
            ]);
        });
    }
};
