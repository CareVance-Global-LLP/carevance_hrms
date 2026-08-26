<?php

namespace App\Services\Auth;

use App\Events\SessionRevoked;
use App\Models\Organization;
use App\Models\ScimToken;
use App\Models\User;
use App\Services\Billing\SeatGuard;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Provisioning, and — the half that matters — deprovisioning.
 *
 * SAML let somebody sign in through their IdP. Until now nothing removed them
 * when the IdP said to: SAML refused their next login, but an existing API
 * token carried on working, so somebody who left on Friday could still read
 * payroll on Monday. Deactivation here REVOKES TOKENS as well as flipping a
 * flag, because a flag alone is exactly the half-measure that gap described.
 *
 * PEOPLE ARE MATCHED BY externalId, NEVER BY EMAIL. An IdP identifies somebody
 * by its own immutable id; people change their surname and their email address.
 * Matching on email means a rename silently creates a second account and
 * deprovisions neither.
 *
 * DEACTIVATE, NEVER DELETE. SCIM's DELETE verb means "this person is no longer
 * in the directory", not "erase their employment history". Their payslips,
 * attendance and leave ledger are records the organization is obliged to keep,
 * and an IdP administrator ticking a box in Entra must not be able to destroy
 * them.
 */
class ScimProvisioningService
{
    public function __construct(
        private readonly SeatGuard $seats,
    ) {
    }

    /**
     * Issue a token for an IdP.
     *
     * Returns the PLAIN token, which is the only time it exists in readable
     * form. Nobody, including an administrator, can recover it afterwards —
     * losing one means issuing another.
     *
     * @return array{token: ScimToken, plain: string}
     */
    public function issueToken(Organization $organization, string $name, ?User $actor = null): array
    {
        $plain = 'scim_'.bin2hex(random_bytes(32));

        $token = ScimToken::query()->create([
            'organization_id' => $organization->id,
            'name' => trim($name) ?: 'SCIM token',
            'token_hash' => hash('sha256', $plain),
            // Last six characters only — enough to tell two apart in a list,
            // useless to anybody who has only this.
            'token_hint' => substr($plain, -6),
            'created_by' => $actor?->id,
        ]);

        return ['token' => $token, 'plain' => $plain];
    }

    /**
     * Which organization a bearer token belongs to.
     *
     * Returns null for every failure — unknown, revoked, expired — without
     * distinguishing them. An unauthenticated caller learning that a token
     * exists but has expired is learning something they should not.
     */
    public function organizationForToken(?string $bearer): ?Organization
    {
        if (! is_string($bearer) || $bearer === '') {
            return null;
        }

        $token = ScimToken::withoutOrganizationScope()
            ->whereNull('revoked_at')
            ->where('token_hash', hash('sha256', $bearer))
            ->first();

        if (! $token) {
            return null;
        }

        if (! hash_equals((string) $token->token_hash, hash('sha256', $bearer))) {
            return null;
        }

        if ($token->expires_at && $token->expires_at->isPast()) {
            return null;
        }

        // Recorded so an admin can see whether an integration is actually live;
        // a token that has never been used is usually one somebody pasted
        // wrongly.
        $token->forceFill(['last_used_at' => now()])->save();

        return Organization::query()->find($token->organization_id);
    }

    /**
     * Create or update somebody from a SCIM payload.
     *
     * Matched on externalId first, then on email as a fallback for an IdP that
     * omits it — but the email match ADOPTS the account rather than creating a
     * second one, and stamps the externalId so every later sync uses the
     * reliable key.
     *
     * @param  array<string, mixed>  $payload
     */
    public function upsertUser(Organization $organization, array $payload): User
    {
        $externalId = $this->stringOrNull($payload['externalId'] ?? null);
        $email = strtolower(trim((string) ($payload['userName'] ?? $this->primaryEmail($payload) ?? '')));

        if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw new RuntimeException('A user needs a valid userName or email.');
        }

