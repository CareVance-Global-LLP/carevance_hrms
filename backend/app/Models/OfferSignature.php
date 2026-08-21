<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A candidate's acceptance, and the evidence around it.
 *
 * The mark is the least important column here. `document_hash` is the
 * load-bearing one: it fingerprints the letter as the candidate actually read
 * it, so "I never agreed to that salary" has an answer even if the letter is
 * regenerated later.
 */
class OfferSignature extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'job_offer_id',
        'signer_name',
        'signer_email',
        'signature_image',
        'ip_address',
        'user_agent',
        'document_hash',
        'signed_at',
    ];

    protected $casts = [
        'signed_at' => 'datetime',
    ];

    /**
     * The drawn signature is not broadcast in listings.
     *
     * It is a base64 image of somebody's handwriting; it belongs on the letter
     * and in an audit view, not in every JSON payload that happens to include
     * an offer.
     */
    protected $hidden = ['signature_image'];

    public function offer(): BelongsTo
    {
        return $this->belongsTo(JobOffer::class, 'job_offer_id');
    }
}
