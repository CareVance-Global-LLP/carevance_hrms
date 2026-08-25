<?php

namespace App\Services\Lifecycle;

use App\Models\ChecklistItem;
use App\Models\EmployeeDocument;
use App\Models\EmployeeGovernmentId;
use App\Models\OnboardingJourney;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Which checklist items a newly uploaded document satisfies.
 *
 * The wiring here is trivial; the MAPPING is the substance, because the two
 * vocabularies were never reconciled. The default onboarding checklist asks for
 * `document_category` values of pan / bank / identity / employment / contract
 * (DefaultChecklistProvisioner), while uploads are tagged id_proof /
 * address_proof / other / government_id_proof / bank_proof /
 * experience_document / education. **Not one value appears in both lists.**
 *
 * That matters more than it looks. A straight equality match between the two
 * columns would compile, pass a careless test, and never fire once in
 * production — and the failure would be invisible, because a checklist item
 * that stays pending looks exactly like a checklist item nobody has satisfied
 * yet. This class exists so the translation lives in one readable table rather
 * than being assumed.
 */
class DocumentChecklistMatcher
{
    /**
     * Upload categories that satisfy each checklist `document_category`.
     *
     * `contract` is deliberately absent. No upload path in the application
     * produces that category today, so "Sign employment contract" — a BLOCKING
     * item — can only ever be ticked by hand. Leaving it out states that
     * honestly; adding a loose guess like `other` would tick a blocking gate
     * because somebody uploaded an unrelated file.
     *
     * @var array<string, array<int, string>>
     */
    private const SATISFIED_BY = [
        'bank' => ['bank_proof'],
        'identity' => ['id_proof', 'address_proof', 'government_id_proof'],
        'employment' => ['experience_document'],
        'education' => ['education_certificate', 'education'],
    ];

    /**
     * ID types that make a `government_id_proof` upload count as a PAN.
     *
     * A government-ID proof is stored under one category whatever kind of ID it
     * proves, so the category alone cannot tell a PAN card from an Aadhaar.
     */
    private const PAN_ID_TYPES = ['pan'];

    /**
     * Pending checklist items on this person's open journeys that the document
     * satisfies.
     *
     * Only `outstanding` items: re-uploading a file must not re-complete
     * something already settled, or the completion timestamp and the person
     * recorded against it would drift every time somebody replaced a scan.
     *
     * @return Collection<int, ChecklistItem>
     */
    public function pendingItemsFor(User $employee, EmployeeDocument $document): Collection
    {
        $category = trim((string) $document->category);

        if ($category === '') {
            return collect();
        }

        $journeyIds = OnboardingJourney::query()
            ->where('user_id', $employee->id)
            ->pluck('id');

        if ($journeyIds->isEmpty()) {
            return collect();
        }

        return ChecklistItem::query()
            ->outstanding()
            ->where('subject_type', (new OnboardingJourney)->getMorphClass())
            ->whereIn('subject_id', $journeyIds)
            ->where('requires', 'document')
            ->with('checklistTemplateItem')
            ->get()
            ->filter(fn (ChecklistItem $item) => $this->documentSatisfies(
                $item->checklistTemplateItem?->document_category,
                $document
            ))
            ->values();
    }

    /**
     * Does this one document satisfy an item asking for `$wanted`?
     *
     * Public because the same question is asked in two directions. On upload we
     * hold a document and look for items; on a journey sync we hold an item and
     * look through the documents already on file. Both need this exact answer,
     * and a second copy of the pan/identity split is a second place for it to
     * drift.
     */
    public function documentSatisfies(?string $wanted, EmployeeDocument $document): bool
    {
        $wanted = trim((string) $wanted);
        $uploaded = trim((string) $document->category);

        // A document with no category answers nothing.
        if ($uploaded === '') {
            return false;
        }

        // An item that names no category is not something an upload can answer.
        // Ticking it would mean any file completed every open document item.
        if ($wanted === '') {
            return false;
        }

        if ($wanted === 'pan') {
            return $uploaded === 'government_id_proof' && $this->provesPan($document);
        }

        if ($wanted === 'identity' && $uploaded === 'government_id_proof') {
            // A PAN card is not proof of address or identity for this purpose —
            // it has its own item, and letting it satisfy both would tick two
            // gates for one upload.
            return ! $this->provesPan($document);
        }

        return in_array($uploaded, self::SATISFIED_BY[$wanted] ?? [], true);
    }

    /**
     * Which kind of ID this proof is for.
     *
     * `meta.id_type` first, and it has to be: the controller stores the proof
     * BEFORE it writes the employee_government_ids row that points at it, so at
     * the moment the checklist is evaluated that link does not exist yet.
     * Relying on the link alone made provesPan() permanently false — the PAN
     * item could never tick, and a PAN card wrongly satisfied the identity item
     * instead, because that is the "not a PAN" branch.
     *
     * The linked row is still consulted as a fallback, which covers a document
     * evaluated again later once the row does exist.
     */
    private function provesPan(EmployeeDocument $document): bool
    {
        $fromMeta = is_array($document->meta) ? ($document->meta['id_type'] ?? null) : null;

        $idType = $fromMeta ?? EmployeeGovernmentId::query()
            ->where('employee_document_id', $document->id)
            ->value('id_type');

        return in_array(mb_strtolower(trim((string) $idType)), self::PAN_ID_TYPES, true);
    }
}