        return DB::transaction(function () use ($organization, $payload, $externalId, $email) {
            $user = null;

            if ($externalId) {
                $user = User::query()
                    ->where('organization_id', $organization->id)
                    ->where('scim_external_id', $externalId)
                    ->first();
            }

            $user ??= User::query()
                ->where('organization_id', $organization->id)
                ->whereRaw('LOWER(email) = ?', [$email])
                ->first();

            $name = $this->displayName($payload) ?: ($user?->name ?: $email);
            $active = array_key_exists('active', $payload) ? (bool) $payload['active'] : true;

            if (! $user) {
                // An IdP must not be the way round the seat cap. Now that a
                // deactivated leaver releases their seat, a provisioning run
                // claims one exactly as hiring does.
                $this->seats->assertCanAdd($organization, 1);

                $user = new User([
                    'name' => $name,
                    'email' => $email,
                    // Required by the column and never usable: this account
                    // authenticates through the IdP and nowhere else.
                    'password' => bcrypt(bin2hex(random_bytes(32))),
                    'role' => 'employee',
                    'organization_id' => $organization->id,
                    'email_verified_at' => now(),
                ]);
            }

            $user->forceFill([
                'name' => $name,
                'email' => $email,
                'scim_external_id' => $externalId ?: $user->scim_external_id,
                'is_scim_managed' => true,
                'scim_synced_at' => now(),
            ]);

            /*
             * `active: false` in a payload is a deprovision, and goes through
             * the same path a DELETE does. An IdP that patches somebody
             * inactive expects exactly what one that deletes them expects.
             */
            if (! $active) {
                $user->save();
                $this->deactivate($user);

                return $user->fresh();
            }

            // Reactivation is the ordinary case of somebody rejoining, and
            // must clear the deactivation rather than leaving a live account
            // that cannot log in.
            $user->save();
            $this->reactivate($user);

            return $user->fresh();
        });
    }

    /**
     * Give somebody their access back.
     *
     * CLAIMS A SEAT, because releasing one on deactivation is what makes that
     * true — without the check here an IdP administrator flipping `active` back
     * on is the documented way past a cap that hiring, invitations and rejoin
     * all respect. Already-active accounts are left alone rather than
     * re-asserted, or an ordinary sync of a full workspace would start failing.
     *
     * Deliberately NOT `ExitService::rejoin()`: an IdP has no exit record, no
     * joining date and no opinion about gratuity. This reactivates and nothing
     * more, so a SCIM-rehired person's continuous-service clock is not restarted.
     */
    public function reactivate(User $user): User
    {
        if ($user->deactivated_at === null) {
            $user->forceFill(['scim_synced_at' => now()])->save();

            return $user;
        }

        $organization = $user->organization;

        if ($organization) {
            $this->seats->assertCanAdd($organization, 1);
        }

        $user->forceFill(['deactivated_at' => null, 'scim_synced_at' => now()])->save();

        return $user;
    }

    /**
     * Take somebody's access away.
     *
     * TOKENS ARE REVOKED, not merely flagged. A flag alone leaves anybody
     * holding a personal access token able to keep reading payroll after they
     * have left, which is the precise failure SCIM is bought to prevent.
     */
    public function deactivate(User $user): User
    {
        DB::transaction(function () use ($user) {
            $user->forceFill([
                'deactivated_at' => $user->deactivated_at ?: now(),
                'scim_synced_at' => now(),
            ])->save();

            DB::table('personal_access_tokens')
                ->where('tokenable_type', User::class)
                ->where('tokenable_id', $user->id)
                ->delete();
        });

        // Revoking the token stops the next REQUEST. It does not stop a socket
        // that is already open — channel authorization happens once, at
        // subscribe time, so a leaver with a tab still open would keep
        // receiving notifications in real time long after their access ended.
        // That is the same failure this method's tokens-not-flags rule exists
        // to prevent, so the teardown belongs here rather than in a follow-up.
        //
        // Dispatched AFTER the transaction commits: signalling from inside it
        // would sign somebody out on a write that then rolled back.
        SessionRevoked::dispatch((int) $user->id, SessionRevoked::REASON_DEACTIVATED);

        return $user->fresh();
    }

    /**
     * A SCIM representation of a user.
     *
     * Deliberately thin. SCIM consumers ask for what they sent plus an id, and
     * an IdP has no business reading somebody's salary, attendance or leave
     * balance out of an HR system it only provisions into.
     *
     * @return array<string, mixed>
     */
    public function toScimUser(User $user): array
    {
        return [
            'schemas' => ['urn:ietf:params:scim:schemas:core:2.0:User'],
            'id' => (string) $user->id,
            'externalId' => $user->scim_external_id,
            'userName' => $user->email,
            'name' => ['formatted' => $user->name],
            'emails' => [[
                'value' => $user->email,
                'primary' => true,
            ]],
            // Absence of a deactivation IS the active state; a separate flag
            // could disagree with it.
            'active' => $user->deactivated_at === null,
            'meta' => [
                'resourceType' => 'User',
                'created' => $user->created_at?->toIso8601String(),
                'lastModified' => ($user->scim_synced_at ?: $user->updated_at)?->toIso8601String(),
            ],
        ];
    }

    /** @param array<string, mixed> $payload */
    private function displayName(array $payload): ?string
    {
        $formatted = $this->stringOrNull($payload['name']['formatted'] ?? null);

        if ($formatted) {
            return $formatted;
        }

        $given = $this->stringOrNull($payload['name']['givenName'] ?? null);
        $family = $this->stringOrNull($payload['name']['familyName'] ?? null);
        $joined = trim(($given ?? '').' '.($family ?? ''));

        return $joined !== '' ? $joined : $this->stringOrNull($payload['displayName'] ?? null);
    }

    /** @param array<string, mixed> $payload */
    private function primaryEmail(array $payload): ?string
    {
        $emails = $payload['emails'] ?? [];

        if (! is_array($emails)) {
            return null;
        }

        foreach ($emails as $entry) {
            if (is_array($entry) && ! empty($entry['primary']) && ! empty($entry['value'])) {
                return (string) $entry['value'];
            }
        }

        return isset($emails[0]['value']) ? (string) $emails[0]['value'] : null;
    }

    private function stringOrNull(mixed $value): ?string
    {
        return is_string($value) && trim($value) !== '' ? trim($value) : null;
    }
}
