<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Where a customer wants to be told things.
 */
class WebhookEndpoint extends Model
{
    use Auditable;
    use BelongsToOrganization;

    /**
     * The events worth telling anyone about.
     *
     * Deliberately short. Every event here is one a customer's own system
     * plausibly needs to react to; a firehose of everything is a support
     * burden and a data-leak surface, not a feature.
     */
    public const EVENTS = [
        'employee.created',
        'employee.updated',
        'employee.exited',
        'payroll.run.approved',
        'payroll.run.disbursed',
        'leave.approved',
        'attendance.regularised',
        'invoice.paid',
    ];

    /** Consecutive failures before an endpoint is switched off. */
    public const FAILURE_LIMIT = 10;

    protected $fillable = [
        'organization_id',
        'name',
        'url',
        'secret',
        'events',
        'is_active',
        'consecutive_failures',
        'disabled_at',
        'disabled_reason',
    ];

    protected $hidden = ['secret'];

    protected function casts(): array
    {
        return [
            // A credential: anyone holding it can forge our signatures.
            'secret' => 'encrypted',
            'events' => 'array',
            'is_active' => 'boolean',
            'consecutive_failures' => 'integer',
            'disabled_at' => 'datetime',
        ];
    }

    public function isListeningFor(string $event): bool
    {
        return $this->is_active
            && $this->disabled_at === null
            && in_array($event, (array) ($this->events ?? []), true);
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(WebhookDelivery::class);
    }
}
