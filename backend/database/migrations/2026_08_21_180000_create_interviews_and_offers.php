<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Interviews, panel feedback, and offers.
 *
 * FEEDBACK IS PER INTERVIEWER, NEVER AGGREGATED INTO THE INTERVIEW. A panel of
 * three that splits two-to-one is the most important signal in a hiring
 * decision, and a single verdict column on the interview destroys it. The
 * recommendation on `interviews` is the panel's agreed outcome, written after
 * the fact; the individual views live in `interview_feedback` and are kept.
 *
 * AN OFFER IS AN AMOUNT PLUS AN APPROVAL CHAIN. The amount alone is not an
 * offer — somebody has to agree to spend it, and in most organizations that is
 * not the person who typed it. `offer_approvals` is that chain, and an offer
 * cannot be sent until it is complete.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('interviews', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('job_application_id')->constrained('job_applications')->cascadeOnDelete();
            // Which stage this interview belongs to, so a two-round process
            // does not merge into one undifferentiated pile of feedback.
            $table->foreignId('hiring_stage_id')->nullable()->constrained('hiring_stages')->nullOnDelete();

            $table->string('title')->nullable();
            // phone | video | onsite | take_home
            $table->string('mode', 20)->default('video');
            $table->string('location_or_link')->nullable();

            $table->timestamp('scheduled_at');
            $table->unsignedSmallInteger('duration_minutes')->default(60);

            // scheduled | completed | cancelled | no_show
            $table->string('status', 20)->default('scheduled');

            /*
             * The panel's agreed outcome, written after the fact. Nullable
             * because an interview that has not happened has no verdict, and
             * defaulting it to anything would let an unheld interview read as a
             * decision.
             */
            $table->string('recommendation', 20)->nullable();

            $table->foreignId('scheduled_by')->nullable()->constrained('users')->nullOnDelete();
            $table->text('cancellation_reason')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'scheduled_at']);
            $table->index(['job_application_id', 'scheduled_at']);
        });

        /*
         * Who is on the panel. Separate from feedback because being invited and
         * having submitted are different states, and "two of three have
         * responded" is a question a recruiter asks constantly.
         */
        Schema::create('interview_panellists', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('interview_id')->constrained('interviews')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->boolean('is_lead')->default(false);
            $table->timestamps();

            $table->unique(['interview_id', 'user_id']);
        });

        Schema::create('interview_feedback', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('interview_id')->constrained('interviews')->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            // strong_yes | yes | no | strong_no
            $table->string('verdict', 20);
            // 1-5, optional. Some panels score, some only recommend.
            $table->unsignedTinyInteger('rating')->nullable();
            $table->text('notes')->nullable();

            $table->timestamp('submitted_at')->nullable();
            $table->timestamps();

            // One verdict per interviewer per interview. Editing yours replaces
            // it; you do not get two votes.
            $table->unique(['interview_id', 'user_id']);
        });

        Schema::create('job_offers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('job_application_id')->constrained('job_applications')->cascadeOnDelete();
            $table->foreignId('legal_entity_id')->nullable()->constrained('legal_entities')->nullOnDelete();

            $table->string('designation');
            /*
             * Money, as decimal. Never float — the same rule the rest of this
             * codebase follows, and an offer is the number a payroll template
             * is later built from.
             */
            $table->decimal('annual_ctc', 12, 2);
            $table->decimal('joining_bonus', 12, 2)->nullable();

            $table->date('proposed_joining_date')->nullable();

            /*
             * draft | pending_approval | approved | sent | accepted | declined
             * | withdrawn | expired
             *
             * `sent` and `accepted` are separate states on purpose: an offer
             * out with a candidate is a commitment the business has made and
             * cannot quietly retract, and a headcount report that cannot tell
             * the two apart under-counts what has already been spent.
             */
            $table->string('status', 24)->default('draft');

            $table->date('valid_until')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->timestamp('responded_at')->nullable();
            $table->text('decline_reason')->nullable();

            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // One live offer per candidacy. A second one is a revision, and
            // revisions supersede rather than accumulate.
            $table->index(['organization_id', 'status']);
            $table->index('job_application_id');
        });

        /*
         * Who has to agree before an offer may be sent.
         *
         * Rows are created when the offer is submitted for approval, so the
         * chain is a record of who was ASKED as well as who answered. Deriving
         * approvers at read time would lose that, and "nobody ever asked
         * finance" is exactly the finding an audit is looking for.
         */
        Schema::create('offer_approvals', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('job_offer_id')->constrained('job_offers')->cascadeOnDelete();
            $table->foreignId('approver_id')->constrained('users')->cascadeOnDelete();

            $table->unsignedSmallInteger('position')->default(0);
            // pending | approved | rejected
            $table->string('status', 20)->default('pending');
            $table->text('note')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();

            $table->unique(['job_offer_id', 'approver_id']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE interviews ADD CONSTRAINT interviews_status_check "
                ."CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show'))");
            DB::statement("ALTER TABLE interviews ADD CONSTRAINT interviews_recommendation_check "
                ."CHECK (recommendation IS NULL OR recommendation IN ('strong_yes', 'yes', 'no', 'strong_no'))");
            DB::statement("ALTER TABLE interview_feedback ADD CONSTRAINT interview_feedback_verdict_check "
                ."CHECK (verdict IN ('strong_yes', 'yes', 'no', 'strong_no'))");
            DB::statement('ALTER TABLE interview_feedback ADD CONSTRAINT interview_feedback_rating_check '
                .'CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5))');
            DB::statement("ALTER TABLE job_offers ADD CONSTRAINT job_offers_status_check "
                ."CHECK (status IN ('draft', 'pending_approval', 'approved', 'sent', 'accepted', 'declined', 'withdrawn', 'expired'))");
            // An offer worth nothing is a data-entry slip, not a policy.
            DB::statement('ALTER TABLE job_offers ADD CONSTRAINT job_offers_ctc_check CHECK (annual_ctc > 0)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('offer_approvals');
        Schema::dropIfExists('job_offers');
        Schema::dropIfExists('interview_feedback');
        Schema::dropIfExists('interview_panellists');
        Schema::dropIfExists('interviews');
    }
};
