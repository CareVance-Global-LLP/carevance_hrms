<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
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

    public function down(): void
    {
        Schema::dropIfExists('browser_tracking_connections');
    }
};
