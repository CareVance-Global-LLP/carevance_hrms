<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Working time, split into the four policies that were living on the shift row.
 *
 * WHY THIS EXISTS
 * ---------------
 * `shifts` currently carries grace_period_minutes, early_exit_grace_minutes,
 * overtime_multiplier and six differential columns. That collapses five
 * independent decisions into one row, so two teams working identical timings
 * cannot have different late rules without duplicating the shift — and every
 * duplicate then has to be kept in step by hand. The documented model in this
 * market treats them as separately created, separately versioned, separately
 * assigned objects:
 *
 *   1. Shift                  timings and breaks              (already exists)
 *   2. Weekly Off policy      which days are off              (this migration)
 *   3. Time Tracking policy   capture + regularisation        (not yet built)
 *   4. Penalisation policy    grace, late rules, LOP          (this migration)
 *   5. Shift Allowance policy night / weekend premium         (this migration)
 *
 * plus Overtime, which is its own policy for the same reason.
 *
 * NOTHING IS DROPPED. The shift columns stay exactly where they are and keep
 * working as the fallback for an organization that has configured no policy.
 * Policy wins when one is assigned; the shift column answers otherwise. A
 * migration that dropped them would silently zero every grace period and
 * overtime multiplier already in production.
 *
 * WEEKLY OFF: HOW "2ND AND 4TH SATURDAY" IS REPRESENTED
 * -----------------------------------------------------
 * Seven booleans cannot express it, and it is near-universal in Indian
 * companies. `weekly_off_policies.day_rules` is a JSON object keyed by weekday,
 * each key holding one rule:
 *
 *   {
 *     "sunday":   "every",
 *     "saturday": [2, 4]
 *   }
 *
 * Keys accept ISO numbers as strings ("1" = Monday … "7" = Sunday, and "0" is
 * read as Sunday too), full day names, or three/two-letter abbreviations. The
 * model normalises them to ISO on read, so a hand-edited row does not have to
 * guess the house convention.
 *
 * Three rule shapes, and the difference between them is load-bearing:
 *
 *   "every"                      that weekday is off, every week.
 *
 *   [2, 4]  /  [2, "last"]       ORDINAL WITHIN THE CALENDAR MONTH. The nth
 *                                occurrence of that weekday in the month the
 *                                date falls in: ordinal = ((day - 1) / 7) + 1.
 *                                "last" is the final occurrence, which is NOT
 *                                the same rule as 5 — August 2026 has five
 *                                Saturdays (1, 8, 15, 22, 29) so "last" is the
 *                                29th, while February 2026 has four (7, 14, 21,
 *                                28) so a literal 5 matches nothing and "last"
 *                                is the 28th.
 *
 *   {"mode": "alternate",        A CONTINUOUS every-nth-week count anchored to
 *    "interval_weeks": 2,        a real date, which does NOT reset at the month
 *    "anchor_date": "2026-08-01"} boundary. Off when the whole weeks elapsed
 *                                since the anchor divide by interval_weeks.
 *                                Some employers genuinely run alternate
 *                                Saturdays this way and the two schemes drift
 *                                apart in any month with five Saturdays: from
 *                                Aug 1 2026 this yields Aug 1, 15, 29 then Sep
 *                                12 and 26, where a month-ordinal rule would
 *                                have said Sep 5 and 19.
 *
 * An alternate rule with no anchor_date is inert — the day is simply never off.
 * Choosing an anchor on the policy's behalf would mark real people absent on
 * days they were told to work, and there is no safe guess.
 *
 * An absent key, or an empty day_rules, means nothing is off. That is the
 * opposite of Shift::appliesOn (where empty means "runs every day") and
 * deliberately so: the failure mode of guessing here is an entire organization
 * marked absent.
 *
 * HALF-DAY IS A LADDER, NOT A THRESHOLD
 * -------------------------------------
 * There is no single half-day threshold in the documented model. It is an
 * ordered set of (percentage of shift hours worked) -> (leaves deducted), so
 * `penalisation_half_day_rules` is a child table rather than a column. Rows are
 * read in ascending sort_order, which the service is expected to keep aligned
 * with ascending percent_of_shift_hours: the first band the day falls below is
 * the one that applies. [{25%, 1.0}, {50%, 0.5}] means "under a quarter of the
 * shift costs a full day, under half costs half a day".
 *
 * OVERTIME HAS THREE INDEPENDENT SCOPES
 * -------------------------------------
 * Working Day, Weekly Off and Holiday each choose Pay or Comp-Off with their
 * own multiplier, so they are rows in `overtime_policy_scopes`, not three sets
 * of columns. The table is deliberately NOT unique on (policy, scope): an
 * extended OT tier is another row for the same scope with a higher
 * applies_after_minutes, and a festive rate is another row with a validity
 * window in effective_from/effective_to.
 *
 * ENUM-SHAPED COLUMNS ARE PLAIN STRINGS
 * -------------------------------------
 * Laravel's enum() becomes a varchar plus a CHECK constraint on Postgres, and
 * widening one later means dropping and rebuilding that constraint on a live
 * table. These option sets are expected to grow. The allowed values are named
 * in the column comments and enforced at the request layer instead.
 *
 * ASSIGNMENT: FOUR PARALLEL TABLES, NOT ONE POLYMORPHIC ONE
 * ---------------------------------------------------------
 * See the comment above the assignment tables at the bottom of up().
 *
 * Every Schema::create is guarded. This database has drifted from its
 * migrations before, and a re-run must be a no-op rather than a 500.
 */
