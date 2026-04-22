<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('activity_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('time_entry_id')->nullable()->constrained('time_entries')->nullOnDelete();
            $table->string('source', 40);
            $table->string('activity_kind', 40);
            $table->string('tool_type', 40);
            $table->string('display_name');
            $table->string('app_name')->nullable();
            $table->string('window_title')->nullable();
            $table->text('url')->nullable();
            $table->string('normalized_label')->nullable();
            $table->string('normalized_domain')->nullable();
            $table->string('software_name')->nullable();
            $table->string('classification', 40)->nullable();
            $table->string('classification_reason')->nullable();
            $table->timestamp('started_at');
            $table->timestamp('ended_at')->nullable();
            $table->unsignedInteger('duration_seconds')->default(0);
            $table->unsignedSmallInteger('confidence')->default(100);
            $table->json('metadata')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'started_at']);
            $table->index(['time_entry_id', 'started_at']);
            $table->index(['activity_kind', 'started_at']);
            $table->index(['classification', 'started_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activity_sessions');
    }
};
