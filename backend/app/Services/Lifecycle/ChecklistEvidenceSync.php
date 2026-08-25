<?php

namespace App\Services\Lifecycle;

use App\Models\ChecklistItem;
use App\Models\EmployeeDocument;
use App\Models\OnboardingJourney;
use App\Models\User;
use App\Services\Employees\SalaryAccountResolver;
use Illuminate\Support\Collection;

/**
 * Reconcile a journey's document items against every file already on record.
 *
 * `DocumentChecklistMatcher` answers the question one upload at a time, at the
 * moment of the upload. That is the right thing to do and it is not enough: it
 * can only ever see documents that arrive AFTER the journey exists, in a
 * request where nothing threw. A scan uploaded during the add-user wizard,
 * before the account was bound to a pre-boarding journey, is invisible to it
 * for ever — and a checklist item that stays pending looks exactly like one
 * nobody has satisfied, so the failure is silent.
 *
 * This class asks the question the other way round: given this journey's
 * outstanding items, which of the employee's existing documents answer them?
 * Run on journey open and on every read of the checklist, it makes the tick a
 * property of the evidence rather than of who happened to be looking when the
 * file landed. It also means no backfill migration — the first person to open
 * either panel reconciles that journey.
 */
class ChecklistEvidenceSync
{
    /** Relations both matchers read, loaded once so neither costs a query. */
    private const RECORD_RELATIONS = ['employeeProfile', 'employeeGovernmentIds', 'employeeBankAccounts'];

    /**
     * Categories something in this application can actually satisfy.
     *
     * The union of what the two matchers answer — `DocumentChecklistMatcher`'s
     * table plus its special-cased `pan`, and the records the profile matcher
     * reads. It must stay in step with both: a category listed here that
     * neither matcher answers becomes an item nobody can ever complete, since
     * this list is also what refuses the manual tick.
     *
     * `contract` is absent, which is why it remains hand-tickable. No upload
     * path produces that category and no recorded fact stands in for a signed
     * contract, so a human attesting to it is the only mechanism there is.
     */
    public const EVIDENCE_CATEGORIES = ['pan', 'bank', 'identity', 'employment', 'education'];

    /**
     * Would evidence complete this item on its own?
     *
     * Asked by the controller before allowing a manual tick. An admin ticking
     * "Add PAN details" by hand is how a checklist ends up asserting a PAN is
     * on file when nothing is — four such ticks existed on the live database,
     * against three people who had no PAN, no bank account and no document of
     * any kind.
     */
    public static function isEvidenceBacked(ChecklistItem $item): bool
    {
        if ($item->requires !== 'document') {
            return false;
        }

        $category = trim((string) $item->checklistTemplateItem?->document_category);

        return in_array($category, self::EVIDENCE_CATEGORIES, true);
    }

    public function __construct(
        private readonly DocumentChecklistMatcher $matcher,
        private readonly ProfileRecordChecklistMatcher $records,
        private readonly ChecklistService $checklists,
        private readonly SalaryAccountResolver $accounts,
    ) {
    }

    /**
     * Complete every outstanding document item this employee's uploads satisfy.
     *
     * Best-effort by design, exactly as the upload-time hook is. This runs
     * inside GET handlers: a checklist that fails to reconcile is a nuisance,
     * but a 500 on the dashboard because reconciliation threw is a page the
     * employee cannot use at all.
     *
     * @return int how many items were completed
     */
    public function sync(?OnboardingJourney $journey): int
    {
        if (! $journey || ! $journey->user_id) {
            // A pre-boarding journey with no account bound yet has nobody to
            // own documents. `linkUser()` syncs the moment one is.
            return 0;
        }

        try {
            $items = $this->outstandingDocumentItems($journey);

            // The overwhelmingly common case, and the reason this is cheap
            // enough to run on every read: one query and out.
            if ($items->isEmpty()) {
                return 0;
            }

            // Plain query: User is one of the four models deliberately outside
            // BelongsToOrganization, so there is no scope to step around. The
            // id came off a journey that was already tenant-scoped.
            $employee = User::with(self::RECORD_RELATIONS)->find($journey->user_id);

            return $this->reconcile($items, $this->documentsFor($journey), $employee);
        } catch (\Throwable $exception) {
            report($exception);

            return 0;
        }
    }

    /**
     * Reconcile every journey this employee has.
     *
     * The entry point for the upload paths, which know who the document is
     * about but not which journey is waiting on it. Deliberately not filtered
     * by stage: a journey that has rolled into `onboarding`, or been closed,
     * can still be carrying an outstanding document item, and that item is what
     * the employee is looking at.
     */
    public function syncForEmployee(User $employee): int
    {
        return $this->syncMany(
            OnboardingJourney::query()
                ->where('user_id', $employee->id)
                ->get()
        );
    }

