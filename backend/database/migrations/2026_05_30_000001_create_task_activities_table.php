<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('task_activities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 50);
            $table->string('description', 500);
            $table->json('meta')->nullable();
            $table->timestamps();

            $table->index(['task_id', 'created_at'], 'task_activities_task_created_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_activities');
    }
};
