<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Records WHAT completed a checklist item, and renames the three items whose
 * wording stopped being true.
 *
 * **The columns.** `employee_document_id` already says "a file cleared this".
 * There is now a second way for an item to complete itself — the fact being on
 * the record, with no scan attached — and a third that was always there:
 * somebody ticked the box. Those three must stay distinguishable. Collapse them
 * and a hand-ticked "PAN card ✓" is indistinguishable from a PAN actually on
 * file, which is the exact confusion this whole change exists to remove.
 *
 * **The rename.** Once a typed PAN completes it, "Upload PAN card" is a false
 * statement about what happened. Only the three items that recorded data can
 * now satisfy are renamed; "Upload previous employment documents" and "Sign
 * employment contract" keep their wording because both still require the file.
 *
 * The rename is deliberately narrow: it matches rows whose title is STILL
 * exactly the old string, and whose template item carries the matching
 * `document_category`. A tenant who renamed an item meant to rename it, and
 * overwriting that would be this migration deciding it knew better.
 */
return new class extends Migration
{
    /** Old title => new title, keyed by the document_category that identifies it. */
    private const RENAMES = [
        'pan' => ['Upload PAN card', 'Add PAN details'],
        'bank' => ['Upload bank account details', 'Add bank account details'],
        'identity' => ['Upload proof of identity and address', 'Add proof of identity and address'],
    ];

    public function up(): void
    {
        Schema::table('checklist_items', function (Blueprint $table) {
            if (! Schema::hasColumn('checklist_items', 'evidence_kind')) {
                // 'document' | 'record'. Null means nobody's evidence closed
                // this — a human did.
                $table->string('evidence_kind', 16)->nullable()->after('employee_document_id');
            }

            if (! Schema::hasColumn('checklist_items', 'evidence_label')) {
                $table->string('evidence_label')->nullable()->after('evidence_kind');
            }
        });

        // Existing auto-completions were all document-driven, so they can be
        // labelled retrospectively rather than left blank and looking manual.
        DB::table('checklist_items')
            ->whereNotNull('employee_document_id')
            ->whereNull('evidence_kind')
            ->update(['evidence_kind' => 'document']);

        $this->renameStockItems();
    }

    public function down(): void
    {
        foreach (self::RENAMES as [$old, $new]) {
            DB::table('checklist_template_items')->where('title', $new)->update(['title' => $old]);
            DB::table('checklist_items')->where('title', $new)->update(['title' => $old]);
        }

        Schema::table('checklist_items', function (Blueprint $table) {
            foreach (['evidence_kind', 'evidence_label'] as $column) {
                if (Schema::hasColumn('checklist_items', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }

    /**
     * Renamed in two places, because the title is copied onto each materialised
     * row at `ChecklistService::materialise()` rather than read through the
     * template. Renaming only the template would leave every journey already in
     * flight — which is all of them — still reading "Upload PAN card".
     */
    private function renameStockItems(): void
    {
        foreach (self::RENAMES as $category => [$old, $new]) {
            $templateItemIds = DB::table('checklist_template_items')
                ->where('document_category', $category)
                ->where('title', $old)
                ->pluck('id');

            if ($templateItemIds->isEmpty()) {
                continue;
            }

            DB::table('checklist_items')
                ->whereIn('checklist_template_item_id', $templateItemIds)
                ->where('title', $old)
                ->update(['title' => $new]);

            DB::table('checklist_template_items')
                ->whereIn('id', $templateItemIds)
                ->update(['title' => $new]);
        }
    }
};
