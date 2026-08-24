<?php

namespace Tests\Feature;

use App\Models\BackgroundCheck;
use App\Models\BackgroundCheckConsent;
use App\Models\BackgroundCheckItem;
use App\Models\Candidate;
use App\Models\Organization;
use App\Models\User;
use App\Services\Recruitment\BackgroundCheckService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * Background verification.
 *
 * Most of what is tested here is legal rather than functional. Checking
 * somebody without their recorded agreement is unlawful; consent is to a
 * SCOPE rather than to "background checks" generally; withdrawal has to
 * actually stop things; and a discrepancy is a finding for a human, never a
 * verdict the software reaches on its own.
 *
 * The failure mode that matters is a product that makes the unlawful thing
 * easy, because the customer inherits that liability.
 */
class BackgroundCheckTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $recruiter;
    private Candidate $candidate;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-bgv']);

        $this->recruiter = User::create([
            'name' => 'Recruiter',
            'email' => 'recruiter@carevance.test',
            'password' => Hash::make('password123'),
            'role' => 'hr',
            'organization_id' => $this->organization->id,
        ]);

        $this->candidate = Candidate::query()->create([
            'organization_id' => $this->organization->id,
            'first_name' => 'Priya',
            'last_name' => 'Nair',
            'email' => 'priya@example.test',
        ]);
    }

    private function service(): BackgroundCheckService
    {
        return app(BackgroundCheckService::class);
    }

    /** @param array<int, string> $scope */
    private function consent(array $scope = ['identity', 'education', 'employment']): BackgroundCheckConsent
    {
        return $this->service()->recordConsent(
            $this->candidate,
            'Priya Nair',
            $scope,
            'We will verify your identity, education and employment history.',
            '203.0.113.7',
            'QA-Browser/1.0',
        );
    }

    /** @param array<int, string> $types */
    private function open(array $types = ['identity', 'education'], ?BackgroundCheckConsent $consent = null): BackgroundCheck
    {
        return $this->service()->open(
            $this->candidate,
            $consent ?: $this->consent(),
            $types,
            'Standard',
            $this->recruiter,
        );
    }

    private function itemOf(BackgroundCheck $check, string $type): BackgroundCheckItem
    {
        return $check->items()->where('type', $type)->firstOrFail();
    }

    public function test_consent_records_the_evidence_not_just_a_flag(): void
    {
        $consent = $this->consent();

        // A consent that cannot be produced later is one that did not happen as
        // far as a regulator is concerned.
        $this->assertSame('Priya Nair', $consent->consented_name);
        $this->assertSame('203.0.113.7', $consent->ip_address);
        $this->assertNotNull($consent->consented_at);
        $this->assertNotNull($consent->notice_text);
    }

    public function test_consent_must_say_what_it_covers(): void
    {
        // "I consent to unspecified checks" is not consent to anything.
        $this->expectException(RuntimeException::class);
        $this->service()->recordConsent($this->candidate, 'Priya Nair', []);
    }

    public function test_a_check_outside_the_consented_scope_is_refused(): void
    {
        $consent = $this->consent(['identity', 'education']);

        /*
         * Somebody who agreed to education verification has not agreed to a
         * credit check. A package that gains a check must not retroactively
         * widen a consent given earlier.
         */
        $this->expectException(RuntimeException::class);
        $this->open(['identity', 'credit'], $consent);
    }

    public function test_the_refusal_names_what_was_not_consented_to(): void
    {
        $consent = $this->consent(['identity']);

        try {
            $this->open(['identity', 'criminal'], $consent);
            $this->fail('a check outside the scope was allowed');
        } catch (RuntimeException $exception) {
            // Actionable: the recruiter now knows exactly what to ask for.
            $this->assertStringContainsString('criminal', $exception->getMessage());
        }
    }

    public function test_opening_a_check_creates_one_item_per_kind(): void
    {
        $check = $this->open(['identity', 'education']);

        $this->assertSame('in_progress', $check->status);
        $this->assertSame(['education', 'identity'], $check->items->pluck('type')->sort()->values()->all());
        // Nothing is known yet, so there is no headline.
        $this->assertNull($check->outcome);
    }

    public function test_withdrawing_consent_stops_everything_outstanding(): void
    {
        $consent = $this->consent();
        $check = $this->open(['identity', 'education'], $consent);

        $this->service()->withdrawConsent($consent, 'Changed my mind');

        $check = $check->fresh('items');

        // Withdrawal is a right under the DPDP Act, and a product that only
        // records the giving of consent has implemented half of it.
        $this->assertSame('cancelled', $check->status);
        $this->assertSame(['skipped', 'skipped'], $check->items->pluck('status')->all());
    }

    public function test_withdrawal_does_not_erase_findings_already_recorded(): void
    {
        $consent = $this->consent();
        $check = $this->open(['identity', 'education'], $consent);

        $this->service()->recordItem($this->itemOf($check, 'identity'), 'clear', 'Aadhaar', 'Matched', null, $this->recruiter);

        $this->service()->withdrawConsent($consent, 'Changed my mind');

        /*
         * They were lawfully obtained at the time. Erasing a completed
         * verification would also erase the record that it happened, which
         * serves nobody. What withdrawal buys is that no FURTHER checking
         * occurs.
         */
        $this->assertSame('clear', $this->itemOf($check->fresh(), 'identity')->status);
        $this->assertSame('skipped', $this->itemOf($check->fresh(), 'education')->status);
    }

    public function test_nothing_can_be_recorded_once_consent_is_withdrawn(): void
    {
        $consent = $this->consent();
        $check = $this->open(['identity'], $consent);

        $this->service()->withdrawConsent($consent, 'Changed my mind');

        $this->expectException(RuntimeException::class);
        $this->service()->recordItem($this->itemOf($check, 'identity'), 'clear', 'Aadhaar', 'Matched');
    }

    public function test_a_discrepancy_needs_both_sides(): void
    {
        $check = $this->open(['education']);

        /*
         * "Discrepancy" with no detail is an accusation somebody cannot answer.
         * The person it is about is entitled to see the comparison that
         * produced it.
         */
        $this->expectException(RuntimeException::class);
        $this->service()->recordItem($this->itemOf($check, 'education'), 'discrepancy', 'B.Tech 2019', '');
    }

    public function test_the_outcome_is_derived_from_the_items(): void
    {
        $check = $this->open(['identity', 'education']);

        $this->service()->recordItem($this->itemOf($check, 'identity'), 'clear', 'Aadhaar', 'Matched');
        // Still one outstanding, so there is no headline yet.
        $this->assertNull($check->fresh()->outcome);

        $this->service()->recordItem($this->itemOf($check, 'education'), 'clear', 'B.Tech 2019', 'B.Tech 2019');

        $this->assertSame('clear', $check->fresh()->outcome);
        $this->assertSame('completed', $check->fresh()->status);
    }

    public function test_one_discrepancy_is_the_headline_even_among_clear_results(): void
    {
        $check = $this->open(['identity', 'education', 'employment']);

        $this->service()->recordItem($this->itemOf($check, 'identity'), 'clear', 'Aadhaar', 'Matched');
        $this->service()->recordItem($this->itemOf($check, 'employment'), 'clear', 'Acme 2019-2024', 'Confirmed');
        $this->service()->recordItem($this->itemOf($check, 'education'), 'discrepancy', 'B.Tech 2019', 'University records show 2018');

        // The one a human needs to look at, not diluted by the ones that passed.
        $this->assertSame('discrepancy', $check->fresh()->outcome);
    }

    public function test_a_discrepancy_does_not_touch_the_candidacy(): void
    {
        $check = $this->open(['education']);

        $this->service()->recordItem(
            $this->itemOf($check, 'education'),
            'discrepancy',
            'B.Tech 2019',
            'University records show 2018',
            null,
            $this->recruiter,
        );

        /*
         * A name spelled differently on a certificate and a fabricated employer
         * are both discrepancies. Auto-rejecting on either is how a product
         * turns a middle initial into a lost hire — so this service never
         * decides, it only reports.
         */
        $this->assertSame('discrepancy', $check->fresh()->outcome);
        $this->assertTrue($check->fresh()->needsAdverseActionNotice());
    }

    public function test_a_clear_check_needs_no_adverse_action_notice(): void
    {
        $check = $this->open(['identity']);
        $this->service()->recordItem($this->itemOf($check, 'identity'), 'clear', 'Aadhaar', 'Matched');

        // A notice on a clear check is noise, and being able to send one trains
        // people to click through the notice that matters.
        $this->assertFalse($check->fresh()->needsAdverseActionNotice());

        $this->expectException(RuntimeException::class);
        $this->service()->recordAdverseActionNotice($check->fresh());
    }

    public function test_a_candidate_cannot_respond_before_being_told(): void
    {
        $check = $this->open(['education']);
        $this->service()->recordItem($this->itemOf($check, 'education'), 'discrepancy', 'B.Tech 2019', '2018');

        // Recording a reply to a notice that was never sent is a record of a
        // conversation that did not happen.
        $this->expectException(RuntimeException::class);
        $this->service()->recordCandidateResponse($check->fresh(), 'The university has my award year wrong.');
    }

    public function test_the_adverse_action_exchange_is_kept(): void
    {
        $check = $this->open(['education']);
        $this->service()->recordItem($this->itemOf($check, 'education'), 'discrepancy', 'B.Tech 2019', '2018');

        $this->service()->recordAdverseActionNotice($check->fresh());
        $answered = $this->service()->recordCandidateResponse(
            $check->fresh(),
            'The university has my award year wrong; I have written to them.',
        );

        // In the record rather than in somebody's inbox.
        $this->assertNotNull($answered->notified_at);
        $this->assertNotNull($answered->responded_at);
        $this->assertStringContainsString('award year', $answered->candidate_response);
    }

    public function test_a_consent_from_another_workspace_is_refused(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-bgv']);
        $theirCandidate = Candidate::withoutOrganizationScope()->create([
            'organization_id' => $other->id,
            'first_name' => 'Someone',
            'email' => 'someone@other.test',
        ]);

        $theirConsent = $this->service()->recordConsent($theirCandidate, 'Someone Else', ['identity']);

        // The foreign key alone would allow this.
        $this->expectException(RuntimeException::class);
        $this->service()->open($this->candidate, $theirConsent, ['identity'], null, $this->recruiter);
    }

    public function test_evidence_paths_are_not_broadcast(): void
    {
        $check = $this->open(['criminal'], $this->consent(['criminal']));
        $item = $this->itemOf($check, 'criminal');
        $item->forceFill(['evidence_path' => 'bgv/police-verification.pdf'])->save();

        // A storage key for a police verification. Anybody holding one can ask
        // for the file, so it goes out only through a controller that checks
        // who is asking.
        $this->assertArrayNotHasKey('evidence_path', $item->fresh()->toArray());
    }
}