return new class extends Migration
{
    public function up(): void
    {
        // ------------------------------------------------------------------
        // A. Weekly off
        // ------------------------------------------------------------------
        if (! Schema::hasTable('weekly_off_policies')) {
            Schema::create('weekly_off_policies', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->text('description')->nullable();

                // The representation is documented at the top of this file.
                $table->json('day_rules')->nullable()
                    ->comment('Weekday => rule. "every" | [ordinals within the month, "last" allowed] | {mode:alternate,interval_weeks,anchor_date}');

                // The policy applied to anyone with no explicit assignment.
                // Nullable-by-absence rather than enforced here; the service
                // picks the newest default and the UI keeps it to one.
                $table->boolean('is_default')->default(false);
                $table->boolean('is_active')->default(true);
                $table->timestamps();

                $table->unique(['organization_id', 'name'], 'woff_policy_org_name_unique');
                $table->index(['organization_id', 'is_active'], 'woff_policy_org_active_idx');
            });
        }

        // ------------------------------------------------------------------
        // B. Penalisation
        // ------------------------------------------------------------------
        if (! Schema::hasTable('penalisation_policies')) {
            Schema::create('penalisation_policies', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->text('description')->nullable();

                // "Minutes before penalisation starts". This is the field that
                // moves off shifts.grace_period_minutes; the shift column stays
                // as the fallback.
                $table->integer('grace_period_minutes')->default(0);

                // incident | hours
                $table->string('late_rule_type', 20)->default('incident')
                    ->comment('incident = N late arrivals per cycle; hours = N late hours per cycle');

                // Decimal because the same column carries both readings: a
                // count of incidents (3) and a quantity of hours (1.5).
                $table->decimal('late_threshold', 6, 2)->default(0)
                    ->comment('Incidents when late_rule_type=incident, hours when =hours');

                $table->integer('exemptions_per_cycle')->default(0);

                // weekly | monthly
                $table->string('cycle', 20)->default('monthly');

                // "Ignore late arrival penalty when the employee completes the
                // desired effective/gross hours in a day."
                $table->boolean('ignore_late_when_hours_met')->default(false);

                // gross | effective. Which clock the hours rules above read.
                $table->string('hours_basis', 20)->default('effective');

                // "Working less than X hours is considered a no show." Null
                // means the organization does not run a no-show rule at all,
                // which is a different fact from a threshold of zero.
                $table->decimal('no_show_below_hours', 5, 2)->nullable();

                // One of the three documented routes a penalty reaches payroll.
                $table->boolean('treat_penalties_as_lop')->default(false);

                $table->boolean('is_default')->default(false);
                $table->boolean('is_active')->default(true);
                $table->timestamps();

                $table->unique(['organization_id', 'name'], 'pen_policy_org_name_unique');
                $table->index(['organization_id', 'is_active'], 'pen_policy_org_active_idx');
            });
        }

        if (! Schema::hasTable('penalisation_half_day_rules')) {
            Schema::create('penalisation_half_day_rules', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('penalisation_policy_id')
                    ->constrained('penalisation_policies')->cascadeOnDelete();

                $table->integer('sort_order')->default(0);

                // Percentage of the resolved shift's expected hours actually
                // worked, on the policy's hours_basis.
                $table->decimal('percent_of_shift_hours', 5, 2);

                // A leave quantity, not money — but decimal for the same reason:
                // 0.5 of a day must never become a float.
                $table->decimal('leaves_deducted', 4, 2);

                $table->timestamps();

                $table->index(['penalisation_policy_id', 'sort_order'], 'pen_halfday_policy_sort_idx');
                $table->index(['organization_id'], 'pen_halfday_org_idx');
            });
        }

        // ------------------------------------------------------------------
        // C. Overtime
        // ------------------------------------------------------------------
        if (! Schema::hasTable('overtime_policies')) {
            Schema::create('overtime_policies', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->text('description')->nullable();

                // gross | effective
                $table->string('hours_basis', 20)->default('gross');

                // Nothing accrues until the excess passes this.
                $table->integer('minimum_minutes_before_accrual')->default(0);

                // up | down | nearest, applied in rounding_increment_minutes.
                $table->string('rounding', 20)->default('nearest');
                $table->integer('rounding_increment_minutes')->default(15);

                // "Only approved hours will be considered."
                $table->boolean('requires_approval')->default(true);

                // The payroll component overtime is paid through.
                $table->string('pay_code')->nullable();

                $table->boolean('is_default')->default(false);
                $table->boolean('is_active')->default(true);
                $table->timestamps();

                $table->unique(['organization_id', 'name'], 'ot_policy_org_name_unique');
                $table->index(['organization_id', 'is_active'], 'ot_policy_org_active_idx');
            });
        }

        if (! Schema::hasTable('overtime_policy_scopes')) {
            Schema::create('overtime_policy_scopes', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('overtime_policy_id')
                    ->constrained('overtime_policies')->cascadeOnDelete();

                // working_day | weekly_off | holiday
                $table->string('scope', 20);

                // pay | comp_off
                $table->string('treatment', 20)->default('pay');

                // A rate, not an amount, but the same rule: decimal, never
                // float, so 1.5x never drifts.
                $table->decimal('multiplier', 5, 2)->default(1.00);

                // Extended OT: this row's rate applies only past this many
                // minutes of overtime. 0 is the base tier.
                $table->integer('applies_after_minutes')->default(0);

                // Validity window for a temporary rate (a festive-season
                // uplift). Null on both ends means always in force.
                //
                // date:Y-m-d on the model, never a bare date cast.
                $table->date('effective_from')->nullable();
                $table->date('effective_to')->nullable();

                $table->timestamps();

                // Deliberately not unique on (policy, scope) — see the header.
                $table->index(['overtime_policy_id', 'scope'], 'ot_scope_policy_scope_idx');
                $table->index(['organization_id'], 'ot_scope_org_idx');
            });
        }

        // ------------------------------------------------------------------
        // D. Shift allowance
        // ------------------------------------------------------------------
        if (! Schema::hasTable('shift_allowance_policies')) {
            Schema::create('shift_allowance_policies', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('name');
                $table->text('description')->nullable();

                // none | percentage | fixed. "none" rather than a nullable type
                // so "configured to pay nothing" and "not configured" stay
                // distinguishable from the row alone.
                $table->string('night_allowance_type', 20)->default('none');
                $table->decimal('night_percentage', 5, 2)->default(0);
                $table->decimal('night_fixed', 10, 2)->default(0);

                // The window that counts as night. SQL TIME: a wall-clock
                // reading with no date, because this window crosses midnight.
                // Uncast on the model for exactly the reason in Shift's
                // docblock — a Carbon pinned to today would claim 22:00→06:00
                // ends sixteen hours before it starts.
                $table->time('night_window_start')->nullable();
                $table->time('night_window_end')->nullable();

                // How much of the shift must fall inside the window before the
                // premium is earned. 0 means any overlap qualifies.
                $table->integer('night_minimum_minutes_in_window')->default(0);

                $table->string('weekend_allowance_type', 20)->default('none');
                $table->decimal('weekend_percentage', 5, 2)->default(0);
                $table->decimal('weekend_fixed', 10, 2)->default(0);

                $table->boolean('is_default')->default(false);
                $table->boolean('is_active')->default(true);
                $table->timestamps();

                $table->unique(['organization_id', 'name'], 'shift_allow_org_name_unique');
                $table->index(['organization_id', 'is_active'], 'shift_allow_org_active_idx');
            });
        }

        // ------------------------------------------------------------------
        // E. Assignment
        // ------------------------------------------------------------------
        //
        // FOUR PARALLEL TABLES, NOT ONE POLYMORPHIC ASSIGNMENT TABLE.
        //
        // The precedent is employee_shifts and matching it matters more than
        // saving three tables:
        //
        //  - A polymorphic (policy_type, policy_id) pair cannot carry a foreign
        //    key. A deleted policy would leave assignments pointing at nothing,
        //    and only application code would ever notice. This schema has
        //    already drifted from its migrations once; adding a relationship
        //    the database cannot enforce is the wrong direction.
        //  - employee_shifts already proves each assignment grows its own
        //    columns (custom_differential_rate). A shared table would have to
        //    hold those as nullable columns meaningful for one policy kind, or
        //    as a JSON blob — both worse than four honest tables.
        //  - The resolver reads one kind at a time. A polymorphic table forces
        //    every one of those reads through a discriminator that is never
        //    varied at the call site.
        //
        // Each mirrors employee_shifts exactly: effective-dated per employee,
        // re-assignment appends a row rather than editing one, effective_to
        // NULL is open-ended, and the latest effective_from wins when windows
        // overlap. That is what lets a payroll re-run for an earlier month
        // resolve the policy that was actually in force then.
        $assignmentTables = [
            'employee_weekly_off_policies' => ['weekly_off_policy_id', 'weekly_off_policies', 'emp_woff'],
            'employee_penalisation_policies' => ['penalisation_policy_id', 'penalisation_policies', 'emp_pen'],
            'employee_overtime_policies' => ['overtime_policy_id', 'overtime_policies', 'emp_ot'],
            'employee_shift_allowance_policies' => ['shift_allowance_policy_id', 'shift_allowance_policies', 'emp_allow'],
        ];

        foreach ($assignmentTables as $tableName => [$foreignKey, $policyTable, $prefix]) {
            if (Schema::hasTable($tableName)) {
                continue;
            }

            Schema::create($tableName, function (Blueprint $table) use ($foreignKey, $policyTable, $prefix) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId($foreignKey)->constrained($policyTable)->cascadeOnDelete();

                $table->date('effective_from');
                $table->date('effective_to')->nullable();
                $table->boolean('is_active')->default(true);

                $table->timestamps();

                $table->index(['user_id', 'effective_from'], $prefix.'_user_from_idx');
                $table->index(['organization_id', 'is_active'], $prefix.'_org_active_idx');
            });
        }
    }

    public function down(): void
    {
        foreach ([
            'employee_shift_allowance_policies',
            'employee_overtime_policies',
            'employee_penalisation_policies',
            'employee_weekly_off_policies',
            'shift_allowance_policies',
            'overtime_policy_scopes',
            'overtime_policies',
            'penalisation_half_day_rules',
            'penalisation_policies',
            'weekly_off_policies',
        ] as $table) {
            Schema::dropIfExists($table);
        }
    }
};
