<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('task_recurrences', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->nullable()->constrained()->nullOnDelete();
            $table->string('template_title', 255);
            $table->text('template_description')->nullable();
            $table->foreignId('template_group_id')->nullable()->constrained('groups')->nullOnDelete();
            $table->foreignId('template_project_id')->nullable()->constrained('projects')->nullOnDelete();
            $table->string('template_priority', 20)->default('medium');
            $table->unsignedInteger('template_estimated_time')->nullable();
            $table->json('template_assignee_ids')->nullable();
            $table->json('template_label_ids')->nullable();
            $table->string('frequency', 20)->default('weekly');
            $table->unsignedInteger('interval_value')->default(1);
            $table->json('days_of_week')->nullable();
            $table->unsignedInteger('day_of_month')->nullable();
            $table->date('start_date');
            $table->date('end_date')->nullable();
            $table->date('next_run_date');
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_recurrences');
    }
};
