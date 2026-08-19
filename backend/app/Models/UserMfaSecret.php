<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A user's TOTP secret.
 *
 * No BelongsToOrganization: the table has no organization_id, because MFA is a
 * property of the account rather than the tenant. TenantIsolationTest only
 * requires the trait on models owning a table that has the column.
 */
class UserMfaSecret extends Model
{
    protected $fillable = [
        'user_id',
        'secret',
        'confirmed_at',
        'last_used_at',
        'last_used_timestamp',
    ];

    protected function casts(): array
    {
        return [
            // A TOTP secret is a credential, not a preference. Anyone holding
            // it can mint valid codes indefinitely, so it never sits in the
            // clear — the same reasoning that applies to bank and PAN columns.
            'secret' => 'encrypted',
            'confirmed_at' => 'datetime',
            'last_used_at' => 'datetime',
            'last_used_timestamp' => 'integer',
        ];
    }

    public function isConfirmed(): bool
    {
        return $this->confirmed_at !== null;
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
