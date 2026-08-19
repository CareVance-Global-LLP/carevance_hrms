<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A customer-issued API key.
 *
 * Hashed like a password, shown once, scoped. The prefix exists so a customer
 * can tell two keys apart in a list without us keeping either of them.
 */
class ApiClient extends Model
{
    use Auditable;
    use BelongsToOrganization;

    /**
     * What a key may be allowed to do.
     *
     * Read-only by design. Nothing here writes: a first integration surface
     * that can create payroll runs is a much larger security question than one
     * that can read them, and it is far easier to add a scope later than to
     * withdraw one.
     */
    public const SCOPES = [
        'employees.read',
        'attendance.read',
        'leave.read',
        'payroll.read',
        'timesheets.read',
    ];

    protected $fillable = [
        'organization_id',
        'name',
        'key_prefix',
        'key_hash',
        'scopes',
        'expires_at',
        'last_used_at',
        'revoked_at',
        'created_by_user_id',
    ];

    protected $hidden = ['key_hash'];

    protected function casts(): array
    {
        return [
            'scopes' => 'array',
            'expires_at' => 'datetime',
            'last_used_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    public function isUsable(): bool
    {
        if ($this->revoked_at !== null) {
            return false;
        }

        return $this->expires_at === null || $this->expires_at->isFuture();
    }

    public function allows(string $scope): bool
    {
        return $this->isUsable() && in_array($scope, (array) ($this->scopes ?? []), true);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
