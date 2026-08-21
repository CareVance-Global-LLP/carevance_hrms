<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One customer's identity provider.
 *
 * Scoped to a legal entity where a group runs several - an acquisition often
 * keeps its own Entra tenant for years - and to the whole organization when
 * legal_entity_id is null, which is what a single-entity customer gets.
 */
class SamlConnection extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'legal_entity_id',
        'name',
        'idp_entity_id',
        'idp_sso_url',
        'idp_slo_url',
        'idp_x509_cert',
        'email_attribute',
        'name_attribute',
        'provision_users',
        'default_role',
        'is_active',
        'last_login_at',
    ];

    protected $casts = [
        'provision_users' => 'boolean',
        'is_active' => 'boolean',
        'last_login_at' => 'datetime',
    ];

    /**
     * The certificate is a credential, not configuration.
     *
     * Hidden from every serialisation so it cannot reach an API response by
     * somebody adding a field to a resource later. It is public-key material
     * rather than a secret, but exposing which key we trust hands an attacker
     * the one thing worth attacking.
     */
    protected $hidden = ['idp_x509_cert'];

    public function legalEntity(): BelongsTo
    {
        return $this->belongsTo(LegalEntity::class);
    }

    /**
     * Whether this connection can actually be used.
     *
     * Every field here is required to complete a login, so a connection missing
     * one is not "partially configured" - it is a login that will fail at the
     * worst moment, in front of somebody who cannot get in.
     */
    public function isUsable(): bool
    {
        return $this->is_active
            && filled($this->idp_entity_id)
            && filled($this->idp_sso_url)
            && filled($this->idp_x509_cert);
    }
}
