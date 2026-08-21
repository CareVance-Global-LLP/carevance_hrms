<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Turns leave from a flat annual number into an accrual policy with a ledger.
 *
 * Leave was a quota held as JSON in `organizations.settings.leave_policy` — a
 * code, a name and `annual_quota`, granted whole on day one. That is wrong for
 * every customer, not some: somebody joining in November received a full year's
 * entitlement, and somebody leaving in February had accrued nothing to encash.
 * There was no accrual schedule, no pro-rating, no configurable leave year and
 * no per-type carry-forward cap.
 *
 * Two tables:
 *
 * `leave_types` promotes the JSON categories to real rows so a policy can carry
 * more than one number. Backfilled from the existing settings, so an
 * organization that never opens the new screens keeps exactly the entitlement
 * it has today.
 *
 * `leave_ledger` is the important one. Balance is a SUM of dated rows, never a
 * counter that gets incremented — because the question HR actually asks is not
 * "what is my balance" but "why is it that". A counter cannot answer the second
 * question, and a balance nobody can explain is one you end up arguing about
 * with a customer's HR team holding a spreadsheet.
 */
return new class extends Migration
{
    /** What a ledger row represents. Every movement of leave is one of these. */
    private const ENTRY_KINDS = ['accrual', 'consumption', 'carry_forward', 'expiry', 'encashment', 'adjustment', 'opening_balance'];

    private const FREQUENCIES = ['annual', 'monthly', 'quarterly'];

    public function up(): void
    {
        if (! Schema::hasTable('leave_types')) {
            Schema::create('leave_types', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->string('code', 40);
                $table->string('name');

                // Entitlement for a full leave year, before pro-rating.
                $table->decimal('annual_quota', 6, 2)->default(0);

                /*
                 * `annual` grants the whole quota at the start of the leave
                 * year — the behaviour that exists today, kept as the default so
                 * this migration changes nobody's entitlement on the day it runs.
                 */
                $table->string('accrual_frequency', 12)->default('annual');

                /*
                 * Pro-rating for someone who joins mid-year, and the two rules
                 * that decide what a partial period is worth. Buyers ask for
                 * these by name because Keka exposes them.
                 */
                $table->boolean('pro_rate_on_join')->default(true);
                // Join on or before this day of the month and the period accrues
                // in full; after it, nothing accrues for that period.
                $table->unsignedTinyInteger('joining_cutoff_day')->default(15);

                // Probation frequently accrues at a different rate, or not at all.
                $table->decimal('probation_annual_quota', 6, 2)->nullable();

                // Carry-forward, capped and expiring. Uncapped carry-forward is
                // how a liability nobody budgeted for accumulates.
                $table->decimal('carry_forward_cap', 6, 2)->default(0);
                $table->unsignedSmallInteger('carry_forward_expiry_months')->nullable();

                $table->boolean('is_encashable')->default(false);
                $table->boolean('is_paid')->default(true);
                $table->boolean('is_active')->default(true);
                $table->unsignedSmallInteger('position')->default(0);
                $table->timestamps();

                $table->unique(['organization_id', 'code']);
                $table->index(['organization_id', 'is_active']);
            });
        }

        if (! Schema::hasTable('leave_ledger')) {
            Schema::create('leave_ledger', function (Blueprint $table) {
                $table->id();
                $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
                $table->foreignId('user_id')->constrained()->cascadeOnDelete();
                $table->foreignId('leave_type_id')->constrained('leave_types')->cascadeOnDelete();

                $table->string('kind', 20);

                /*
                 * Signed, deliberately. Accrual is positive, consumption is
                 * negative, and the balance is a plain SUM — no branching on
                 * kind, so a new kind cannot be forgotten by a balance query.
                 */
                $table->decimal('units', 8, 2);

                // The day the movement BELONGS to, which is not created_at: a
                // back-dated adjustment happens today and belongs to March.
                $table->date('effective_on');

                // Which leave year this row falls in. Stored rather than derived
                // because the leave year is configurable and may change.
                $table->date('cycle_start');
                $table->date('cycle_end');

                // What caused it, for the line-by-line explanation.
                $table->string('source', 40)->nullable();
                $table->unsignedBigInteger('source_id')->nullable();
                $table->string('note')->nullable();
                $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();

                $table->timestamps();

                $table->index(['organization_id', 'user_id', 'leave_type_id'], 'leave_ledger_balance_idx');
                $table->index(['user_id', 'cycle_start']);
                $table->index(['source', 'source_id']);
            });
        }

        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE leave_types DROP CONSTRAINT IF EXISTS leave_types_frequency_check');
            DB::statement("ALTER TABLE leave_types ADD CONSTRAINT leave_types_frequency_check CHECK (accrual_frequency IN ('".implode("', '", self::FREQUENCIES)."'))");

            DB::statement('ALTER TABLE leave_ledger DROP CONSTRAINT IF EXISTS leave_ledger_kind_check');
            DB::statement("ALTER TABLE leave_ledger ADD CONSTRAINT leave_ledger_kind_check CHECK (kind IN ('".implode("', '", self::ENTRY_KINDS)."'))");

            /*
             * One accrual row per person, per type, per period. The accrual job
             * is expected to be re-run — after a failure, after a policy edit,
             * by a nervous admin — and without this a second run silently
             * doubles everybody's entitlement. Enforced by the database because
             * an application-level guard only holds while every caller
             * remembers it.
             */
            DB::statement('DROP INDEX IF EXISTS leave_ledger_accrual_unique');
            DB::statement("CREATE UNIQUE INDEX leave_ledger_accrual_unique ON leave_ledger (user_id, leave_type_id, effective_on) WHERE kind = 'accrual'");
        }

        $this->backfillLeaveTypesFromSettings();
    }

    /**
     * Promote each organization's JSON categories to rows.
     *
     * Defaults mirror LeavePolicyService::resolvePolicyCategories() exactly, so
     * an organization that never configured anything gets the same three types
     * it has been running on.
     */
    private function backfillLeaveTypesFromSettings(): void
    {
        $defaults = [
            ['code' => 'paid', 'name' => 'Paid Leave', 'annual_quota' => 21.0],
            ['code' => 'sick', 'name' => 'Sick Leave', 'annual_quota' => 12.0],
            ['code' => 'birthday', 'name' => 'Birthday Leave', 'annual_quota' => 1.0],
        ];

        foreach (DB::table('organizations')->get(['id', 'settings']) as $organization) {
            $settings = json_decode((string) ($organization->settings ?? '{}'), true);
            $categories = data_get($settings, 'leave_policy.categories');
            $categories = is_array($categories) && $categories !== [] ? $categories : $defaults;

            $position = 0;
            foreach ($categories as $category) {
                $code = strtolower(trim((string) data_get($category, 'code', '')));
                $name = trim((string) data_get($category, 'name', ''));

                // Same exclusions the service applies: unpaid is not an
                // entitlement, and a nameless category is not a category.
                if ($code === '' || $name === '' || $code === 'unpaid') {
                    continue;
                }

                $code = preg_replace('/[^a-z0-9_\-]/', '', str_replace(' ', '_', $code));
                if ($code === '') {
                    continue;
                }

                $exists = DB::table('leave_types')
                    ->where('organization_id', $organization->id)
                    ->where('code', $code)
                    ->exists();

                if ($exists) {
                    continue;
                }

                DB::table('leave_types')->insert([
                    'organization_id' => $organization->id,
                    'code' => $code,
                    'name' => $name,
                    'annual_quota' => max(0.0, (float) data_get($category, 'annual_quota', 0)),
                    // 'annual' preserves today's grant-it-all-up-front behaviour.
                    // Switching a type to monthly is then a deliberate choice an
                    // admin makes, not something a migration did to them.
                    'accrual_frequency' => 'annual',
                    'pro_rate_on_join' => true,
                    'joining_cutoff_day' => 15,
                    'carry_forward_cap' => 0,
                    'is_encashable' => $code === 'paid',
                    'is_paid' => true,
                    'is_active' => true,
                    'position' => $position++,
                    'created_at' => now(),
                    'updated_at' => now(),
                ]);
            }
        }
    }

    public function down(): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS leave_ledger_accrual_unique');
        }

        Schema::dropIfExists('leave_ledger');
        Schema::dropIfExists('leave_types');
    }
};
