<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A background verification on one person.
 *
 * NOTHING HERE DECIDES ANYBODY'S CANDIDACY. The outcome vocabulary is
 * deliberately clear / discrepancy / insufficient rather than pass / fail: a
 * name spelled differently on a degree certificate and a fabricated employer
 * are both discrepancies, and collapsing them into "failed" is how a product
 * ends up auto-rejecting somebody over a middle initial. What to do about a
 * finding is an employer's decision, taken by a person.
 */
class BackgroundCheck extends Model
{
    use BelongsToOrganization;

    public const STATUSES = ['pending_consent', 'awaiting_start', 'in_progress', 'completed', 'cancelled'];

    public const OUTCOMES = ['clear', 'discrepancy', 'insufficient'];

    protected $fillable = [
        'organization_id',
        'candidate_id',
        'user_id',
        'job_application_id',
        'consent_id',
        'package',
        'vendor',
        'vendor_reference',
        'status',
        'outcome',
        'requested_at',
        'completed_at',
        'notified_at',
        'candidate_response',
        'responded_at',
        'requested_by',
    ];

    protected $casts = [
        'requested_at' => 'datetime',
        'completed_at' => 'datetime',
        'notified_at' => 'datetime',
        'responded_at' => 'datetime',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(BackgroundCheckItem::class);
    }

    public function consent(): BelongsTo
    {
        return $this->belongsTo(BackgroundCheckConsent::class, 'consent_id');
    }

    public function candidate(): BelongsTo
    {
        return $this->belongsTo(Candidate::class);
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    /**
     * May checks actually run?
     *
     * Live consent, not merely a consent row. Somebody who has withdrawn is
     * entitled to have the checking stop, and reading the flag rather than the
     * relationship is how that gets missed.
     */
    public function hasLiveConsent(): bool
    {
        return $this->consent !== null && $this->consent->isLive();
    }

    /**
     * The overall finding, derived from the items.
     *
     * Derived rather than stored-and-hoped: a summary that can drift from the
     * rows beneath it is one somebody will eventually act on while it is wrong.
     *
     * Precedence is discrepancy, then insufficient, then clear. A single
     * discrepancy is the headline even where everything else came back clean,
     * because that is the one a human needs to look at.
     */
    public function deriveOutcome(): ?string
    {
        $items = $this->items;

        if ($items->isEmpty() || $items->contains(fn (BackgroundCheckItem $item) => ! $item->isSettled())) {
            return null;
        }

        if ($items->contains(fn (BackgroundCheckItem $item) => $item->status === 'discrepancy')) {
            return 'discrepancy';
        }

        if ($items->contains(fn (BackgroundCheckItem $item) => $item->status === 'insufficient')) {
            return 'insufficient';
        }

        return 'clear';
    }

    /**
     * Has the person been told about a finding that could count against them?
     *
     * Only meaningful where there is something to tell them about. A clear
     * check needs no adverse-action notice, and demanding one would train
     * people to click through the notice that matters.
     */
    public function needsAdverseActionNotice(): bool
    {
        return in_array($this->outcome, ['discrepancy', 'insufficient'], true)
            && $this->notified_at === null;
    }
}
