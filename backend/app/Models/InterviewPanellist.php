<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Somebody invited onto an interview panel.
 *
 * Separate from their feedback because being invited and having submitted are
 * different states, and "two of three have responded" is a question a recruiter
 * asks constantly.
 */
class InterviewPanellist extends Model
{
    use BelongsToOrganization;

    protected $table = 'interview_panellists';

    protected $fillable = [
        'organization_id',
        'interview_id',
        'user_id',
        'is_lead',
    ];

    protected $casts = ['is_lead' => 'boolean'];

    public function interview(): BelongsTo
    {
        return $this->belongsTo(Interview::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
