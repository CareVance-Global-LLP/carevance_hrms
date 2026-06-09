<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('performance_goals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->onDelete('cascade');
            $table->foreignId('employee_id')->constrained('users')->onDelete('cascade');
            $table->foreignId('manager_id')->constrained('users')->onDelete('cascade');
            $table->string('title');
            $table->text('description')->nullable();
            $table->string('category'); // development, performance, behavior, project
            $table->date('start_date');
            $table->date('end_date');
            $table->json('target_metrics')->nullable();
            $table->integer('weight')->default(100); // Weight percentage
            $table->integer('progress_percentage')->default(0);
            $table->string('status')->default('active'); // active, completed, cancelled
            $table->timestamps();
            
            $table->index(['employee_id', 'status']);
            $table->index(['organization_id', 'status']);
        });

        Schema::create('performance_reviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->onDelete('cascade');
            $table->foreignId('employee_id')->constrained('users')->onDelete('cascade');
            $table->foreignId('reviewer_id')->constrained('users')->onDelete('cascade');
            $table->foreignId('goal_id')->nullable()->constrained('performance_goals')->onDelete('set null');
            $table->string('review_type'); // self, manager, peer, 360
            $table->date('review_period_start');
            $table->date('review_period_end');
            $table->integer('overall_rating')->nullable(); // 1-5 scale
            $table->json('strengths')->nullable();
            $table->json('areas_for_improvement')->nullable();
            $table->json('goals')->nullable();
            $table->text('comments')->nullable();
            $table->boolean('is_confidential')->default(false);
            $table->string('status')->default('draft'); // draft, completed, archived
            $table->timestamps();
            
            $table->index(['employee_id', 'review_period_end']);
            $table->index(['reviewer_id', 'status']);
            $table->index(['organization_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('performance_reviews');
        Schema::dropIfExists('performance_goals');
    }
};
