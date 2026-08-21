<?php

namespace App\Services\Recruitment;

use App\Models\BackgroundCheck;
use App\Models\BackgroundCheckConsent;
use App\Models\BackgroundCheckItem;
use App\Models\Candidate;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Running a background verification, lawfully.
 *
 * CONSENT GATES EVERYTHING. Not as a validation rule somebody could relax, but
 * as the thing every method here checks before it will move: no consent, no
 * check; withdrawn consent, no further checking. Verifying somebody without
 * their recorded agreement is unlawful under the DPDP Act and most equivalents,
 * and a product that makes it easy is a liability its customer inherits.
 *
 * CONSENT IS TO A SCOPE, NOT TO "BACKGROUND CHECKS". Somebody who agreed to
 * employment verification has not agreed to a credit check. Items outside the
 * recorded scope are refused, so a package that gains a check next year cannot
 * retroactively widen a consent given last year.
 *
 * NOTHING HERE REJECTS ANYBODY. A discrepancy is a finding that needs a human.
 * The service will not touch the candidacy, will not move a pipeline stage, and
 * will not set a status that reads as a verdict.
 */
class BackgroundCheckService
{
    /**
     * Record consent.
     *
     * The IP and user agent are the evidence, not decoration — a consent that
     * cannot be produced later is one that did not happen as far as a regulator
     * is concerned.
     *
     * @param  array<int, string>  $scope
     */
    public function recordConsent(
        Candidate|User $subject,
        string $consentedName,
        array $scope,
        ?string $noticeText = null,
        ?string $ipAddress = null,
        ?string $userAgent = null,
    ): BackgroundCheckConsent {
        $scope = array_values(array_unique(array_filter($scope)));

        if ($scope === []) {
            // "I consent to unspecified checks" is not consent to anything.
            throw new RuntimeException('Consent has to say which checks it covers.');
        }

        foreach ($scope as $type) {
            if (! in_array($type, BackgroundCheckItem::TYPES, true)) {
                throw new RuntimeException("'{$type}' is not a kind of check this system runs.");
            }
        }

        if (trim($consentedName) === '') {
            throw new RuntimeException('Consent has to be given by name.');
        }

        return BackgroundCheckConsent::query()->create([
            'organization_id' => $subject->organization_id,
            'candidate_id' => $subject instanceof Candidate ? $subject->id : null,
            'user_id' => $subject instanceof User ? $subject->id : null,
            'consented_name' => trim($consentedName),
            'consented_email' => $subject->email,
            'scope' => $scope,
            'notice_text' => $noticeText,
            'ip_address' => $ipAddress,
            'user_agent' => $userAgent ? substr($userAgent, 0, 512) : null,
            'consented_at' => now(),
        ]);
    }

    /**
     * Withdraw consent.
     *
     * Everything still outstanding stops. Findings already recorded are NOT
     * deleted — they were lawfully obtained at the time, and erasing a
     * completed verification would also erase the record that it happened,
     * which serves nobody. What withdrawal buys is that no further checking
     * occurs.
     */
    public function withdrawConsent(BackgroundCheckConsent $consent, string $reason): BackgroundCheckConsent
    {
        if (! $consent->isLive()) {
            throw new RuntimeException('That consent has already been withdrawn.');
        }

        return DB::transaction(function () use ($consent, $reason) {
            $consent->forceFill([
                'withdrawn_at' => now(),
                'withdrawal_reason' => trim($reason) ?: null,
            ])->save();

            $checks = BackgroundCheck::query()
                ->where('consent_id', $consent->id)
                ->whereIn('status', ['pending_consent', 'awaiting_start', 'in_progress'])
                ->get();

            foreach ($checks as $check) {
                // Unstarted items are skipped rather than deleted, so the record
                // shows what was going to be checked and was not.
                $check->items()->whereIn('status', ['pending', 'in_progress'])->update([
                    'status' => 'skipped',
                    'notes' => 'Not completed — consent withdrawn',
                ]);

                $check->forceFill([
                    'status' => 'cancelled',
                    'completed_at' => now(),
                ])->save();
            }

            return $consent->fresh();
        });
    }

