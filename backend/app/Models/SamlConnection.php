<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Carbon\Carbon;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use OneLogin\Saml2\Utils as SamlUtils;

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

    /**
     * What the stored certificate is, and when it stops working.
     *
     * Signing certificates expire, usually on a three-year cycle nobody diarises,
     * and the failure is total and simultaneous: every single sign-on login in
     * the organization breaks at the same moment, including the administrator's,
     * so the person who could fix it is locked out too. Surfacing the expiry is
     * the difference between a scheduled ten-minute paste and an outage.
     *
     * Returns null when the certificate cannot be parsed at all, which is itself
     * worth showing - a connection holding an unreadable certificate is one that
     * will fail at first use.
     *
     * @return array{subject: string, expires_at: string, days_remaining: int, fingerprint: string}|null
     */
    public function certificateSummary(): ?array
    {
        if (! filled($this->idp_x509_cert)) {
            return null;
        }

        $pem = SamlUtils::formatCert($this->idp_x509_cert, true);

        $parsed = @openssl_x509_parse($pem);
        if (! is_array($parsed) || ! isset($parsed['validTo_time_t'])) {
            return null;
        }

        $expiresAt = Carbon::createFromTimestamp((int) $parsed['validTo_time_t']);

        return [
            'subject' => (string) ($parsed['subject']['CN'] ?? $parsed['name'] ?? 'Unknown'),
            'expires_at' => $expiresAt->toIso8601String(),
            // Signed on purpose: an already-expired certificate reads as a
            // negative rather than as zero, so "expired 40 days ago" is sayable.
            'days_remaining' => (int) now()->startOfDay()->diffInDays($expiresAt->startOfDay(), false),
            // Enough to tell two certificates apart when rotating, without
            // exposing the certificate itself.
            'fingerprint' => strtoupper(substr(hash('sha256', $pem), 0, 16)),
        ];
    }
}
