<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One attempt to tell a customer something, and how it went.
 *
 * Kept whatever the outcome. A dead-letter queue nobody can see is the same as
 * dropping the message, and "we sent it" is not a claim anyone should have to
 * take on trust.
 */
class WebhookDelivery extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'webhook_endpoint_id',
        'event',
        'payload',
        'status',
        'attempts',
        'response_status',
        'error',
        'delivered_at',
        'next_attempt_at',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'attempts' => 'integer',
            'response_status' => 'integer',
            'delivered_at' => 'datetime',
            'next_attempt_at' => 'datetime',
        ];
    }

    public function endpoint(): BelongsTo
    {
        return $this->belongsTo(WebhookEndpoint::class, 'webhook_endpoint_id');
    }
}
