<?php

namespace App\Services\Recruitment;

use App\Models\JobApplication;
use App\Models\JobOffer;
use App\Models\OfferApproval;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Making, approving and sending an offer.
 *
 * The state machine is the whole point, and it is deliberately strict in one
 * direction: an offer moves forward through approval and out to a candidate,
 * and once the candidate has seen it the money can no longer be edited in
 * place. A revision is a new offer that supersedes the old one, because
 * "we changed our mind about your salary after you accepted" has to be visible
 * in the record rather than silently overwritten.
 *
 *   draft ──submit──▶ pending_approval ──all approve──▶ approved ──send──▶ sent
 *                            │                                                │
 *                            └─any reject─▶ draft            accepted / declined
 *
 * WHY APPROVAL ROWS ARE WRITTEN UP FRONT: they record who was ASKED, not just
 * who answered. Deriving the chain at read time loses that, and "nobody ever
 * asked finance" is exactly the finding an audit is looking for.
 */
class OfferService
{
    /**
     * Draft an offer against a live candidacy.
     *
     * Refused for a decided application: extending an offer to somebody already
     * rejected or hired is either a mistake or a resurrection, and both deserve
     * to be noticed rather than absorbed.
     *
     * @param  array<string, mixed>  $attributes
     */
    public function draft(JobApplication $application, array $attributes, ?User $actor = null): JobOffer
    {
        if (! $application->isOpen()) {
            throw new RuntimeException('That application is '.$application->status.'. An offer needs a live candidacy.');
        }

        if ($this->liveOfferFor($application)) {
            throw new RuntimeException('This candidate already has an offer in progress. Withdraw it before drafting another.');
        }

        return JobOffer::query()->create($attributes + [
            'organization_id' => $application->organization_id,
            'job_application_id' => $application->id,
            'status' => 'draft',
            'created_by' => $actor?->id,
        ]);
    }

    /**
     * Send an offer for approval.
     *
     * An empty approver list is refused rather than treated as "no approval
     * needed". An organization that genuinely wants unapproved offers should
     * say so by approving them itself; silently letting a blank chain mean
     * "approved" is how an offer goes out with nobody having agreed to it.
     *
     * @param  array<int, int>  $approverIds  in the order they should be asked
     */
    public function submitForApproval(JobOffer $offer, array $approverIds, ?User $actor = null): JobOffer
    {
        $this->assertEditable($offer);

        $approverIds = array_values(array_unique(array_filter($approverIds)));

        if ($approverIds === []) {
            throw new RuntimeException('An offer needs at least one approver.');
        }

        $approvers = User::query()
            ->where('organization_id', $offer->organization_id)
            ->whereIn('id', $approverIds)
            ->pluck('id');

        if ($approvers->count() !== count($approverIds)) {
            throw new RuntimeException('One of those approvers is not in this workspace.');
        }

        return DB::transaction(function () use ($offer, $approverIds) {
            /*
             * Re-submitting after a rejection clears the previous round. Keeping
             * the old rows would leave a `rejected` in the chain and make the
             * offer permanently unapprovable.
             */
            $offer->approvals()->delete();

            foreach ($approverIds as $position => $approverId) {
                OfferApproval::query()->create([
                    'organization_id' => $offer->organization_id,
                    'job_offer_id' => $offer->id,
                    'approver_id' => $approverId,
                    'position' => $position,
                    'status' => 'pending',
                ]);
            }

            $offer->forceFill(['status' => 'pending_approval'])->save();

            return $offer->fresh('approvals');
        });
    }

    /**
     * Record one approver's decision.
     *
     * A rejection sends the whole offer back to draft immediately rather than
     * waiting for the rest of the chain. Continuing to collect approvals for an
     * offer somebody has already refused wastes everybody's time and produces a
     * record that reads as though it were still live.
     */
    public function decide(JobOffer $offer, User $approver, bool $approved, ?string $note = null): JobOffer
    {
        if ($offer->status !== 'pending_approval') {
            throw new RuntimeException('That offer is not awaiting approval.');
        }

        $row = $offer->approvals()->where('approver_id', $approver->id)->first();

        if (! $row) {
            throw new RuntimeException('You are not an approver on this offer.');
        }

        if ($row->status !== 'pending') {
            throw new RuntimeException('You have already responded to this offer.');
        }

        return DB::transaction(function () use ($offer, $row, $approved, $note) {
            $row->forceFill([
                'status' => $approved ? 'approved' : 'rejected',
                'note' => $note,
                'decided_at' => now(),
            ])->save();

            $fresh = $offer->fresh('approvals');

            if (! $approved) {
                $fresh->forceFill(['status' => 'draft'])->save();
            } elseif ($fresh->isFullyApproved()) {
                $fresh->forceFill(['status' => 'approved'])->save();
            }

            return $fresh->fresh('approvals');
        });
    }

