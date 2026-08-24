<?php

namespace App\Services\Recruitment;

use App\Models\JobOffer;
use App\Models\OfferSignature;
use App\Services\Payroll\LegalEntityResolver;
use Carbon\Carbon;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\View;
use RuntimeException;

/**
 * Generating the offer letter, and signing it.
 *
 * THE SIGNING LINK IS THE ONLY CREDENTIAL A CANDIDATE HAS. They are not a user
 * of this system and never will be, so the token is treated exactly like a
 * password: generated from a CSPRNG, stored only as a SHA-256 hash, compared
 * with hash_equals, and cleared the moment it is used. A leaked database must
 * not hand somebody the ability to accept offers.
 *
 * WHAT MAKES AN ELECTRONIC SIGNATURE WORTH ANYTHING is not the drawing — it is
 * the record around it. Which document, at what time, from where. The document
 * hash is the load-bearing one: without it, "I never agreed to that salary"
 * has no answer, because the letter could have been regenerated afterwards with
 * a different number. So the PDF is rendered ONCE, hashed, and that exact
 * fingerprint is stored with the signature.
 */
class OfferLetterService
{
    /** How long a signing link stays usable when the offer has no explicit expiry. */
    private const DEFAULT_LINK_DAYS = 14;

    public function __construct(
        private readonly LegalEntityResolver $entities,
    ) {
    }

    /**
     * Issue a signing link for a sent offer.
     *
     * Returns the PLAIN token, which is the only time it exists in readable
     * form — the caller puts it in a URL and it is never recoverable from the
     * database afterwards.
     */
    public function issueSigningToken(JobOffer $offer): string
    {
        if ($offer->status !== 'sent') {
            throw new RuntimeException('An offer has to be sent before it can be signed.');
        }

        $plain = bin2hex(random_bytes(32));

        $offer->forceFill([
            'signing_token_hash' => hash('sha256', $plain),
            /*
             * The link expires with the offer where one has an expiry, and
             * after a fortnight where it does not. A signing link that never
             * expires is a standing invitation to accept a job somebody stopped
             * offering months ago.
             */
            'signing_token_expires_at' => $offer->valid_until
                ? $offer->valid_until->copy()->endOfDay()
                : now()->addDays(self::DEFAULT_LINK_DAYS),
        ])->save();

        return $plain;
    }

    /**
     * Resolve an offer from a signing token.
     *
     * Deliberately returns null for every failure — wrong token, expired link,
     * already-signed offer — rather than distinguishing them. An unauthenticated
     * endpoint that says "that link expired" versus "no such link" confirms
     * which tokens exist, and the candidate cannot act on the difference anyway.
     */
    public function offerForToken(?string $token): ?JobOffer
    {
        if (! is_string($token) || strlen($token) !== 64) {
            return null;
        }

        $hash = hash('sha256', $token);

        $offer = JobOffer::withoutOrganizationScope()
            ->whereNotNull('signing_token_hash')
            ->where('status', 'sent')
            ->where('signing_token_hash', $hash)
            ->first();

        if (! $offer) {
            return null;
        }

        // Constant-time, even though the lookup above already matched. Cheap,
        // and it keeps the comparison honest if the query ever loosens.
        if (! hash_equals((string) $offer->signing_token_hash, $hash)) {
            return null;
        }

        if ($offer->signing_token_expires_at && $offer->signing_token_expires_at->isPast()) {
            return null;
        }

        return $offer;
    }

