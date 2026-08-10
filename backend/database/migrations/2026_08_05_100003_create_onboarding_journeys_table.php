<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * An onboarding journey exists before the employee does.
 *
 * The work that decides whether Day 1 goes well — documents, equipment,
 * accounts — all happens before anyone has an account to log into, so
 * `user_id` is nullable and the journey can be anchored to an invitation
 * instead. It is linked to the user the moment the account is created.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('onboarding_journeys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained('organizations')->cascadeOnDelete();

            $table->foreignId('user_id')->nullable()->constrained('users')->cascadeOnDelete();
            $table->foreignId('invitation_id')->nullable()->constrained('invitations')->nullOnDelete();

            $table->string('candidate_name');
            $table->string('candidate_email');
            $table->string('job_title')->nullable();

            // The anchor. Every due date on the journey is computed from this.
            $table->date('joining_date');

            $table->foreignId('group_id')->nullable()->constrained('groups')->nullOnDelete();
            $table->foreignId('manager_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('buddy_id')->nullable()->constrained('users')->nullOnDelete();

            $table->enum('stage', ['preboarding', 'day_one', 'onboarding', 'completed', 'cancelled'])
                ->default('preboarding');
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->text('notes')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'stage']);
            $table->index(['organization_id', 'joining_date']);
            $table->index('user_id');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('onboarding_journeys');
    }
};
