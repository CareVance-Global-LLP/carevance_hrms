<?php

namespace App\Services\Lifecycle;

use App\Models\User;
use App\Services\Employees\SalaryAccountResolver;

/**
 * Which checklist items a person's RECORDED details satisfy.
 *
 * The sibling of `DocumentChecklistMatcher`, and it exists because requiring a
 * file was wrong. On the live database four of eight open journeys carry a PAN,
 * an Aadhaar and a bank account with `employee_document_id = NULL` — the details
 * were typed in and no scan was ever attached. Their blocking items could never
 * clear, so the same slide-over showed the PAN in its profile panel and "not
 * done" in its checklist directly underneath. An admin reads that as a broken
 * checklist, and they are right to.
 *
 * A document is still the stronger evidence and still wins where both exist;
 * see ChecklistEvidenceSync. This answers the weaker question: is the fact the
 * item was asking about actually on the record?
 */
class ProfileRecordChecklistMatcher
{
    public function __construct(
        private readonly SalaryAccountResolver $accounts,
    ) {
    }

    /**
     * Government ID types that are proof of identity or address.
     *
     * A PAN is deliberately absent. It is a tax number with an item of its own,
     * and letting it satisfy identity as well would clear two gates from one
     * fact — the same split `DocumentChecklistMatcher` enforces for uploads,
     * and it has to hold on both sides or the answer depends on which way the
     * evidence happened to arrive.
     */
    private const IDENTITY_ID_TYPES = [
        'aadhaar', 'aadhar', 'passport', 'voter', 'voter_id',
        'driving_licence', 'driving_license', 'dl',
    ];

    /**
     * What satisfies `$wanted` on this person's record, if anything.
     *
     * Returns a short label naming the evidence, or null when the record does
     * not answer the item. The label is what both panels render, so it carries
     * no identifier: "PAN record" is what a reader needs and the number is not.
     *
     * Reads loaded relations throughout — with `employeeProfile`,
     * `employeeGovernmentIds` and `employeeBankAccounts` eager-loaded this costs
     * no queries at all, which is what lets it run on every checklist read.
     */
    public function labelFor(User $employee, ?string $wanted): ?string
    {
        return match (trim((string) $wanted)) {
            'pan' => $this->panLabel($employee),
            'identity' => $this->identityLabel($employee),
            'bank' => $this->bankLabel($employee),
            /*
             * `employment`, `education` and `contract` fall through on purpose.
             *
             * There is no recorded fact that stands in for a previous
             * employer's relieving letter or a signed contract — those items
             * are asking for the document itself, and completing them from
             * anything else would be an assertion nobody made.
             */
            default => null,
        };
    }

    /**
     * `statutoryId` resolves the profile column or the government-ID rows,
     * deterministically — it already handles the employees carrying two PAN
     * rows with different values. Re-deriving that here would be a second
     * answer to a question that has one.
     */
    private function panLabel(User $employee): ?string
    {
        return filled($employee->statutoryId('pan')) ? 'PAN record' : null;
    }

    private function identityLabel(User $employee): ?string
    {
        $match = $employee->employeeGovernmentIds
            ->filter(fn ($id) => filled($id->id_number))
            ->first(fn ($id) => in_array(
                $this->normaliseType((string) $id->id_type),
                self::IDENTITY_ID_TYPES,
                true
            ));

        if ($match === null) {
            return null;
        }

        // Named by its own type, so the panel says "Aadhaar record" rather than
        // a generic "identity record" that leaves a reader guessing which of
        // several documents was actually supplied.
        return ucfirst($this->normaliseType((string) $match->id_type)).' record';
    }

    /**
     * Payable, not merely present. An account with a malformed IFSC is not
     * rejected by us — it is rejected by the bank, after the batch has gone
     * out. Completing the item on one would tell HR the details were fine.
     */
    private function bankLabel(User $employee): ?string
    {
        $account = $this->accounts->defaultFor($employee);

        return $this->accounts->isPayable($account)
            ? $this->accounts->label($account)
            : null;
    }

    /** Stored casing varies — the live data holds both `PAN` and `pan`. */
    private function normaliseType(string $type): string
    {
        return str_replace([' ', '-'], '_', mb_strtolower(trim($type)));
    }
}
