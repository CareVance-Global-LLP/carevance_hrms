<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Governed overrides: one shape, one lifetime, both values kept.
 *
 * Override capability already existed, ungoverned — through annual_ctc,
 * custom_deductions[] and the arrear endpoints, none of which required a
 * reason, an approver or left an audit record. This is not adding the ability
 * to override; it is giving the ability a shape.
 *
 * ONE LIFETIME (D7). effective_from with a nullable effective_to. Keka carries
 * three different lifetimes for the same concept — components permanent,
 * statutory date-ranged, and PF a boolean that carries forward until switched
 * off, with their own docs saying "if you don't want this overridden PF amount
 * to be reflected in the next month, you have to select No." Three lifetimes
 * for one idea means a payroll officer cannot answer "will this still be here
 * next month?" without knowing which kind they are looking at. Every Keka
 * behaviour is a special case of a date range: permanent is open-ended,
 * PF-until-cancelled is open-ended then closed, range-bound is as-is.
 *
 * BOTH VALUES (D6). `value` is what was applied; `computed_value` is what the
 * engine would have produced. Keeping the pair is what makes the override
 * register meaningful, the differences report self-explaining, and a reversal
 * trivially computable. An adjustment-line model loses "what would it have
 * been", which is exactly the half that explains the payslip.
 *
 * `cascade_snapshot` records every derived component that moved and by how
 * much. Overriding basic silently moves HRA, employer PF and the gratuity
 * provision; without this the differences report can say HRA changed but not
 * why, which is the difference between a report and an explanation.
 *
 * Guarded throughout — the schema has drifted from the migrations before.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('payroll_overrides')) {
            return;
        }

        Schema::create('payroll_overrides', function (Blueprint $table) {
            $table->id();

            $table->unsignedBigInteger('organization_id');
            $table->unsignedBigInteger('user_id');

            // 'component' | 'statutory' | 'adhoc' | 'lop' | 'hold'
            $table->string('scope', 24);
            // The component code or statutory head being overridden.
            $table->string('target', 64);

            // 'fixed' | 'percentage'
            $table->string('mode', 16)->default('fixed');
            $table->decimal('value', 14, 2);
            // What the engine would have produced. Null until the override is
            // first applied, because it is only knowable at compute time.
            $table->decimal('computed_value', 14, 2)->nullable();

            // Component scope only. 'preserve_ctc' holds the employee's stated
            // CTC — the number in their offer letter — and takes the delta out
            // of the residual; 'increase_gross' funds it by enlarging the
            // envelope, which is a different decision and needs its own
            // approval.
            $table->string('balance_mode', 24)->nullable();
            // The resolved residual, STORED rather than re-derived later: the
            // component that absorbed this delta must stay knowable even if the
            // structure's residual is reassigned afterwards.
            $table->unsignedBigInteger('balancing_target_id')->nullable();
            // Every derived component that moved, and by how much.
            $table->json('cascade_snapshot')->nullable();

            // One lifetime for every kind of override. Null effective_to means
            // open-ended, which is how "permanent" and "until cancelled" are
            // both expressed without being separate concepts.
            $table->date('effective_from');
            $table->date('effective_to')->nullable();

            // Required in practice. An override with no reason answers "what"
            // and never "why", and only the second settles a dispute.
            $table->text('reason');
            // 'pending' | 'approved' | 'rejected' | 'cancelled'
            $table->string('status', 16)->default('pending');

            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('approved_by')->nullable();
            $table->timestamp('approved_at')->nullable();

            $table->timestamps();

            $table->index(['organization_id', 'user_id', 'effective_from'], 'payroll_overrides_lookup');
            $table->index(['organization_id', 'status'], 'payroll_overrides_status');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('payroll_overrides');
    }
};
