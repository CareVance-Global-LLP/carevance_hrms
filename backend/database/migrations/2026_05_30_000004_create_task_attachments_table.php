<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('task_attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('filename', 255);
            $table->string('original_filename', 255);
            $table->string('mime_type', 127)->nullable();
            $table->unsignedInteger('file_size')->nullable();
            $table->timestamps();

            $table->index(['task_id', 'created_at'], 'task_attachments_task_created_idx');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_attachments');
    }
};
