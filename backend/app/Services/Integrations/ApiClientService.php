<?php

namespace App\Services\Integrations;

use App\Models\ApiClient;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Str;

/**
 * Minting and retiring customer API keys.
 */
class ApiClientService
{
    /**
     * Issue a key.
     *
     * Returns the plaintext key exactly once. Only its sha256 is stored, so
     * "send me my key again" has one honest answer: issue a new one and revoke
     * the old.
     *
     * @param  array<int, string>  $scopes
     * @return array{client: ApiClient, key: string}
     */
    public function issue(
        Organization $organization,
        string $name,
        array $scopes,
        ?\DateTimeInterface $expiresAt = null,
        ?User $actor = null,
    ): array {
        $requested = array_values(array_intersect($scopes, ApiClient::SCOPES));

        if ($requested === []) {
            throw new \InvalidArgumentException(
                'A key with no scopes can do nothing. Choose at least one.'
            );
        }

        // The prefix is shown in the UI so two keys are distinguishable; the
        // secret half is what actually authenticates.
        $prefix = 'cv_'.Str::lower(Str::random(8));
        $key = $prefix.'_'.Str::random(48);

        $client = new ApiClient([
            'organization_id' => $organization->id,
            'name' => $name,
            'key_prefix' => $prefix,
            'key_hash' => hash('sha256', $key),
            'scopes' => $requested,
            'expires_at' => $expiresAt,
            'created_by_user_id' => $actor?->id,
        ]);

        $client->organization_id = $organization->id;
        $client->save();

        return ['client' => $client, 'key' => $key];
    }

    public function revoke(ApiClient $client): ApiClient
    {
        $client->forceFill(['revoked_at' => now()])->save();

        return $client;
    }
}
