<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One interviewer's verdict.
 *
 * Kept per person and never collapsed into the interview. A panel of three that
 * splits two-to-one is the most important signal in a hiring decision, and an
 * averaged score of "3.0" hides it completely.
 *
 * `submitted_at` separates a draft from a submitted verdict: an interviewer
 * halfway through writing notes has not voted, and counting them as having done
 * so makes "everybody has responded" wrong at the moment it matters.
 */
class InterviewFeedback extends Model
{
    use BelongsToOrganization;

    protected $table = 'interview_feedback';

    protected $fillable = [
        'organization_id',
        'interview_id',
        'user_id',
        'verdict',
        'rating',
        'notes',
        'submitted_at',
    ];

    protected $casts = [
        'rating' => 'integer',
        'submitted_at' => 'datetime',
    ];

    public function interview(): BelongsTo
    {
        return $this->belongsTo(Interview::class);
    }

    public function interviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function isPositive(): bool
    {
        return in_array($this->verdict, ['strong_yes', 'yes'], true);
    }
}
