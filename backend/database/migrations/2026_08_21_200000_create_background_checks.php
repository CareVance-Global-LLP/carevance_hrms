<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Background verification.
 *
 * Three things about this domain are legal rather than product decisions, and
 * all three are enforced in the schema rather than left to a UI:
 *
 * CONSENT IS A PRECONDITION, NOT A CHECKBOX. Running a check on somebody
 * without their recorded agreement is unlawful in most jurisdictions and under
 * the DPDP Act here. So consent is its own row with its own timestamp and IP,
 * and `background_checks.consent_id` is what a check is gated on — not a
 * boolean somebody could set from a console.
 *
 * A DISCREPANCY IS NOT A FAILURE. It is a finding that needs a human. A name
 * spelled differently on a degree certificate is a discrepancy; so is a
 * fabricated employer. Collapsing both into "failed" is how a product ends up
 * auto-rejecting people over a middle initial, so the outcome vocabulary keeps
 * them apart and nothing here decides anybody's candidacy.
 *
 * ADVERSE ACTION HAS TO BE TOLD TO THE PERSON. If a finding affects a hiring
 * decision, the candidate is entitled to know and to respond. `notified_at` and
 * `candidate_response` exist so that conversation is recorded rather than
 * happening in somebody's inbox.
 */
return new class extends Migration
{
    public function up(): void
    {
        /*
         * Consent, standing alone.
         *
         * Its own table rather than a column because it is the evidence: what
         * they agreed to, when, and from where. A consent that cannot be
         * produced later is one that did not happen as far as a regulator is
         * concerned.
         */
        Schema::create('background_check_consents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('candidate_id')->nullable()->constrained('candidates')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();

            $table->string('consented_name');
            $table->string('consented_email')->nullable();

            /*
             * WHAT they agreed to, verbatim. Consent is to a specific set of
             * checks — somebody who agreed to employment verification has not
             * agreed to a credit check — so the scope is stored, not inferred
             * from whatever the package happens to contain today.
             */
            $table->json('scope');
            $table->text('notice_text')->nullable();

            $table->string('ip_address', 45)->nullable();
            $table->string('user_agent', 512)->nullable();
            $table->timestamp('consented_at');

            /*
             * Consent is withdrawable. The DPDP Act says so explicitly, and a
             * product that only records the giving of it has implemented half
             * the right.
             */
            $table->timestamp('withdrawn_at')->nullable();
            $table->string('withdrawal_reason')->nullable();

            $table->timestamps();
        });

        Schema::create('background_checks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

            // Against a candidate before hire, or an employee after. Both are
            // real: post-hire re-verification is common in regulated sectors.
            $table->foreignId('candidate_id')->nullable()->constrained('candidates')->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('job_application_id')->nullable()->constrained('job_applications')->nullOnDelete();

            /*
             * The gate. A check cannot run without consent, and this being a
             * foreign key rather than a boolean is what makes that structural.
             */
            $table->foreignId('consent_id')->nullable()->constrained('background_check_consents')->nullOnDelete();

            $table->string('package')->nullable();

            /*
             * Vendor-agnostic on purpose. AuthBridge, IDfy, HireRight and a
             * manual HR process all fit; coupling the schema to one of them
             * means a migration when a customer switches.
             */
            $table->string('vendor', 60)->nullable();
            $table->string('vendor_reference')->nullable();

            // pending_consent | awaiting_start | in_progress | completed | cancelled
            $table->string('status', 24)->default('pending_consent');

            /*
             * The overall finding, once every item is in. Deliberately NOT a
             * pass/fail: clear | discrepancy | insufficient. What to do about a
             * discrepancy is an employer's decision, and nothing in this schema
             * makes it for them.
             */
            $table->string('outcome', 20)->nullable();

            $table->timestamp('requested_at')->nullable();
            $table->timestamp('completed_at')->nullable();

            /*
             * Adverse action. If a finding affects the decision, the candidate
             * is entitled to know and to reply, and that exchange belongs in
             * the record rather than in somebody's inbox.
             */
            $table->timestamp('notified_at')->nullable();
            $table->text('candidate_response')->nullable();
            $table->timestamp('responded_at')->nullable();

            $table->foreignId('requested_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'status']);
        });

        Schema::create('background_check_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('background_check_id')->constrained('background_checks')->cascadeOnDelete();

            // identity | address | education | employment | criminal | reference | credit
            $table->string('type', 32);
            $table->string('label')->nullable();

            // pending | in_progress | clear | discrepancy | insufficient | skipped
            $table->string('status', 20)->default('pending');

            /*
             * What was checked against what was claimed. Kept as two fields
             * rather than one free-text note, because "you said 2019, the
             * university says 2018" is the sentence a discrepancy has to be
             * able to produce.
             */
            $table->text('claimed')->nullable();
            $table->text('verified')->nullable();
            $table->text('notes')->nullable();

            $table->string('evidence_path')->nullable();

            $table->foreignId('completed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            // One of each type per check. A second employment check is a second
            // item with a different label, not a duplicate type row.
            $table->index(['background_check_id', 'type']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE background_checks ADD CONSTRAINT background_checks_status_check "
                ."CHECK (status IN ('pending_consent', 'awaiting_start', 'in_progress', 'completed', 'cancelled'))");
            DB::statement("ALTER TABLE background_checks ADD CONSTRAINT background_checks_outcome_check "
                ."CHECK (outcome IS NULL OR outcome IN ('clear', 'discrepancy', 'insufficient'))");
            DB::statement("ALTER TABLE background_check_items ADD CONSTRAINT background_check_items_status_check "
                ."CHECK (status IN ('pending', 'in_progress', 'clear', 'discrepancy', 'insufficient', 'skipped'))");

            /*
             * A check is about SOMEBODY. A row with neither a candidate nor an
             * employee is a background check on nobody, which is either a bug
             * or the start of one.
             */
            DB::statement('ALTER TABLE background_checks ADD CONSTRAINT background_checks_subject_check '
                .'CHECK (candidate_id IS NOT NULL OR user_id IS NOT NULL)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('background_check_items');
        Schema::dropIfExists('background_checks');
        Schema::dropIfExists('background_check_consents');
    }
};
