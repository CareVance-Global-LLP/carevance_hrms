<?php

namespace Tests\Feature;

use App\Models\Candidate;
use App\Models\JobApplication;
use App\Models\JobOffer;
use App\Models\JobOpening;
use App\Models\Organization;
use App\Models\User;
use App\Services\Recruitment\HiringPipelineService;
use App\Services\Recruitment\OfferService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * Offers: the approval chain, and the line past which money stops being
 * editable.
 *
 * An amount alone is not an offer — somebody has to agree to spend it. The
 * tests here are mostly about the two ways that goes wrong: an offer reaching a
 * candidate without a complete chain behind it, and an offer already with a
 * candidate being quietly edited afterwards.
 */
class OfferFlowTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $recruiter;
    private User $financeApprover;
    private JobApplication $application;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-offers']);
        $this->recruiter = $this->makeUser('recruiter@carevance.test', 'hr');
        $this->financeApprover = $this->makeUser('finance@carevance.test', 'manager');

        $pipeline = app(HiringPipelineService::class);
        $pipeline->ensureStagesFor($this->organization);

        $opening = JobOpening::query()->create([
            'organization_id' => $this->organization->id,
            'code' => 'REQ-1',
            'title' => 'Backend Engineer',
            'status' => 'open',
            'openings_count' => 1,
        ]);

        $candidate = Candidate::query()->create([
            'organization_id' => $this->organization->id,
            'first_name' => 'Priya',
            'email' => 'priya@example.test',
        ]);

        $this->application = $pipeline->apply($opening, $candidate, $this->recruiter);
    }

    private function makeUser(string $email, string $role): User
    {
        return User::create([
            'name' => explode('@', $email)[0],
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
    }

    private function offers(): OfferService
    {
        return app(OfferService::class);
    }

    private function draft(): JobOffer
    {
        return $this->offers()->draft($this->application, [
            'designation' => 'Backend Engineer',
            'annual_ctc' => 1800000,
            'proposed_joining_date' => '2026-10-01',
        ], $this->recruiter);
    }

    private function approvedOffer(): JobOffer
    {
        $offer = $this->draft();
        $this->offers()->submitForApproval($offer, [$this->financeApprover->id], $this->recruiter);

        return $this->offers()->decide($offer->fresh(), $this->financeApprover, true);
    }

    public function test_an_offer_with_no_approvers_is_refused(): void
    {
        $offer = $this->draft();

        /*
         * An empty chain must not read as "no approval needed". An organization
         * that genuinely wants unapproved offers should say so by approving
         * them itself; silently treating blank as approved is how an offer goes
         * out with nobody having agreed to it.
         */
        $this->expectException(RuntimeException::class);
        $this->offers()->submitForApproval($offer, [], $this->recruiter);
    }

    public function test_an_offer_cannot_be_sent_before_it_is_approved(): void
    {
        $offer = $this->draft();
        $this->offers()->submitForApproval($offer, [$this->financeApprover->id], $this->recruiter);

        $this->expectException(RuntimeException::class);
        $this->offers()->send($offer->fresh());
    }

    public function test_a_full_chain_approves_the_offer(): void
    {
        $offer = $this->approvedOffer();

        $this->assertSame('approved', $offer->status);
        $this->assertTrue($offer->isFullyApproved());
    }

    public function test_one_rejection_sends_the_whole_offer_back_to_draft(): void
    {
        $second = $this->makeUser('cfo@carevance.test', 'manager');

        $offer = $this->draft();
        $this->offers()->submitForApproval($offer, [$this->financeApprover->id, $second->id], $this->recruiter);

        $after = $this->offers()->decide($offer->fresh(), $this->financeApprover, false, 'Above band');

        /*
         * Immediately, rather than waiting for the rest of the chain.
         * Continuing to collect approvals for an offer somebody has already
         * refused wastes everybody's time and leaves a record that reads as
         * though it were still live.
         */
        $this->assertSame('draft', $after->status);
        $this->assertTrue($after->isRejected());
    }

    public function test_resubmitting_after_a_rejection_clears_the_old_round(): void
    {
        $offer = $this->draft();
        $this->offers()->submitForApproval($offer, [$this->financeApprover->id], $this->recruiter);
        $this->offers()->decide($offer->fresh(), $this->financeApprover, false, 'Above band');

        $resubmitted = $this->offers()->submitForApproval($offer->fresh(), [$this->financeApprover->id], $this->recruiter);

        // Keeping the old rows would leave a `rejected` in the chain and make
        // the offer permanently unapprovable.
        $this->assertSame('pending_approval', $resubmitted->status);
        $this->assertFalse($resubmitted->isRejected());
    }

    public function test_an_approver_cannot_vote_twice(): void
    {
        $offer = $this->draft();
        $this->offers()->submitForApproval($offer, [$this->financeApprover->id], $this->recruiter);
        $this->offers()->decide($offer->fresh(), $this->financeApprover, true);

        $this->expectException(RuntimeException::class);
        $this->offers()->decide($offer->fresh(), $this->financeApprover, false);
    }

    public function test_somebody_outside_the_chain_cannot_approve(): void
    {
        $stranger = $this->makeUser('stranger@carevance.test', 'manager');

        $offer = $this->draft();
        $this->offers()->submitForApproval($offer, [$this->financeApprover->id], $this->recruiter);

        $this->expectException(RuntimeException::class);
        $this->offers()->decide($offer->fresh(), $stranger, true);
    }

    public function test_a_sent_offer_cannot_be_edited_in_place(): void
    {
        $offer = $this->offers()->send($this->approvedOffer());

        /*
         * The line past which an offer stops being internal. "We changed our
         * mind about your salary after you saw it" has to be visible in the
         * record as a withdrawal and a revision, not an in-place overwrite.
         */
        $this->expectException(RuntimeException::class);
        $this->offers()->submitForApproval($offer->fresh(), [$this->financeApprover->id], $this->recruiter);
    }

    public function test_resending_does_not_restart_the_acceptance_window(): void
    {
        $offer = $this->offers()->send($this->approvedOffer());
        $firstSentAt = $offer->sent_at;

        $resent = $this->offers()->send($offer->fresh()->forceFill(['status' => 'approved']));

        // The candidate has already been counting down. Moving the timestamp
        // silently gives them less time than they were told.
        $this->assertSame($firstSentAt->toDateTimeString(), $resent->sent_at->toDateTimeString());
    }

    public function test_accepting_an_offer_hires_the_candidate(): void
    {
        $offer = $this->offers()->send($this->approvedOffer());

        $this->offers()->respond($offer, true, app(HiringPipelineService::class), null, $this->recruiter);

        /*
         * Done here rather than left to the caller. An accepted offer sitting
         * beside an application still listed as interviewing is the kind of
         * disagreement that makes a headcount report untrustworthy.
         */
        $this->assertSame('hired', $this->application->fresh()->status);
        $this->assertSame(0, JobOpening::query()->first()->remainingOpenings());
    }

    public function test_a_declined_offer_needs_a_reason(): void
    {
        $offer = $this->offers()->send($this->approvedOffer());

        // The single most useful datum in recruitment analytics, and the one
        // nobody records unless the product insists.
        $this->expectException(RuntimeException::class);
        $this->offers()->respond($offer, false, app(HiringPipelineService::class), '  ');
    }

    public function test_a_declined_candidacy_stays_open_for_a_second_offer(): void
    {
        $offer = $this->offers()->send($this->approvedOffer());
        $this->offers()->respond($offer, false, app(HiringPipelineService::class), 'Counter-offer at current employer');

        // A declined offer is not a rejected candidate. They may well accept a
        // revised one, and blocking that would force somebody to fake a new
        // application.
        $this->assertSame('active', $this->application->fresh()->status);
        $this->assertNull($this->offers()->liveOfferFor($this->application->fresh()));

        $second = $this->draft();
        $this->assertSame('draft', $second->status);
    }

    public function test_two_live_offers_for_one_candidacy_are_refused(): void
    {
        $this->draft();

        // Two live offers means two different numbers with the candidate's
        // name on them, and no way to say which is real.
        $this->expectException(RuntimeException::class);
        $this->draft();
    }

    public function test_an_offer_needs_a_live_candidacy(): void
    {
        app(HiringPipelineService::class)->reject($this->application, 'Not a fit', $this->recruiter);

        $this->expectException(RuntimeException::class);
        $this->draft();
    }

    public function test_an_expired_window_is_computed_rather_than_trusted(): void
    {
        $offer = $this->offers()->send($this->approvedOffer(), now()->subDay());

        // Nothing runs at midnight to flip the status, so an offer expires
        // whether or not a job noticed.
        $this->assertTrue($offer->fresh()->hasLapsed());
    }
}
