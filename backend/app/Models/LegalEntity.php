<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The company that actually employs somebody, and files their returns.
 *
 * Sits under the organization rather than beside it. The organization stays the
 * tenant boundary — 133 tables key off it — and the entity answers a narrower
 * question: whose PAN, TAN and PF code does this person's payroll file under.
 * Most Indian mid-market groups run two to four of these.
 */
class LegalEntity extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'name',
        'legal_name',
        'pan',
        'tan',
        'pf_establishment_code',
        'esi_code',
        'lwf_code',
        'cin',
        'gstin',
        'address_line',
        'city',
        'state',
        'pincode',
        'is_primary',
        'is_active',
    ];

    protected $casts = [
        'is_primary' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    /**
     * Whether this entity can actually file.
     *
     * A filing that reports success while emitting PANINVALID is worse than one
     * that refuses: somebody believes a return went in. Each generator asks for
     * the identifiers it needs rather than assuming a single readiness flag,
     * because ESI coverage and PF coverage are separate registrations and an
     * entity can hold one without the other.
     */
    public function hasStatutoryIdentity(string ...$required): bool
    {
        foreach ($required as $field) {
            if (blank($this->{$field})) {
                return false;
            }
        }

        return true;
    }
}