    /**
     * Open a verification.
     *
     * Items are created from the CONSENT's scope, not from a package somebody
     * chose — the package names the intent, the consent decides what may
     * actually be checked, and where they disagree the consent wins.
     *
     * @param  array<int, string>  $types
     */
    public function open(
        Candidate|User $subject,
        BackgroundCheckConsent $consent,
        array $types,
        ?string $package = null,
        ?User $actor = null,
    ): BackgroundCheck {
        if (! $consent->isLive()) {
            throw new RuntimeException('That consent has been withdrawn.');
        }

        if ((int) $consent->organization_id !== (int) $subject->organization_id) {
            throw new RuntimeException('That consent belongs to another workspace.');
        }

        $requested = array_values(array_unique(array_filter($types)));
        $outside = array_values(array_diff($requested, (array) $consent->scope));

        if ($outside !== []) {
            throw new RuntimeException(
                'Consent does not cover: '.implode(', ', $outside).'. Ask again for those.'
            );
        }

        if ($requested === []) {
            throw new RuntimeException('A verification needs at least one check.');
        }

        return DB::transaction(function () use ($subject, $consent, $requested, $package, $actor) {
            $check = BackgroundCheck::query()->create([
                'organization_id' => $subject->organization_id,
                'candidate_id' => $subject instanceof Candidate ? $subject->id : null,
                'user_id' => $subject instanceof User ? $subject->id : null,
                'consent_id' => $consent->id,
                'package' => $package,
                'status' => 'in_progress',
                'requested_at' => now(),
                'requested_by' => $actor?->id,
            ]);

            foreach ($requested as $type) {
                BackgroundCheckItem::query()->create([
                    'organization_id' => $subject->organization_id,
                    'background_check_id' => $check->id,
                    'type' => $type,
                    'status' => 'pending',
                ]);
            }

            return $check->fresh('items');
        });
    }

    /**
     * Record the result of one check.
     *
     * A discrepancy REQUIRES both sides — what was claimed and what was found.
     * "Discrepancy" with no detail is an accusation somebody cannot answer, and
     * the person it is about is entitled to see the comparison that produced
     * it.
     */
    public function recordItem(
        BackgroundCheckItem $item,
        string $status,
        ?string $claimed = null,
        ?string $verified = null,
        ?string $notes = null,
        ?User $actor = null,
    ): BackgroundCheckItem {
        if (! in_array($status, BackgroundCheckItem::STATUSES, true)) {
            throw new RuntimeException('That is not a recognised result.');
        }

        $check = $item->check;

        if ($check && ! $check->hasLiveConsent()) {
            throw new RuntimeException('Consent for this verification has been withdrawn.');
        }

        if ($status === 'discrepancy' && (trim((string) $claimed) === '' || trim((string) $verified) === '')) {
            throw new RuntimeException(
                'A discrepancy needs both what was claimed and what was found.'
            );
        }

        return DB::transaction(function () use ($item, $status, $claimed, $verified, $notes, $actor, $check) {
            $item->forceFill([
                'status' => $status,
                'claimed' => $claimed,
                'verified' => $verified,
                'notes' => $notes,
                'completed_by' => in_array($status, BackgroundCheckItem::SETTLED, true) ? $actor?->id : null,
                'completed_at' => in_array($status, BackgroundCheckItem::SETTLED, true) ? now() : null,
            ])->save();

            if ($check) {
                $this->refreshOutcome($check->fresh('items'));
            }

            return $item->fresh();
        });
    }

    /**
     * Recompute the headline once every item is settled.
     *
     * Derived from the rows rather than set by a caller: a summary that can
     * drift from the items beneath it is one somebody will eventually act on
     * while it is wrong.
     */
    public function refreshOutcome(BackgroundCheck $check): BackgroundCheck
    {
        $outcome = $check->deriveOutcome();

        $check->forceFill([
            'outcome' => $outcome,
            'status' => $outcome === null ? 'in_progress' : 'completed',
            'completed_at' => $outcome === null ? null : ($check->completed_at ?: now()),
        ])->save();

        return $check->fresh('items');
    }

    /**
     * Record that the candidate has been told about an adverse finding.
     *
     * Refused where there is nothing to tell them about. A notice on a clear
     * check is noise, and a product that lets you send one trains people to
     * click through the notice that matters.
     */
    public function recordAdverseActionNotice(BackgroundCheck $check): BackgroundCheck
    {
        if (! in_array($check->outcome, ['discrepancy', 'insufficient'], true)) {
            throw new RuntimeException('There is no adverse finding to notify about.');
        }

        if ($check->notified_at !== null) {
            throw new RuntimeException('They have already been notified.');
        }

        $check->forceFill(['notified_at' => now()])->save();

        return $check->fresh();
    }

    /**
     * The candidate's answer to a finding.
     *
     * They must have been told first. Recording a response to a notice that was
     * never sent is a record of a conversation that did not happen.
     */
    public function recordCandidateResponse(BackgroundCheck $check, string $response): BackgroundCheck
    {
        if ($check->notified_at === null) {
            throw new RuntimeException('They have not been told about the finding yet.');
        }

        if (trim($response) === '') {
            throw new RuntimeException('A response needs some content.');
        }

        $check->forceFill([
            'candidate_response' => trim($response),
            'responded_at' => now(),
        ])->save();

        return $check->fresh();
    }
}
