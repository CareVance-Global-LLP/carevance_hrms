<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Put back two columns an out-of-order migration removed.
 *
 * `salary_revision_letters` on production has neither `arrear_amount` nor
 * `rejection_reason`, while SalaryRevisionLetter declares both fillable. Every
 * attempt to record a salary revision therefore died on the insert:
 *
 *     SQLSTATE[42703]: column "arrear_amount" of relation
 *     "salary_revision_letters" does not exist
 *
 * Found 2 Sep 2026 by filling in the New Revision form on the live site. The
 * form validates correctly and the request is well formed; the table simply
 * cannot hold the row. Salary revisions have been impossible for as long as
 * this has been true, and nothing surfaced it because the failure is a 500 that
 * the UI renders as "Server error. Please try again later."
 *
 * HOW IT HAPPENED, because the ordering is the interesting part:
 *
 *     batch 32   create_salary_revision_letters_table
 *     batch 38   add_arrear_amount_and_rejection_reason_to_...   added them
 *     batch 39   create_tax_wizard_and_revision_tables           ran AFTER
 *
 * That last migration carries a 2026_06_11 filename — EARLIER than the
 * 2026_07_20 one that adds the columns — but reached this database later, so
 * Laravel ran it in a later batch and its `Schema::create` rebuilt the table
 * without them. Filename order is not run order for a migration that arrives
 * late, and a create-table migration is the one kind where that difference
 * silently destroys work.
 *
 * Guarded on every step: the table, each column, and a no-op when both are
 * already present. CLAUDE.md records that schema has drifted from migrations
 * here before (bank_transfer_batches) and asks for a reconcile rather than an
 * edit to the original — editing 2026_07_20 would fix nothing, because it is
 * already recorded as run on the database that needs it.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('salary_revision_letters')) {
            return;
        }

        Schema::table('salary_revision_letters', function (Blueprint $table) {
            if (! Schema::hasColumn('salary_revision_letters', 'arrear_amount')) {
                // Default 0 rather than nullable: a revision with no arrears
                // owes nothing, and null would make every reader decide what
                // "unknown arrears" means.
                $table->decimal('arrear_amount', 14, 2)->default(0)->after('new_ctc');
            }

            if (! Schema::hasColumn('salary_revision_letters', 'rejection_reason')) {
                // Nullable, because most revisions are never rejected and an
                // empty string would be indistinguishable from "rejected, no
                // reason given".
                $table->text('rejection_reason')->nullable()->after('rejected_at');
            }
        });
    }

    /**
     * Deliberately irreversible.
     *
     * Dropping these again restores the defect: the model would go on writing
     * both and every salary revision would 500 once more. There is also nothing
     * to restore them FROM — the rows carrying arrear amounts would be gone.
     */
    public function down(): void
    {
        // no-op
    }
};
