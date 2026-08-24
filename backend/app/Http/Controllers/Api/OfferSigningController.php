<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\JobOffer;
use App\Services\Recruitment\HiringPipelineService;
use App\Services\Recruitment\OfferLetterService;
use App\Services\Recruitment\OfferService;
use App\Services\Payroll\LegalEntityResolver;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use RuntimeException;

/**
 * The candidate's side of an offer.
 *
 * UNAUTHENTICATED BY NECESSITY. A candidate is not a user of this system and
 * never will be — creating an account to accept a job is a step that loses
 * offers. The signing token IS the authentication, which is why it is 32 random
 * bytes, stored only as a hash, and cleared the moment it is used.
 *
 * EVERY FAILURE LOOKS THE SAME. Wrong token, expired link, already-signed
 * offer, withdrawn offer — all return the same 404. Distinguishing them tells
 * an unauthenticated caller which tokens exist, and the candidate cannot act on
 * the difference anyway: their next step is to contact the recruiter either
 * way.
 *
 * WHAT IS DELIBERATELY NOT RETURNED: the candidate's email, the opening's
 * internal reference, who approved the offer, the hiring pipeline. Anybody
 * holding the link sees the letter and its headline terms, and nothing about
 * how the decision was made.
 */
class OfferSigningController extends Controller
{
    public function __construct(
        private readonly OfferLetterService $letters,
        private readonly OfferService $offers,
        private readonly HiringPipelineService $pipeline,
        private readonly LegalEntityResolver $entities,
    ) {
    }

    /** The headline terms, for the page around the document. */
    public function show(Request $request, string $token): JsonResponse
    {
        $offer = $this->letters->offerForToken($token);

        if (! $offer) {
            return $this->gone();
        }

        $offer->loadMissing(['application.candidate', 'legalEntity']);

        /*
         * Falls back to the organization's primary entity, exactly as the
         * letter does. Without this the page showed no company while the PDF
         * beneath it named one, which is a small inconsistency in a document
         * somebody is being asked to trust.
         */
        $entity = $offer->legalEntity ?: $this->entities->primaryFor((int) $offer->organization_id);

        return response()->json([
            'data' => [
                'designation' => $offer->designation,
                'annual_ctc' => $offer->annual_ctc,
                'joining_bonus' => $offer->joining_bonus,
                'proposed_joining_date' => $offer->proposed_joining_date?->toDateString(),
                'valid_until' => $offer->valid_until?->toDateString(),
                'company' => $entity?->legal_name ?: $entity?->name,
                // First name only. The full record is not theirs to read back.
                'candidate_first_name' => $offer->application?->candidate?->first_name,
            ],
        ]);
    }

    /**
     * The letter itself.
     *
     * Inline rather than an attachment: somebody is being asked to agree to
     * this, and making them download a file first is a step at which people
     * stop reading.
     */
    public function document(Request $request, string $token): Response
    {
        $offer = $this->letters->offerForToken($token);

        if (! $offer) {
            return response('Not found', 404);
        }

        return response($this->letters->render($offer), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'inline; filename="offer-letter.pdf"',
            // Never cached by a shared proxy: the URL carries a credential.
            'Cache-Control' => 'private, no-store, max-age=0',
        ]);
    }

    /** Accept, by signing. */
    public function sign(Request $request, string $token): JsonResponse
    {
        $offer = $this->letters->offerForToken($token);

        if (! $offer) {
            return $this->gone();
        }

        $validated = $request->validate([
            'signer_name' => 'required|string|max:150',
            /*
             * A drawn signature is optional — typing your name is a valid
             * electronic signature, and insisting on a canvas excludes anybody
             * on a keyboard or using assistive technology.
             */
            'signature_image' => 'nullable|string|max:400000',
        ]);

        try {
            $signature = $this->letters->sign(
                $offer,
                $validated['signer_name'],
                $validated['signature_image'] ?? null,
                $request->ip(),
                $request->userAgent(),
                $this->offers,
                $this->pipeline,
            );
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        return response()->json([
            'message' => 'Thank you. Your acceptance has been recorded.',
            'data' => [
                'signed_at' => $signature->signed_at?->toIso8601String(),
                // Shown back so the candidate can see what was recorded about
                // them, which is the least a signature page owes somebody.
                'document_hash' => $signature->document_hash,
            ],
        ]);
    }

    /**
     * Decline, without signing.
     *
     * Offered on the same page as accepting. A candidate who has decided
     * against a job will otherwise simply not respond, and "no reply" is a
     * far worse outcome for the recruiter than a reason.
     */
    public function decline(Request $request, string $token): JsonResponse
    {
        $offer = $this->letters->offerForToken($token);

        if (! $offer) {
            return $this->gone();
        }

        $validated = $request->validate([
            'reason' => 'required|string|max:1000',
        ]);

        try {
            $this->offers->respond($offer, false, $this->pipeline, $validated['reason']);
        } catch (RuntimeException $exception) {
            return response()->json(['message' => $exception->getMessage()], 422);
        }

        // The link dies with the decision either way.
        $offer->forceFill(['signing_token_hash' => null, 'signing_token_expires_at' => null])->save();

        return response()->json(['message' => 'Thank you for letting us know.']);
    }

    /**
     * One response for every failure.
     *
     * Deliberately not "expired" or "already signed" — see the class docblock.
     */
    private function gone(): JsonResponse
    {
        return response()->json([
            'message' => 'This link is no longer valid. Please contact the person who sent it to you.',
        ], 404);
    }
}