    /**
     * Render the letter.
     *
     * The signed version is rendered from the stored signature so the audit
     * block appears beneath the mark. The unsigned version shows an empty
     * signature area rather than nothing, so a candidate reading it knows what
     * is being asked.
     */
    public function render(JobOffer $offer): string
    {
        $offer->loadMissing(['application.candidate', 'application.opening', 'legalEntity']);

        $entity = $offer->legalEntity ?: $this->entities->primaryFor((int) $offer->organization_id);
        $candidate = $offer->application?->candidate;
        $signature = OfferSignature::withoutOrganizationScope()
            ->where('job_offer_id', $offer->id)
            ->first();

        $html = View::make('recruitment.offer-letter', [
            'entityName' => $entity?->legal_name ?: ($entity?->name ?: 'The Company'),
            'entityAddress' => $entity?->address_line,
            'candidateName' => trim(($candidate?->first_name ?? '').' '.($candidate?->last_name ?? '')) ?: 'Candidate',
            'designation' => $offer->designation,
            'annualCtc' => $this->indianFormat($offer->annual_ctc),
            'joiningBonus' => $offer->joining_bonus && (float) $offer->joining_bonus > 0
                ? $this->indianFormat($offer->joining_bonus)
                : null,
            'joiningDate' => $offer->proposed_joining_date?->format('j F Y'),
            'validUntil' => $offer->valid_until?->format('j F Y'),
            'issuedOn' => ($offer->sent_at ?: $offer->created_at ?: now())->format('j F Y'),
            'reference' => $offer->application?->opening?->code ?: 'OFFER-'.$offer->id,
            'issuerName' => null,
            'signature' => $signature ? [
                'signer_name' => $signature->signer_name,
                'signed_at' => $signature->signed_at?->format('j F Y \a\t H:i'),
                'ip_address' => $signature->ip_address,
                'document_hash' => $signature->document_hash,
            ] : null,
        ])->render();

        return $this->toPdf($html);
    }

    /**
     * Record a candidate's signature.
     *
     * The document hash is taken from the letter AS IT STANDS UNSIGNED, before
     * the signature block is added — that is the document they actually read,
     * and hashing the signed version would fingerprint something they never
     * saw.
     *
     * The token is cleared in the same transaction as the signature is written.
     * A link that still works after use is a link somebody can accept twice.
     */
    public function sign(
        JobOffer $offer,
        string $signerName,
        ?string $signatureImage,
        ?string $ipAddress,
        ?string $userAgent,
        OfferService $offers,
        HiringPipelineService $pipeline,
    ): OfferSignature {
        $signerName = trim($signerName);

        if ($signerName === '') {
            throw new RuntimeException('Please type your name to sign.');
        }

        if ($offer->status !== 'sent') {
            throw new RuntimeException('This offer is no longer open for signature.');
        }

        $documentHash = hash('sha256', $this->render($offer));

        return DB::transaction(function () use (
            $offer, $signerName, $signatureImage, $ipAddress, $userAgent, $documentHash, $offers, $pipeline
        ) {
            $signature = OfferSignature::query()->create([
                'organization_id' => $offer->organization_id,
                'job_offer_id' => $offer->id,
                'signer_name' => $signerName,
                'signer_email' => $offer->application?->candidate?->email,
                'signature_image' => $signatureImage,
                'ip_address' => $ipAddress,
                // Truncated to the column, because a long agent string would
                // otherwise abort a signature that is otherwise perfectly good.
                'user_agent' => $userAgent ? substr($userAgent, 0, 512) : null,
                'document_hash' => $documentHash,
                'signed_at' => now(),
            ]);

            $offer->forceFill([
                'signing_token_hash' => null,
                'signing_token_expires_at' => null,
            ])->save();

            // Acceptance goes through OfferService so the candidacy is moved to
            // hired by the pipeline. Setting the status here would leave the
            // application still sitting in the live board.
            $offers->respond($offer->fresh(), true, $pipeline);

            return $signature;
        });
    }

    /** Dompdf, configured the same way payslips and Form 16 are. */
    private function toPdf(string $html): string
    {
        $options = new Options();
        $options->set('isRemoteEnabled', false);
        $options->set('isHtml5ParserEnabled', true);
        $options->set('defaultFont', 'DejaVu Sans');

        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html);
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();

        return (string) $dompdf->output();
    }

    /**
     * 1234567 becomes 12,34,567.
     *
     * The Indian grouping, because that is how a salary is read by the person
     * receiving it, and a western-grouped figure on an offer letter reads as
     * carelessness about the market you are hiring in.
     */
    private function indianFormat(string|int|float|null $amount): string
    {
        $value = number_format((float) $amount, 0, '.', '');
        $negative = str_starts_with($value, '-');
        $value = ltrim($value, '-');

        if (strlen($value) <= 3) {
            return ($negative ? '-' : '').$value;
        }

        $last3 = substr($value, -3);
        $rest = substr($value, 0, -3);
        $rest = preg_replace('/\B(?=(\d{2})+(?!\d))/', ',', $rest);

        return ($negative ? '-' : '').$rest.','.$last3;
    }
}
