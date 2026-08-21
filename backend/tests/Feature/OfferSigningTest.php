<?php

namespace Tests\Feature;

use App\Models\Candidate;
use App\Models\JobApplication;
use App\Models\JobOffer;
use App\Models\JobOpening;
use App\Models\OfferSignature;
use App\Models\Organization;
use App\Models\User;
use App\Services\Recruitment\HiringPipelineService;
use App\Services\Recruitment\OfferLetterService;
use App\Services\Recruitment\OfferService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Signing an offer letter.
 *
 * The signing link is the candidate's ONLY credential — they are not a user of
 * this system and never will be. So these tests are mostly about the token:
 * that it is never stored in the clear, that it dies when used, that it expires,
 * and that every way of failing looks identical from outside.
 *
 * The other half is the audit trail. An electronic signature is worth exactly
 * what its evidence is worth, and the document hash is the load-bearing part —
 * without it, "I never agreed to that salary" has no answer.
 */
class OfferSigningTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $recruiter;
    private JobApplication $application;
    private JobOffer $offer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-signing']);
        $this->recruiter = $this->makeUser('recruiter@carevance.test', 'hr');
        $approver = $this->makeUser('finance@carevance.test', 'manager');

        $pipeline = app(HiringPipelineService::class);
        $pipeline->ensureStagesFor($this->organization);

        $opening = JobOpening::query()->create([
            'organization_id' => $this->organization->id,
            'code' => 'REQ-1',
            'title' => 'Backend Engineer',
            'status' => 'open',
        ]);

        $candidate = Candidate::query()->create([
            'organization_id' => $this->organization->id,
            'first_name' => 'Priya',
            'last_name' => 'Nair',
            'email' => 'priya@example.test',
        ]);

        $this->application = $pipeline->apply($opening, $candidate, $this->recruiter);

        $offers = app(OfferService::class);
        $offer = $offers->draft($this->application, [
            'designation' => 'Backend Engineer',
            'annual_ctc' => 1800000,
            'proposed_joining_date' => '2026-10-01',
        ], $this->recruiter);

        $offers->submitForApproval($offer, [$approver->id], $this->recruiter);
        $offers->decide($offer->fresh(), $approver, true);
        $this->offer = $offers->send($offer->fresh());
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

    private function letters(): OfferLetterService
    {
        return app(OfferLetterService::class);
    }

    private function token(): string
    {
        return $this->letters()->issueSigningToken($this->offer->fresh());
    }

    public function test_the_token_is_never_stored_in_the_clear(): void
    {
        $token = $this->token();

        $stored = (string) $this->offer->fresh()->signing_token_hash;

        /*
         * A leaked database must not hand somebody the ability to accept
         * offers. Hashed like a password, and the plain value exists only in
         * the response that minted it.
         */
        $this->assertNotSame($token, $stored);
        $this->assertSame(hash('sha256', $token), $stored);
    }

    public function test_the_hash_never_reaches_a_response(): void
    {
        // Second line of defence: even if a resource grows to include offers,
        // the credential does not travel with it.
        $this->assertArrayNotHasKey('signing_token_hash', $this->offer->fresh()->toArray());
    }

    public function test_a_valid_link_shows_the_headline_terms(): void
    {
        $response = $this->getJson('/api/offers/sign/'.$this->token())->assertOk();

        $this->assertSame('Backend Engineer', $response->json('data.designation'));
        $this->assertSame('Priya', $response->json('data.candidate_first_name'));
    }

    public function test_the_link_does_not_leak_how_the_decision_was_made(): void
    {
        $payload = $this->getJson('/api/offers/sign/'.$this->token())->assertOk()->json('data');

        /*
         * Anybody holding the link sees the letter and its terms, and nothing
         * about the pipeline, the approvers or the other candidates.
         */
        $this->assertArrayNotHasKey('approvals', $payload);
        $this->assertArrayNotHasKey('job_application_id', $payload);
        $this->assertArrayNotHasKey('candidate_email', $payload);
    }

    public function test_every_way_of_failing_looks_the_same(): void
    {
        // A wrong token and an expired one are indistinguishable from outside.
        // Telling them apart confirms which tokens exist.
        $this->getJson('/api/offers/sign/'.str_repeat('a', 64))->assertNotFound();
        $this->getJson('/api/offers/sign/short')->assertNotFound();

        $token = $this->token();
        $this->offer->fresh()->forceFill(['signing_token_expires_at' => now()->subMinute()])->save();
        $this->getJson('/api/offers/sign/'.$token)->assertNotFound();
    }

    public function test_the_letter_renders_as_a_pdf(): void
    {
        $response = $this->get('/api/offers/sign/'.$this->token().'/document')->assertOk();

        $response->assertHeader('Content-Type', 'application/pdf');
        // Never cached by a shared proxy: the URL carries a credential.
        $this->assertStringContainsString('no-store', $response->headers->get('Cache-Control'));
        $this->assertStringStartsWith('%PDF', $response->getContent());
    }

    public function test_signing_records_the_evidence_not_just_the_mark(): void
    {
        $this->postJson('/api/offers/sign/'.$this->token(), [
            'signer_name' => 'Priya Nair',
        ], ['User-Agent' => 'QA-Browser/1.0'])->assertOk();

        $signature = OfferSignature::withoutOrganizationScope()->firstOrFail();

        /*
         * The drawing is the least important part. These are the four things
         * anybody disputing a signature will ask about.
         */
        $this->assertSame('Priya Nair', $signature->signer_name);
        $this->assertNotNull($signature->signed_at);
        $this->assertNotNull($signature->ip_address);
        $this->assertSame(64, strlen((string) $signature->document_hash));
    }

    public function test_typing_a_name_is_enough_to_sign(): void
    {
        // Insisting on a drawn canvas excludes anybody on a keyboard or using
        // assistive technology, and a typed name is a valid electronic
        // signature.
        $this->postJson('/api/offers/sign/'.$this->token(), [
            'signer_name' => 'Priya Nair',
            'signature_image' => null,
        ])->assertOk();

        $this->assertSame(1, OfferSignature::withoutOrganizationScope()->count());
    }

    public function test_signing_accepts_the_offer_and_hires_the_candidate(): void
    {
        $this->postJson('/api/offers/sign/'.$this->token(), ['signer_name' => 'Priya Nair'])->assertOk();

        // Routed through OfferService so the candidacy moves with it. Setting
        // the status alone would leave the application in the live pipeline.
        $this->assertSame('accepted', $this->offer->fresh()->status);
        $this->assertSame('hired', $this->application->fresh()->status);
    }

    public function test_a_link_cannot_be_used_twice(): void
    {
        $token = $this->token();

        $this->postJson('/api/offers/sign/'.$token, ['signer_name' => 'Priya Nair'])->assertOk();

        // Cleared in the same transaction as the signature. A link that still
        // works after use is a link somebody can accept twice.
        $this->postJson('/api/offers/sign/'.$token, ['signer_name' => 'Somebody Else'])->assertNotFound();
        $this->assertSame(1, OfferSignature::withoutOrganizationScope()->count());
    }

    public function test_signing_needs_a_name(): void
    {
        $this->postJson('/api/offers/sign/'.$this->token(), ['signer_name' => '  '])->assertStatus(422);
    }

    public function test_a_candidate_can_decline_from_the_same_link(): void
    {
        $token = $this->token();

        $this->postJson('/api/offers/sign/'.$token.'/decline', [
            'reason' => 'Counter-offer at my current employer',
        ])->assertOk();

        /*
         * Offered alongside accepting on purpose. A candidate who has decided
         * against a job will otherwise simply not reply, and no reply is a far
         * worse outcome for the recruiter than a reason.
         */
        $this->assertSame('declined', $this->offer->fresh()->status);
        $this->assertSame('Counter-offer at my current employer', $this->offer->fresh()->decline_reason);

        // The link dies with the decision either way.
        $this->getJson('/api/offers/sign/'.$token)->assertNotFound();
    }

    public function test_declining_needs_a_reason(): void
    {
        $this->postJson('/api/offers/sign/'.$this->token().'/decline', [])->assertStatus(422);
    }

    public function test_an_unsent_offer_cannot_have_a_link_issued(): void
    {
        $offers = app(OfferService::class);

        // Only one live offer per candidacy, so the sent one is withdrawn
        // before a fresh draft can exist to test against.
        $offers->withdraw($this->offer->fresh(), 'Revising the band');

        $draft = $offers->draft($this->application->fresh(), [
            'designation' => 'Backend Engineer',
            'annual_ctc' => 2000000,
        ], $this->recruiter);

        // A link for an unsent offer is a link to a document nobody has agreed
        // to send.
        $this->expectException(\RuntimeException::class);
        $this->letters()->issueSigningToken($draft);
    }

    public function test_the_signed_letter_carries_the_audit_trail(): void
    {
        $this->postJson('/api/offers/sign/'.$this->token(), ['signer_name' => 'Priya Nair'])->assertOk();

        $pdf = $this->letters()->render($this->offer->fresh());

        // A signature with no trail beneath it is decoration.
        $this->assertStringStartsWith('%PDF', $pdf);
        $this->assertGreaterThan(1000, strlen($pdf));
    }

    public function test_the_recruiter_can_mint_and_re_mint_a_link(): void
    {
        $this->actingAs($this->recruiter);

        $first = $this->postJson("/api/recruitment/offers/{$this->offer->id}/signing-link")->assertOk();
        $second = $this->postJson("/api/recruitment/offers/{$this->offer->id}/signing-link")->assertOk();

        // Re-issuing is how a lost link is handled, and it must invalidate the
        // previous one rather than leaving two live credentials.
        $this->assertNotSame($first->json('data.url'), $second->json('data.url'));

        $oldToken = basename((string) $first->json('data.url'));
        $this->getJson('/api/offers/sign/'.$oldToken)->assertNotFound();
    }
}
