<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Somebody's agreement to be checked.
 *
 * Its own record rather than a flag, because it IS the evidence: what they
 * agreed to, when, and from where. A consent that cannot be produced later is
 * one that did not happen as far as a regulator is concerned.
 *
 * `scope` is stored verbatim rather than inferred from whatever the package
 * contains today. Somebody who agreed to employment verification has not agreed
 * to a credit check, and a package that gains a check next year must not
 * retroactively widen a consent given last year.
 */
class BackgroundCheckConsent extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'candidate_id',
        'user_id',
        'consented_name',
        'consented_email',
        'scope',
        'notice_text',
        'ip_address',
        'user_agent',
        'consented_at',
        'withdrawn_at',
        'withdrawal_reason',
    ];

    protected $casts = [
        'scope' => 'array',
        'consented_at' => 'datetime',
        'withdrawn_at' => 'datetime',
    ];

    public function candidate(): BelongsTo
    {
        return $this->belongsTo(Candidate::class);
    }

    /**
     * Is this consent still good?
     *
     * Withdrawal is a right under the DPDP Act, and a product that only records
     * the giving of consent has implemented half of it.
     */
    public function isLive(): bool
    {
        return $this->withdrawn_at === null;
    }

    /** Does it actually cover this kind of check? */
    public function covers(string $type): bool
    {
        return $this->isLive() && in_array($type, (array) $this->scope, true);
    }
}
