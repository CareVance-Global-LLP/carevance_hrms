<?php

namespace App\Services\Lifecycle;

use App\Models\AssetAssignment;
use App\Models\ChecklistItem;
use App\Models\ChecklistTemplate;
use App\Models\ChecklistTemplateItem;
use App\Models\EmployeeDocument;
use App\Models\EmployeeExit;
use App\Models\OnboardingJourney;
use App\Models\User;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;

/**
 * Turns a template into a live checklist against an anchor date.
 *
 * This is the whole engine behind both onboarding and offboarding. Due dates
 * are computed once, here, from a single anchor — not recomputed on read —
 * because a due date that silently moves when a joining date is corrected is
 * worse than one that is visibly stale.
 */
class ChecklistService
{
    /**
     * Build the checklist for a journey.
     *
     * Idempotent by template item: calling it twice will not duplicate rows,
     * which matters because an exit can be re-opened and a journey re-templated.
     */
    /**
     * @param  CarbonInterface|null  $notBefore
     *   Floor for computed due dates. A template anchored on the joining date
     *   places items as early as day −14, but a journey is usually opened much
     *   later than that — often days before the person starts. Without a floor
     *   those items are born overdue: on a joiner starting in five days, six of
     *   the eighteen items (three of them blocking gates) are already red the
     *   instant the journey opens, for work nobody could have done because the
     *   journey did not exist. Passing the open date moves them to "due now",
     *   which is both actionable and true.
     */
    public function materialise(
        Model $subject,
        ChecklistTemplate $template,
        CarbonInterface $anchor,
        array $owners = [],
        ?CarbonInterface $notBefore = null
    ): int {
        $existing = ChecklistItem::forSubject($subject)
            ->whereNotNull('checklist_template_item_id')
            ->pluck('checklist_template_item_id')
            ->all();

        $created = 0;

        $floor = $notBefore?->copy()->startOfDay();

        DB::transaction(function () use ($subject, $template, $anchor, $owners, $existing, $floor, &$created) {
            foreach ($template->items as $templateItem) {
                if (in_array($templateItem->id, $existing, true)) {
                    continue;
                }

                $due = $anchor->copy()->addDays($templateItem->offset_days);
                if ($floor !== null && $due->lessThan($floor)) {
                    $due = $floor->copy();
                }

                ChecklistItem::create([
                    'organization_id' => $subject->organization_id,
                    'subject_type' => $subject->getMorphClass(),
                    'subject_id' => $subject->getKey(),
                    'checklist_template_item_id' => $templateItem->id,
                    'title' => $templateItem->title,
                    'description' => $templateItem->description,
                    'owner_kind' => $templateItem->owner_kind,
                    'owner_user_id' => $owners[$templateItem->owner_kind] ?? null,
                    'due_date' => $due->toDateString(),
                    'requires' => $templateItem->requires,
                    'is_blocking' => $templateItem->is_blocking,
                    'sort_order' => $templateItem->sort_order,
                ]);

                $created++;
            }
        });

        return $created;
    }

    /**
     * One return item per asset the person still holds.
     *
     * The asset list cannot live in a template — it is different for every
     * person and only knowable at the moment they leave. Reading
     * `asset_assignments` here is what connects custody to clearance; without
     * it an exit can complete while equipment is still out.
     */
    public function addAssetReturnItems(EmployeeExit $exit): int
    {
        $outstanding = AssetAssignment::with('asset')
            ->where('organization_id', $exit->organization_id)
            ->where('user_id', $exit->user_id)
            ->whereNull('returned_date')
            ->get();

        $alreadyTracked = ChecklistItem::forSubject($exit)
            ->whereNotNull('asset_assignment_id')
            ->pluck('asset_assignment_id')
            ->all();

        $created = 0;
        $sortBase = 900;

        foreach ($outstanding as $assignment) {
            if (in_array($assignment->id, $alreadyTracked, true)) {
                continue;
            }

            $label = $assignment->asset?->name ?? 'Asset';
            $tag = $assignment->asset?->asset_tag;

            ChecklistItem::create([
                'organization_id' => $exit->organization_id,
                'subject_type' => $exit->getMorphClass(),
                'subject_id' => $exit->getKey(),
                'title' => 'Collect '.$label.($tag ? " ({$tag})" : ''),
                'description' => 'Assigned on '.optional($assignment->assigned_date)->toDateString().'.',
                'owner_kind' => 'it',
                'due_date' => $exit->last_working_date?->toDateString(),
                'requires' => 'asset_return',
                // Equipment in someone's hands is exactly what settlement must
                // wait for, so these are always blocking.
                'is_blocking' => true,
                'asset_assignment_id' => $assignment->id,
                'sort_order' => $sortBase + $created,
            ]);

            $created++;
        }

        return $created;
    }

    /**
     * Complete an item. An asset-return item also books the asset back in, so
     * the checklist and the asset register cannot disagree.
     */
    public function complete(ChecklistItem $item, User $actor, ?string $notes = null): ChecklistItem
    {
        DB::transaction(function () use ($item, $actor, $notes) {
            if ($item->requires === 'asset_return' && $item->asset_assignment_id) {
                $assignment = AssetAssignment::find($item->asset_assignment_id);
                if ($assignment && $assignment->returned_date === null) {
                    $assignment->update(['returned_date' => now()->toDateString()]);
                    $assignment->asset?->update(['status' => 'available']);
                }
            }

            $item->update([
                'status' => ChecklistItem::STATUS_DONE,
                'completed_at' => now(),
                'completed_by' => $actor->id,
                'notes' => $notes ?? $item->notes,
            ]);
        });

        return $item->fresh();
    }

