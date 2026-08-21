<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Date-based rostering.
 *
 * Shift DEFINITIONS already existed and are real - night windows,
 * differentials, overtime multipliers, grace periods - and `employee_shifts`
 * assigns one to somebody from a date. What was missing is the calendar: which
 * shift a named person works on a named day.
 *
 * AN OFF DAY IS A ROW, NOT A MISSING ROW. `roster_days` with a null shift_id
 * means "rostered, and off"; no row at all means "not rostered". Those are
 * different facts and the difference is the whole point of publishing a roster
 * - somebody who has been given the day off has been told something, and
 * somebody nobody has scheduled has not.
 *
 * DRAFT AND PUBLISHED ARE DIFFERENT THINGS. A roster nobody has seen is not a
 * roster. ShiftResolver reads only published days, so a manager can build next
 * month without changing what attendance expects of anybody today.
 *
 * REGENERATING MUST NOT WIPE A DECISION. `source` separates rows a pattern
 * produced from rows a human set, and regeneration replaces only its own.
 * Somebody who moved one person to nights on the 14th must not lose that
 * because the rota was rebuilt.
 */
return new class extends Migration
{
    public function up(): void
    {
        /*
         * A repeating pattern: five earlies then two off, five nights then two
         * off, and so on. Length is in days rather than weeks because plenty of
         * real rotas are not seven-day - a 4-on-4-off runs on an eight-day
         * cycle and a week-based model cannot express it at all.
         */
        Schema::create('shift_rotations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

            $table->string('name');
            $table->string('description')->nullable();
            $table->unsignedSmallInteger('cycle_length_days');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'is_active']);
        });

        Schema::create('shift_rotation_steps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('shift_rotation_id')->constrained('shift_rotations')->cascadeOnDelete();

            // Zero-based day within the cycle.
            $table->unsignedSmallInteger('position');

            /*
             * Null is a REST DAY, and deliberately so rather than a separate
             * boolean. A rotation is a sequence of "what you are doing", and
             * "nothing" is one of the things you can be doing.
             */
            $table->foreignId('shift_id')->nullable()->constrained('shifts')->nullOnDelete();

            $table->timestamps();

            $table->unique(['shift_rotation_id', 'position']);
        });

        /*
         * Who is on which rotation, and from when. Effective-dated like every
         * other assignment in this codebase, so changing somebody's rota next
         * month does not rewrite what they worked last month.
         */
        Schema::create('employee_shift_rotations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('shift_rotation_id')->constrained('shift_rotations')->cascadeOnDelete();

            $table->date('effective_from');
            $table->date('effective_to')->nullable();

            /*
             * Where in the cycle this person starts. Two people on the same
             * five-on-two-off rota are usually offset so the site is covered
             * every day; without this they would all rest together.
             */
            $table->unsignedSmallInteger('start_offset')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['organization_id', 'user_id', 'effective_from']);
        });

        Schema::create('roster_days', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();

            $table->date('roster_date');
            // Null means rostered OFF - see the file docblock.
            $table->foreignId('shift_id')->nullable()->constrained('shifts')->nullOnDelete();

            // draft | published
            $table->string('status', 12)->default('draft');

            // generated | manual | swap
            $table->string('source', 12)->default('generated');
            $table->foreignId('shift_rotation_id')->nullable()->constrained('shift_rotations')->nullOnDelete();

            $table->string('note')->nullable();
            $table->timestamp('published_at')->nullable();
            $table->foreignId('published_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            // One roster entry per person per day. A second is an edit, not
            // another shift.
            $table->unique(['user_id', 'roster_date']);
            $table->index(['organization_id', 'roster_date', 'status']);
        });

        /*
         * Two people trading days.
         *
         * Both roster days are named, so a swap is a concrete exchange rather
         * than a request to "cover Tuesday" that somebody has to interpret. It
         * needs the other person to agree AND a manager to approve: one person
         * cannot give away their shift, and two people cannot rewrite the
         * site's cover between them.
         */
        Schema::create('shift_swap_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();

            $table->foreignId('requested_by')->constrained('users')->cascadeOnDelete();
            $table->foreignId('requested_with')->constrained('users')->cascadeOnDelete();

            $table->foreignId('requester_roster_day_id')->constrained('roster_days')->cascadeOnDelete();
            $table->foreignId('counterparty_roster_day_id')->constrained('roster_days')->cascadeOnDelete();

            // pending_counterparty | pending_approval | approved | declined | cancelled
            $table->string('status', 24)->default('pending_counterparty');

            $table->string('reason')->nullable();
            $table->string('decline_reason')->nullable();

            $table->timestamp('accepted_at')->nullable();
            $table->foreignId('approved_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();

            $table->index(['organization_id', 'status']);
        });

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE roster_days ADD CONSTRAINT roster_days_status_check "
                ."CHECK (status IN ('draft', 'published'))");
            DB::statement("ALTER TABLE roster_days ADD CONSTRAINT roster_days_source_check "
                ."CHECK (source IN ('generated', 'manual', 'swap'))");
            DB::statement("ALTER TABLE shift_swap_requests ADD CONSTRAINT shift_swap_status_check "
                ."CHECK (status IN ('pending_counterparty', 'pending_approval', 'approved', 'declined', 'cancelled'))");

            // A cycle of zero days never advances and would loop forever in any
            // generator that trusted it.
            DB::statement('ALTER TABLE shift_rotations ADD CONSTRAINT shift_rotations_cycle_check '
                .'CHECK (cycle_length_days > 0)');

            // Trading a day with yourself is not a swap.
            DB::statement('ALTER TABLE shift_swap_requests ADD CONSTRAINT shift_swap_distinct_check '
                .'CHECK (requested_by <> requested_with)');
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('shift_swap_requests');
        Schema::dropIfExists('roster_days');
        Schema::dropIfExists('employee_shift_rotations');
        Schema::dropIfExists('shift_rotation_steps');
        Schema::dropIfExists('shift_rotations');
    }
};
