<?php

namespace App\Services\Payroll;

use App\Models\LegalEntity;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Collection;

/**
 * Which company employs this person, for statutory purposes.
 *
 * The rule, in one place because getting it inconsistent means two filings
 * disagree about who employs somebody:
 *
 *   1. The entity explicitly set on the user.
 *   2. Otherwise the organization's primary entity.
 *
 * Step 2 is what makes this migration safe. Every existing employee has a null
 * `legal_entity_id`, so every one of them resolves to the single entity the
 * migration seeded from the organization's own settings — same PAN, same TAN,
 * same filings as before. Assigning somebody to a second entity is then a
 * deliberate act rather than something that happened to them.
 *
 * Results are memoised per request. Filing generators ask this once per
 * employee across thousands of payroll items, and the answer cannot change
 * mid-run.
 */
class LegalEntityResolver
{
    /** @var array<int, LegalEntity|null> */
    private array $byUser = [];

    /** @var array<int, LegalEntity|null> */
    private array $primaryByOrganization = [];

    public function forUser(?User $user): ?LegalEntity
    {
        if (! $user) {
            return null;
        }

        if (array_key_exists($user->id, $this->byUser)) {
            return $this->byUser[$user->id];
        }

        $entity = null;

        if ($user->legal_entity_id) {
            $entity = LegalEntity::query()->find($user->legal_entity_id);

            /*
             * An entity from another tenant is not an answer. This should be
             * impossible through the UI, but a resolver that trusts a foreign
             * key would file one organization's payroll under another's PAN,
             * and that is not a mistake anybody can unwind afterwards.
             */
            if ($entity && (int) $entity->organization_id !== (int) $user->organization_id) {
                $entity = null;
            }
        }

        $entity ??= $this->primaryFor($user->organization_id);

        return $this->byUser[$user->id] = $entity;
    }

    public function primaryFor(int|string|null $organizationId): ?LegalEntity
    {
        $key = (int) $organizationId;
        if ($key <= 0) {
            return null;
        }

        if (array_key_exists($key, $this->primaryByOrganization)) {
            return $this->primaryByOrganization[$key];
        }

        $entity = LegalEntity::query()
            ->where('organization_id', $key)
            ->where('is_active', true)
            ->orderByDesc('is_primary')
            ->orderBy('id')
            ->first();

        return $this->primaryByOrganization[$key] = $entity;
    }

    /**
     * Split a set of employees by the entity that employs them.
     *
     * This is what makes a filing run correct for a group: one ECR per PF code
     * and one 24Q per TAN, rather than one file mixing two companies' employees
     * under whichever PAN happened to be read first.
     *
     * @param  Collection<int, User>  $users
     * @return Collection<int, array{entity: LegalEntity|null, users: Collection<int, User>}>
     */
    public function groupUsers(Collection $users): Collection
    {
        return $users
            ->groupBy(fn (User $user) => $this->forUser($user)?->id ?? 0)
            ->map(fn (Collection $group, $entityId) => [
                'entity' => $entityId ? $this->forUser($group->first()) : null,
                'users' => $group->values(),
            ])
            ->values();
    }

    public function entitiesFor(?Organization $organization): Collection
    {
        if (! $organization) {
            return collect();
        }

        return LegalEntity::query()
            ->where('organization_id', $organization->id)
            ->where('is_active', true)
            ->orderByDesc('is_primary')
            ->orderBy('name')
            ->get();
    }
}