    /**
     * Send an approved offer to the candidate.
     *
     * The moment it stops being internal. `sent_at` is stamped once — a
     * re-send is the same offer reaching the same person again, and moving the
     * timestamp would restart an acceptance window the candidate has already
     * been counting down.
     */
    public function send(JobOffer $offer, ?Carbon $validUntil = null): JobOffer
    {
        if ($offer->status !== 'approved') {
            throw new RuntimeException('An offer must be fully approved before it goes out.');
        }

        $offer->forceFill([
            'status' => 'sent',
            'sent_at' => $offer->sent_at ?? now(),
            'valid_until' => $validUntil?->toDateString() ?? $offer->valid_until,
        ])->save();

        return $offer->fresh();
    }

    /**
     * The candidate's answer.
     *
     * Accepting moves the candidacy itself to hired through the pipeline, so
     * the opening's headcount and the offer agree. Doing that here rather than
     * leaving it to the caller is what stops an accepted offer sitting beside
     * an application still listed as interviewing.
     */
    public function respond(
        JobOffer $offer,
        bool $accepted,
        HiringPipelineService $pipeline,
        ?string $declineReason = null,
        ?User $actor = null,
    ): JobOffer {
        if ($offer->status !== 'sent') {
            throw new RuntimeException('That offer has not been sent to the candidate.');
        }

        if (! $accepted && trim((string) $declineReason) === '') {
            // The single most useful datum in recruitment analytics, and the
            // one nobody records unless the product insists.
            throw new RuntimeException('A declined offer needs a reason.');
        }

        return DB::transaction(function () use ($offer, $accepted, $pipeline, $declineReason, $actor) {
            $offer->forceFill([
                'status' => $accepted ? 'accepted' : 'declined',
                'responded_at' => now(),
                'decline_reason' => $accepted ? null : trim((string) $declineReason),
            ])->save();

            if ($accepted) {
                $application = $offer->application;
                $hired = $pipeline->hiredStageFor((int) $offer->organization_id);

                if ($hired && $application && $application->isOpen()) {
                    $pipeline->moveTo($application, $hired, $actor, 'Offer accepted');
                }
            }

            return $offer->fresh();
        });
    }

    /** Pull an offer back. Allowed at any point before the candidate answers. */
    public function withdraw(JobOffer $offer, string $reason): JobOffer
    {
        if (in_array($offer->status, ['accepted', 'declined', 'withdrawn'], true)) {
            throw new RuntimeException('That offer has already been closed.');
        }

        $offer->forceFill([
            'status' => 'withdrawn',
            'decline_reason' => trim($reason) ?: null,
            'responded_at' => now(),
        ])->save();

        return $offer->fresh();
    }

    /**
     * The offer still in play for a candidacy, if any.
     *
     * Withdrawn, declined and expired offers do not count — a candidate whose
     * first offer lapsed must be able to receive a second.
     */
    public function liveOfferFor(JobApplication $application): ?JobOffer
    {
        return JobOffer::query()
            ->where('job_application_id', $application->id)
            ->whereIn('status', ['draft', 'pending_approval', 'approved', 'sent', 'accepted'])
            ->first();
    }

    private function assertEditable(JobOffer $offer): void
    {
        if ($offer->isCommitted()) {
            throw new RuntimeException(
                'This offer is already with the candidate. Withdraw it and draft a revision instead.'
            );
        }

        if (! in_array($offer->status, ['draft', 'pending_approval'], true)) {
            throw new RuntimeException('That offer cannot be changed in its current state.');
        }
    }
}
