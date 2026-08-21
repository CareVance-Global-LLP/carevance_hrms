<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One interview in a candidacy.
 *
 * `recommendation` is the panel's AGREED outcome, written after the fact, and
 * it is nullable because an interview that has not happened has no verdict.
 * The individual views live in `interview_feedback` and are never collapsed
 * into this column — a panel of three splitting two-to-one is the most
 * important signal in a hiring decision, and an aggregate destroys it.
 */
class Interview extends Model
{
    use BelongsToOrganization;

    public const MODES = ['phone', 'video', 'onsite', 'take_home'];

    public const STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];

    public const VERDICTS = ['strong_yes', 'yes', 'no', 'strong_no'];

    protected $fillable = [
        'organization_id',
        'job_application_id',
        'hiring_stage_id',
        'title',
        'mode',
        'location_or_link',
        'scheduled_at',
        'duration_minutes',
        'status',
        'recommendation',
        'scheduled_by',
        'cancellation_reason',
    ];

    protected $casts = [
        'scheduled_at' => 'datetime',
        'duration_minutes' => 'integer',
    ];

    public function application(): BelongsTo
    {
        return $this->belongsTo(JobApplication::class, 'job_application_id');
    }

    public function stage(): BelongsTo
    {
        return $this->belongsTo(HiringStage::class, 'hiring_stage_id');
    }

    public function feedback(): HasMany
    {
        return $this->hasMany(InterviewFeedback::class);
    }

    public function panellists(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'interview_panellists')
            ->withPivot('is_lead')
            ->withTimestamps();
    }

    /**
     * How much of the panel has actually responded.
     *
     * Invited and submitted are different states, and "two of three have
     * responded" is a question a recruiter asks constantly. Counted rather than
     * stored, because a stored counter and the rows behind it drift the first
     * time somebody is added to a panel late.
     *
     * @return array{invited: int, submitted: int, outstanding: int}
     */
    public function panelProgress(): array
    {
        $invited = $this->panellists()->count();
        $submitted = $this->feedback()->whereNotNull('submitted_at')->count();

        return [
            'invited' => $invited,
            'submitted' => $submitted,
            'outstanding' => max(0, $invited - $submitted),
        ];
    }

    /**
     * Is the panel split?
     *
     * True when submitted verdicts disagree on the yes/no line. Surfaced rather
     * than averaged: a two-to-one split is a conversation the hiring manager
     * needs to have, and a mean score of "3.0" hides it completely.
     */
    public function isSplit(): bool
    {
        $verdicts = $this->feedback()
            ->whereNotNull('submitted_at')
            ->pluck('verdict');

        if ($verdicts->count() < 2) {
            return false;
        }

        $positive = $verdicts->filter(fn ($v) => in_array($v, ['strong_yes', 'yes'], true))->count();

        return $positive > 0 && $positive < $verdicts->count();
    }
}
