<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('polls', function (Blueprint $table) {
            $table->id();
            $table->foreignId('app_notification_id')->constrained()->cascadeOnDelete();
            $table->string('question');
            $table->timestamp('expires_at')->nullable();
            $table->boolean('is_multiple_choice')->default(false);
            $table->timestamps();

            $table->index('app_notification_id');
            $table->index('expires_at');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('polls');
    }
};