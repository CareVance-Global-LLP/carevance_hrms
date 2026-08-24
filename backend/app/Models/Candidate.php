<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A person who might be hired.
 *
 * A candidate is the PERSON; a JobApplication is their candidacy for one
 * opening. Keeping them apart is what lets somebody good apply for a second
 * role without either losing their history or duplicating the human.
 *
 * `email` is unique per ORGANIZATION, deliberately unlike `users.email` which
 * is globally unique. The same person legitimately applies to two different
 * customers on this platform, and a global constraint would let one customer's
 * pipeline block another's.
 */
class Candidate extends Model
{
    use BelongsToOrganization;

    public const SOURCES = ['direct', 'referral', 'portal', 'agency', 'inbound'];

    protected $fillable = [
        'organization_id',
        'first_name',
        'last_name',
        'email',
        'phone',
        'resume_path',
        'linkedin_url',
        'source',
        'referred_by',
        'current_company',
        'current_ctc',
        'expected_ctc',
        'notice_period_days',
        'location',
    ];

    protected $casts = [
        'current_ctc' => 'decimal:2',
        'expected_ctc' => 'decimal:2',
        'notice_period_days' => 'integer',
    ];

    /**
     * The résumé path is not broadcast.
     *
     * It is a storage key, and anybody holding one can ask for the file. The
     * download goes through a controller that checks who is asking.
     */
    protected $hidden = ['resume_path'];

    public function applications(): HasMany
    {
        return $this->hasMany(JobApplication::class);
    }

    public function referrer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'referred_by');
    }

    public function getFullNameAttribute(): string
    {
        return trim($this->first_name.' '.($this->last_name ?? ''));
    }
}