    /**
     * Sync several journeys without re-querying per row.
     *
     * The New Hires list renders a readiness ring per journey, so it has to
     * agree with the slide-over that opens from it. Done one at a time that is
     * two queries per hire; this collapses the item and document lookups into
     * one each for the whole page.
     *
     * @param  Collection<int, OnboardingJourney>  $journeys
     */
    public function syncMany(Collection $journeys): int
    {
        $journeys = $journeys->filter(fn (OnboardingJourney $journey) => $journey->user_id !== null);

        if ($journeys->isEmpty()) {
            return 0;
        }

        try {
            $items = ChecklistItem::query()
                ->outstanding()
                ->where('subject_type', (new OnboardingJourney)->getMorphClass())
                ->whereIn('subject_id', $journeys->pluck('id')->all())
                ->where('requires', 'document')
                ->with('checklistTemplateItem')
                ->orderBy('sort_order')
                ->get()
                ->groupBy('subject_id');

            if ($items->isEmpty()) {
                return 0;
            }

            // Only the journeys that actually have something outstanding — a
            // page of settled hires costs one query in total.
            $pending = $journeys->filter(fn (OnboardingJourney $journey) => $items->has($journey->id));

            $userIds = $pending->pluck('user_id')->unique()->all();

            $documents = EmployeeDocument::forOrganization((int) $journeys->first()->organization_id)
                ->whereIn('user_id', $userIds)
                ->orderBy('uploaded_at')
                ->orderBy('id')
                ->get()
                ->groupBy('user_id');

            // One query for the page, not three per row. Both matchers read
            // these relations off the model, so loading them here is what keeps
            // a record check as cheap as a document check.
            $employees = User::with(self::RECORD_RELATIONS)
                ->whereIn('id', $userIds)
                ->get()
                ->keyBy('id');

            $completed = 0;

            foreach ($pending as $journey) {
                $completed += $this->reconcile(
                    $items->get($journey->id, collect()),
                    $documents->get($journey->user_id, collect()),
                    $employees->get($journey->user_id),
                );
            }

            return $completed;
        } catch (\Throwable $exception) {
            report($exception);

            return 0;
        }
    }

    /**
     * @param  Collection<int, ChecklistItem>  $items
     * @param  Collection<int, EmployeeDocument>  $documents
     */
    private function reconcile(Collection $items, Collection $documents, ?User $employee = null): int
    {
        if ($items->isEmpty()) {
            return 0;
        }

        $completed = 0;
        $consumed = [];

        foreach ($items as $item) {
            $wanted = $item->checklistTemplateItem?->document_category;

            $document = $documents->first(fn (EmployeeDocument $candidate) => ! isset($consumed[$candidate->id])
                && $this->matcher->documentSatisfies($wanted, $candidate));

            if ($document) {
                // One file cannot clear two gates. The pan/identity split in
                // the matcher already prevents the case that actually occurs,
                // but a template with two items wanting the same category would
                // otherwise both be answered by a single upload — and "we hold
                // two documents" is exactly what those two items assert.
                $consumed[$document->id] = true;
                $this->checklists->completeFromExistingDocument($item, $document);
                $completed++;

                continue;
            }

            /*
             * No file, so fall back to the record.
             *
             * The order is the point: a document is the stronger evidence, and
             * an item that could name the scan should name the scan. The record
             * answers the weaker question — is the fact this item asked about
             * actually on file? — which for four of eight live journeys is yes
             * while every one of them held zero documents.
             */
            if (! $employee) {
                continue;
            }

            $label = $this->records->labelFor($employee, $wanted);

            if ($label === null) {
                continue;
            }

            $this->checklists->completeFromRecord(
                $item,
                $employee->id,
                $label,
                $this->recordedAt($employee, $wanted),
            );
            $completed++;
        }

        return $completed;
    }

    /**
     * When the fact became true, as best the record knows.
     *
     * Falls back to the item's own creation only when the row carries no
     * timestamp at all — never to now(), which would restamp the completion
     * every time somebody with a stale read triggered a sync.
     */
    private function recordedAt(User $employee, ?string $wanted): ?\DateTimeInterface
    {
        $row = match (trim((string) $wanted)) {
            'pan', 'identity' => $employee->employeeGovernmentIds
                ->sortBy('created_at')
                ->first(),
            'bank' => $this->accounts->defaultFor($employee),
            default => null,
        };

        return $row?->created_at;
    }

    /**
     * @return Collection<int, ChecklistItem>
     */
    private function outstandingDocumentItems(OnboardingJourney $journey): Collection
    {
        return ChecklistItem::forSubject($journey)
            ->outstanding()
            ->where('requires', 'document')
            ->with('checklistTemplateItem')
            ->orderBy('sort_order')
            ->get();
    }

    /**
     * Oldest first, so an item is credited to the upload that first satisfied
     * it rather than to whichever replacement scan happens to be newest.
     *
     * Pinned to the journey's organization rather than left to the global
     * scope: this runs from console commands and queued jobs too, where the
     * scope is deliberately a no-op and an unpinned query would read across
     * every tenant.
     *
     * @return Collection<int, EmployeeDocument>
     */
    private function documentsFor(OnboardingJourney $journey): Collection
    {
        return EmployeeDocument::forOrganization((int) $journey->organization_id)
            ->where('user_id', $journey->user_id)
            ->orderBy('uploaded_at')
            ->orderBy('id')
            ->get();
    }
}
