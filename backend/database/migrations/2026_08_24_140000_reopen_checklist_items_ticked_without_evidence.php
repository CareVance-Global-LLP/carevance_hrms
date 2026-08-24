<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Reopens onboarding items that were ticked with nothing behind them.
 *
 * These items now complete themselves from an uploaded document or a recorded
 * detail, and the manual tick has been withdrawn for exactly the categories
 * evidence can answer. What is left is the ticks made before that: on the live
 * database, four of them across three people who had no PAN, no bank account
 * and no document of any kind. "Add PAN details ✓" against a record with no PAN
 * is not a status, it is a false statement, and the first thing that would have
 * disagreed with it is payroll.
 *
 * Deliberately narrow. Only items that are:
 *
 * - on an onboarding journey — exit checklists are a different vocabulary,
 * - asking for a document in a category evidence can satisfy — a signed
 *   contract or a policy acknowledgement has no other mechanism than somebody
 *   attesting, so a manual tick there is the intended one and stays,
 * - and carrying no evidence at all: no linked document, no evidence_kind.
 *
 * Anything a document or a record completed keeps its tick, because something
 * real is behind it.
 */
return new class extends Migration
{
    /** Kept in step with ChecklistEvidenceSync::EVIDENCE_CATEGORIES. */
    private const EVIDENCE_CATEGORIES = ['pan', 'bank', 'identity', 'employment', 'education'];

    public function up(): void
    {
        $templateItemIds = DB::table('checklist_template_items')
            ->whereIn('document_category', self::EVIDENCE_CATEGORIES)
            ->pluck('id');

        if ($templateItemIds->isEmpty()) {
            return;
        }

        DB::table('checklist_items')
            ->where('subject_type', 'App\\Models\\OnboardingJourney')
            ->whereIn('checklist_template_item_id', $templateItemIds)
            ->where('requires', 'document')
            ->where('status', 'done')
            ->whereNull('employee_document_id')
            ->whereNull('evidence_kind')
            ->update([
                'status' => 'pending',
                'completed_at' => null,
                'completed_by' => null,
                'evidence_label' => null,
            ]);
    }

    /**
     * Not reversible, and saying so is better than pretending.
     *
     * Re-ticking these on rollback would restore the false statement, and the
     * timestamps and the person who made each tick are gone — there is nothing
     * to restore them from. They will complete themselves the moment the
     * document or the detail arrives, which is the outcome either way.
     */
    public function down(): void
    {
        // Intentionally empty.
    }
};
