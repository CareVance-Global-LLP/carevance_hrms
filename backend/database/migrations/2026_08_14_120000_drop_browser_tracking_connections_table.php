<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Drops the browser extension's pairing table.
 *
 * The extension was removed on 14 Aug 2026. It had never written a single
 * activity session, and this table never held a single connection row, in the
 * whole life of the database — the desktop agent reads browser URLs itself
 * through UI Automation, which is what every recorded browser visit came from.
 *
 * `down()` rebuilds the table exactly as the original migration created it, so
 * a rollback restores the schema. It cannot restore rows, and there were none
 * to restore.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::dropIfExists('browser_tracking_connections');
    }

    public function down(): void
    {
        if (Schema::hasTable('browser_tracking_connections')) {
            return;
        }

        // Column for column with the 2026_04_21 create migration, so a rollback
        // lands on the schema that existed before, not an approximation of it.
        Schema::create('browser_tracking_connections', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('device_id', 120);
            $table->string('device_label')->nullable();
            $table->string('browser_name', 40);
            $table->string('browser_profile_key', 120);
            $table->string('extension_version', 40)->nullable();
            $table->string('status', 40)->default('connected');
            $table->timestamp('connected_at')->nullable();
            $table->timestamp('last_seen_at')->nullable();
            $table->timestamp('last_sync_at')->nullable();
            $table->timestamp('disconnected_at')->nullable();
            $table->string('disconnect_reason')->nullable();
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->unique(
                ['user_id', 'device_id', 'browser_name', 'browser_profile_key'],
                'browser_tracking_unique_connection'
            );
            $table->index(['organization_id', 'user_id', 'status']);
        });
    }
};