    /**
     * Complete an item because the document it was waiting for arrived.
     *
     * Separate from `complete()` because this one also links the evidence: the
     * item records WHICH upload satisfied it, so a later reviewer can open the
     * file rather than taking the tick on trust.
     *
     * `completed_by` is the uploader, whoever that was. An employee uploading
     * their own PAN card and an admin uploading it on their behalf both tick
     * the same item, and the audit trail says which of them actually did it.
     */
    public function completeFromDocument(ChecklistItem $item, User $actor, EmployeeDocument $document): ChecklistItem
    {
        $item->update([
            'status' => ChecklistItem::STATUS_DONE,
            'completed_at' => now(),
            'completed_by' => $actor->id,
            'employee_document_id' => $document->id,
            'evidence_kind' => 'document',
            'evidence_label' => $document->title,
        ]);

        return $item->fresh();
    }

    /**
     * Complete an item from a document that was already on file.
     *
     * The difference from `completeFromDocument()` is entirely in the two
     * stamps, and it matters. That method is called during the upload request,
     * so `now()` and the acting user are the truth. This one is called from a
     * sync that may run months later — on a journey opening, or on whichever
     * unrelated person next loads the checklist — and stamping `now()` there
     * would record "completed today by the admin who happened to open New
     * Hires" for a scan the joiner uploaded in June.
     *
     * So the evidence supplies both: the upload's own time, and the person who
     * uploaded it. The tick then says the same thing no matter when the sync
     * that noticed it ran, and re-running the sync cannot move it.
     */
    public function completeFromExistingDocument(ChecklistItem $item, EmployeeDocument $document): ChecklistItem
    {
        $item->update([
            'status' => ChecklistItem::STATUS_DONE,
            'completed_at' => $document->uploaded_at ?? $document->created_at ?? now(),
            'completed_by' => $document->uploaded_by,
            'employee_document_id' => $document->id,
            'evidence_kind' => 'document',
            'evidence_label' => $document->title,
        ]);

        return $item->fresh();
    }

    /**
     * Complete an item because the fact it was asking about is on the record.
     *
     * The weaker of the two evidence paths, and the one that was missing. An
     * employee who typed their PAN in without attaching a scan had supplied the
     * PAN — the item asking for it stayed pending anyway, for ever, while the
     * profile panel beside it displayed the number.
     *
     * `completed_by` is the person whose record it is. Unlike a document there
     * is no uploader to credit, and crediting whoever happened to trigger the
     * sync would attribute the joiner's own declaration to an admin who only
     * opened a page. `completed_at` is the record's own timestamp, for the same
     * reason the document path uses the upload's: the fact was true from the
     * moment it was entered, whenever we got round to noticing.
     */
    public function completeFromRecord(ChecklistItem $item, ?int $subjectUserId, string $label, ?\DateTimeInterface $at = null): ChecklistItem
    {
        $item->update([
            'status' => ChecklistItem::STATUS_DONE,
            'completed_at' => $at ?? now(),
            'completed_by' => $subjectUserId,
            'evidence_kind' => 'record',
            'evidence_label' => $label,
        ]);

        return $item->fresh();
    }

    public function reopen(ChecklistItem $item): ChecklistItem
    {
        $item->update([
            'status' => ChecklistItem::STATUS_PENDING,
            'completed_at' => null,
            'completed_by' => null,
            // Cleared with the rest. A reopened item still carrying "From PAN
            // record" would assert that evidence closed something that is open.
            'evidence_kind' => null,
            'evidence_label' => null,
        ]);

        return $item->fresh();
    }

    /**
     * Resolve `owner_kind` to real people for a journey. Anything unresolved
     * stays null and shows as "unassigned" rather than silently landing on
     * whoever happened to be handy.
     */
    public function ownersForExit(EmployeeExit $exit): array
    {
        $user = $exit->user;

        return array_filter([
            'employee' => $exit->user_id,
            'manager' => $user?->employeeWorkInfo?->reporting_manager_id,
            'hr' => $exit->initiated_by,
        ]);
    }

    public function ownersForJourney(OnboardingJourney $journey): array
    {
        return array_filter([
            'employee' => $journey->user_id,
            'manager' => $journey->manager_id,
            'buddy' => $journey->buddy_id,
            'hr' => $journey->created_by,
        ]);
    }

    /**
     * Backfill owners on items already created — used when a journey gains a
     * manager or buddy after its checklist was built.
     */
    public function reassignOwners(Model $subject, array $owners): int
    {
        $updated = 0;

        foreach ($owners as $kind => $userId) {
            if (! $userId) {
                continue;
            }

            $updated += ChecklistItem::forSubject($subject)
                ->where('owner_kind', $kind)
                ->whereNull('owner_user_id')
                ->update(['owner_user_id' => $userId]);
        }

        return $updated;
    }

    /** @return array{total:int,done:int,outstanding:int,blocking_outstanding:int,overdue:int} */
    public function progressFor(Model $subject): array
    {
        $items = ChecklistItem::forSubject($subject)->get();

        return [
            'total' => $items->count(),
            'done' => $items->filter(fn (ChecklistItem $i) => $i->isSettled())->count(),
            'outstanding' => $items->reject(fn (ChecklistItem $i) => $i->isSettled())->count(),
            'blocking_outstanding' => $items
                ->filter(fn (ChecklistItem $i) => $i->is_blocking && ! $i->isSettled())->count(),
            'overdue' => $items->filter(fn (ChecklistItem $i) => $i->is_overdue)->count(),
        ];
    }
}
