<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Recruitment: openings, candidates, applications and a pipeline.
 *
 * `job_openings`, not `jobs` — Laravel's queue owns that table name, and a
 * collision here would be discovered by the queue worker rather than by a test.
 *
 * THE CENTRAL DISTINCTION is candidate vs application. A candidate is a
 * PERSON; an application is that person's candidacy for ONE opening. Collapsing
 * them into one row is the mistake every first-cut ATS makes, and it breaks the
 * moment somebody good applies for a second role — you either lose their
 * history or duplicate the human.
 *
 * A STAGE MOVE IS AN EVENT, NOT A COLUMN. `job_applications.hiring_stage_id`
 * says where somebody is now; `application_stage_events` says how they got
 * there and when. "Why has this person been in screening for three weeks" is
 * the question a hiring manager actually asks, and a current-stage column alone
 * cannot answer it. Same reasoning as the leave ledger.
 */
return new class extends Migration
{
    public function up(): void
    {
        /*
         * The pipeline, per organization. Configurable because a startup runs
         * three stages and an enterprise runs eight, and hard-coding either
         * makes the product wrong for the other.
         */
        Schema::create('hiring_stages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

            $table->string('name');
            $table->string('slug', 60);
            $table->unsignedSmallInteger('position')->default(0);

            /*
             * screening | interview | offer | hired | rejected.
             *
             * The product needs to know what a stage MEANS, not just its name:
             * an interview stage schedules interviews, an offer stage creates
             * an offer. A customer renaming "Interview" to "Tech Round" must
             * not break either.
             */
            $table->string('kind', 20)->default('screening');

            // A terminal stage ends the pipeline. Nothing moves out of one.
            $table->boolean('is_terminal')->default(false);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->unique(['organization_id', 'slug']);
            $table->index(['organization_id', 'position']);
        });

        Schema::create('job_openings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            // Which company actually employs the hire — it decides the PAN the
            // eventual payroll files under.
            $table->foreignId('legal_entity_id')->nullable()->constrained('legal_entities')->nullOnDelete();
            // Departments are `groups` in this codebase, reached through
            // employee_work_infos.report_group_id.
            $table->foreignId('group_id')->nullable()->constrained('groups')->nullOnDelete();

            // Human-facing reference, e.g. REQ-14. Unique per organization so
            // two customers can both have REQ-1.
            $table->string('code', 40);
            $table->string('title');
            $table->text('description')->nullable();

            $table->string('employment_type', 32)->default('full_time');
            $table->string('location')->nullable();
            $table->boolean('is_remote')->default(false);
            $table->unsignedSmallInteger('openings_count')->default(1);

            /*
             * A band, not a number, and nullable throughout. An opening with no
             * budget agreed yet is normal; storing zero would read as "this job
             * pays nothing" on every screen that formats it.
             */
            $table->decimal('min_ctc', 12, 2)->nullable();
            $table->decimal('max_ctc', 12, 2)->nullable();

            // draft | open | on_hold | closed | filled
            $table->string('status', 20)->default('draft');

            $table->foreignId('hiring_manager_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('recruiter_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

            $table->date('opened_at')->nullable();
            $table->date('closed_at')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'code']);
            $table->index(['organization_id', 'status']);
        });

        Schema::create('candidates', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

            $table->string('first_name');
            $table->string('last_name')->nullable();
            $table->string('email');
            $table->string('phone', 32)->nullable();

            $table->string('resume_path')->nullable();
            $table->string('linkedin_url')->nullable();

            // referral | portal | agency | direct | inbound
            $table->string('source', 32)->default('direct');
            // Who referred them, where an employee referral scheme exists.
            $table->foreignId('referred_by')->nullable()->constrained('users')->nullOnDelete();

            $table->string('current_company')->nullable();
            $table->decimal('current_ctc', 12, 2)->nullable();
            $table->decimal('expected_ctc', 12, 2)->nullable();
            $table->unsignedSmallInteger('notice_period_days')->nullable();
            $table->string('location')->nullable();

            $table->timestamps();

            /*
             * Unique per ORGANIZATION, deliberately unlike `users.email` which
             * is globally unique. The same person legitimately applies to two
             * different customers on this platform, and a global constraint
             * would let one customer's pipeline block another's.
             */
            $table->unique(['organization_id', 'email']);
        });

        Schema::create('job_applications', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('job_opening_id')->constrained('job_openings')->cascadeOnDelete();
            $table->foreignId('candidate_id')->constrained('candidates')->cascadeOnDelete();
            $table->foreignId('hiring_stage_id')->nullable()->constrained('hiring_stages')->nullOnDelete();

            // active | rejected | withdrawn | hired
            $table->string('status', 20)->default('active');

            $table->timestamp('applied_at')->nullable();

            /*
             * A rejection always carries a reason and a date. An application
             * that simply stops moving tells a candidate nothing and tells an
             * auditor less; several jurisdictions expect a record of why.
             */
            $table->string('rejection_reason')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();

            $table->timestamps();

            // One candidacy per person per opening. Re-applying to the SAME
            // role is an update to the existing application, not a second one.
            $table->unique(['job_opening_id', 'candidate_id']);
            $table->index(['organization_id', 'status']);
            $table->index(['organization_id', 'hiring_stage_id']);
        });

        /*
         * How somebody moved through the pipeline, and when.
         *
         * Append-only by intent. The current stage lives on the application;
         * this is the history that explains it.
         */
        Schema::create('application_stage_events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('job_application_id')->constrained('job_applications')->cascadeOnDelete();

            $table->foreignId('from_stage_id')->nullable()->constrained('hiring_stages')->nullOnDelete();
            $table->foreignId('to_stage_id')->nullable()->constrained('hiring_stages')->nullOnDelete();

            // applied | advanced | moved_back | rejected | withdrawn | hired
            $table->string('action', 20)->default('advanced');
            $table->string('note')->nullable();

            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['job_application_id', 'created_at']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE job_openings ADD CONSTRAINT job_openings_status_check "
                ."CHECK (status IN ('draft', 'open', 'on_hold', 'closed', 'filled'))");
            DB::statement("ALTER TABLE job_applications ADD CONSTRAINT job_applications_status_check "
                ."CHECK (status IN ('active', 'rejected', 'withdrawn', 'hired'))");
            DB::statement("ALTER TABLE hiring_stages ADD CONSTRAINT hiring_stages_kind_check "
                ."CHECK (kind IN ('screening', 'interview', 'offer', 'hired', 'rejected'))");

            /*
             * A band that runs backwards is a data-entry slip that silently
             * mis-sorts every salary filter built on it later.
             */
            DB::statement('ALTER TABLE job_openings ADD CONSTRAINT job_openings_ctc_band_check '
                .'CHECK (min_ctc IS NULL OR max_ctc IS NULL OR min_ctc <= max_ctc)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('application_stage_events');
        Schema::dropIfExists('job_applications');
        Schema::dropIfExists('candidates');
        Schema::dropIfExists('job_openings');
        Schema::dropIfExists('hiring_stages');
    }
};
