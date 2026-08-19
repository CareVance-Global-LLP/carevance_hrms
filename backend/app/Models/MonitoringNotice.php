<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What an organisation tells its people it collects, and why.
 *
 * Versioned rather than editable in place: consent is recorded against a
 * version, so changing the words cannot silently inherit agreement given to
 * different ones.
 */
class MonitoringNotice extends Model
{
    use Auditable;
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'version',
        'body',
        'purposes',
        'retention_days',
        'published_at',
        'published_by_user_id',
    ];

    protected function casts(): array
    {
        return [
            'purposes' => 'array',
            'retention_days' => 'integer',
            'version' => 'integer',
            'published_at' => 'datetime',
        ];
    }

    public function isPublished(): bool
    {
        return $this->published_at !== null;
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
