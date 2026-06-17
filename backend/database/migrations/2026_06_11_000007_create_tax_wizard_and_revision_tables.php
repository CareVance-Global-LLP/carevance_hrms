<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('tax_wizard_sessions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('financial_year', 9)->nullable();
            $table->string('current_step')->default('personal_info');
            $table->json('step_data')->nullable();
            $table->string('tax_regime')->nullable(); // old, new
            $table->decimal('estimated_tax_old', 12, 2)->nullable();
            $table->decimal('estimated_tax_new', 12, 2)->nullable();
            $table->string('status')->default('in_progress'); // in_progress, completed, verified
            $table->timestamps();

            $table->unique(['user_id', 'financial_year']);
            $table->index(['organization_id', 'status']);
        });

        Schema::create('salary_revision_letters', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->decimal('old_ctc', 12, 2);
            $table->decimal('new_ctc', 12, 2);
            $table->decimal('revision_percentage', 5, 2);
            $table->string('revision_type'); // annual_increment, promotion, correction, other
            $table->date('effective_from');
            $table->text('reason')->nullable();
            $table->json('old_breakdown')->nullable();
            $table->json('new_breakdown')->nullable();
            $table->string('letter_file_path')->nullable();
            $table->string('status')->default('draft'); // draft, generated, accepted, rejected
            $table->timestamp('accepted_at')->nullable();
            $table->timestamp('rejected_at')->nullable();
            $table->foreignId('generated_by')->constrained('users')->cascadeOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'user_id']);
            $table->index(['organization_id', 'status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('salary_revision_letters');
        Schema::dropIfExists('tax_wizard_sessions');
    }
};
