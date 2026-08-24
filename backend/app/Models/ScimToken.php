<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A bearer token an identity provider authenticates with.
 *
 * The whole security boundary for SCIM: an IdP cannot do OAuth against us and
 * cannot hold a session, so a bearer token is what the standard specifies and
 * what Entra and Okta actually send.
 *
 * Stored ONLY as a SHA-256 hash and $hidden on top of that, so a leaked
 * database does not hand somebody the ability to create and delete users across
 * a tenant.
 */
class ScimToken extends Model
{
    use BelongsToOrganization;

    protected $table = 'scim_tokens';

    protected $fillable = [
        'organization_id',
        'name',
        'token_hash',
        'token_hint',
        'last_used_at',
        'expires_at',
        'revoked_at',
        'created_by',
    ];

    protected $casts = [
        'last_used_at' => 'datetime',
        'expires_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    /** Second line of defence: the hash never travels in a response either. */
    protected $hidden = ['token_hash'];

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isLive(): bool
    {
        return $this->revoked_at === null
            && ($this->expires_at === null || $this->expires_at->isFuture());
    }
}
