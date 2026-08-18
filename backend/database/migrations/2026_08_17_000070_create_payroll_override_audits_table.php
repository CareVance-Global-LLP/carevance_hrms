<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * The override trail, append-only.
 *
 * An override is an exception to the agreed structure, so the question it will
 * eventually be asked is not "what is it now" but "who decided this, when, and
 * against what". The override row itself only ever holds the current state —
 * approving one overwrites its status, cancelling overwrites it again — so the
 * decision history has to live somewhere that is never rewritten.
 *
 * Hence: no updated_at, and nothing in the application ever issues an UPDATE or
 * a DELETE against this table. A correction is a new row, which is what makes
 * the trail evidence rather than merely a display of the latest opinion.
 *
 * `before_json` / `after_json` carry the override's own state either side of the
 * transition, so a row explains itself without having to reconstruct history by
 * replaying every earlier row.
 *
 * Guarded — the schema has drifted from the migrations before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('payroll_override_audits')) {
            return;
        }

        Schema::create('payroll_override_audits', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('organization_id');
            $table->unsignedBigInteger('payroll_override_id');

            // 'created' | 'approved' | 'rejected' | 'cancelled' | 'applied'
            //
            // 'applied' is written by the ENGINE rather than by a person, which
            // is why actor_id is nullable: a queued run has no acting user in
            // the way an approval does.
            $table->string('action', 16);
            $table->unsignedBigInteger('actor_id')->nullable();

            $table->json('before_json')->nullable();
            $table->json('after_json')->nullable();
            // The rejection reason, and the only free text an approver owes.
            $table->text('note')->nullable();

            // Explicit, and alone. timestamps() would add updated_at, and an
            // append-only table with an updated_at column invites exactly the
            // write this table exists to forbid.
            $table->timestamp('created_at')->nullable();

            $table->index(['organization_id', 'payroll_override_id'], 'payroll_override_audits_lookup');
            $table->index(['payroll_override_id', 'action'], 'payroll_override_audits_action');

            $table->foreign('payroll_override_id')
                ->references('id')
                ->on('payroll_overrides')
                ->cascadeOnDelete();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_override_audits');
    }
};
