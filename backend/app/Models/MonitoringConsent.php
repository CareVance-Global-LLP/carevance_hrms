<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One employee's answer to one version of the monitoring notice.
 *
 * Consent is per capture type, not one blanket yes: somebody may accept
 * activity tracking and refuse screenshots, and a system that cannot express
 * that is not really asking.
 */
class MonitoringConsent extends Model
{
    use Auditable;
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'user_id',
        'notice_version',
        'capture_types',
        'granted_at',
        'withdrawn_at',
        'ip_address',
        'user_agent',
    ];

    protected function casts(): array
    {
        return [
            'capture_types' => 'array',
            'notice_version' => 'integer',
            'granted_at' => 'datetime',
            'withdrawn_at' => 'datetime',
        ];
    }

    public function isActive(): bool
    {
        return $this->withdrawn_at === null;
    }

    public function covers(string $captureType): bool
    {
        return $this->isActive()
            && in_array($captureType, (array) ($this->capture_types ?? []), true);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
