<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('review_cycles', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->onDelete('cascade');
            $table->string('name');
            $table->date('period_start');
            $table->date('period_end');
            $table->date('self_due')->nullable();
            $table->date('manager_due')->nullable();
            $table->date('share_date')->nullable();
            $table->string('phase')->default('draft'); // draft, self, manager, shared, closed
            $table->boolean('anonymize_peer')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'phase']);
        });

        Schema::create('review_cycle_participants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('review_cycle_id')->constrained('review_cycles')->onDelete('cascade');
            $table->foreignId('employee_id')->constrained('users')->onDelete('cascade');
            $table->foreignId('self_review_id')->nullable()->constrained('performance_reviews')->onDelete('set null');
            $table->foreignId('manager_review_id')->nullable()->constrained('performance_reviews')->onDelete('set null');
            $table->timestamp('shared_at')->nullable();
            $table->timestamp('acknowledged_at')->nullable();
            $table->timestamps();

            $table->unique(['review_cycle_id', 'employee_id']);
        });

        Schema::create('competencies', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->onDelete('cascade');
            $table->string('name');
            $table->text('description')->nullable();
            $table->integer('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });

        Schema::create('review_competency_ratings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('review_id')->constrained('performance_reviews')->onDelete('cascade');
            $table->foreignId('competency_id')->constrained('competencies')->onDelete('cascade');
            $table->unsignedTinyInteger('rating'); // 1-5
            $table->text('comment')->nullable();
            $table->timestamps();

            $table->unique(['review_id', 'competency_id']);
        });

        Schema::table('performance_reviews', function (Blueprint $table) {
            $table->foreignId('review_cycle_id')->nullable()->after('goal_id')
                ->constrained('review_cycles')->onDelete('set null');
        });
    }

    public function down(): void
    {
        Schema::table('performance_reviews', function (Blueprint $table) {
            $table->dropConstrainedForeignId('review_cycle_id');
        });
        Schema::dropIfExists('review_competency_ratings');
        Schema::dropIfExists('competencies');
        Schema::dropIfExists('review_cycle_participants');
        Schema::dropIfExists('review_cycles');
    }
};
