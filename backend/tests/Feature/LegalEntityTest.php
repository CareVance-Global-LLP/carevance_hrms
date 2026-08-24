<?php

namespace Tests\Feature;

use App\Models\LegalEntity;
use App\Models\Organization;
use App\Models\User;
use App\Services\Payroll\LegalEntityResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * A group can run more than one company; a single company notices nothing.
 *
 * One organization meant one PAN, TAN and PF code, which cannot represent the
 * two-to-four entity structure most Indian mid-market groups have. The entity
 * now holds statutory identity while the organization stays the tenant — 133
 * tables key off organization_id and none of them move.
 *
 * The whole design rests on one property, which is what most of these tests
 * pin: an organization with a single entity behaves exactly as it did.
 */
class LegalEntityTest extends TestCase
{
    use RefreshDatabase;

    private function organizationWithStatutorySettings(string $slug = 'carevance-entity'): Organization
    {
        return Organization::create([
            'name' => 'CareVance Global',
            'slug' => $slug,
            'settings' => [
                'payroll' => [
                    'statutory' => [
                        'pan' => 'AAACT1234F',
                        'tan' => 'MUMT12345E',
                        'establishmentCode' => 'MHBAN1234567000',
                    ],
                ],
            ],
        ]);
    }

    private function employee(Organization $organization, string $email, ?LegalEntity $entity = null): User
    {
        return User::create([
            'name' => 'Employee',
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
            'legal_entity_id' => $entity?->id,
        ]);
    }

    private function entity(Organization $organization, array $overrides = []): LegalEntity
    {
        return LegalEntity::query()->create(array_merge([
            'organization_id' => $organization->id,
            'name' => 'CareVance Global LLP',
            'pan' => 'AAACT1234F',
            'tan' => 'MUMT12345E',
            'pf_establishment_code' => 'MHBAN1234567000',
            'is_primary' => true,
            'is_active' => true,
        ], $overrides));
    }

    public function test_an_employee_with_no_entity_gets_the_primary_one(): void
    {
        /*
         * The property the whole migration depends on. Every existing employee
         * has a null legal_entity_id, so if this did not hold, nobody would have
         * a PAN on the day it ships.
         */
        $organization = $this->organizationWithStatutorySettings();
        $primary = $this->entity($organization);
        $user = $this->employee($organization, 'nobody@carevance.test');

        $this->assertSame($primary->id, app(LegalEntityResolver::class)->forUser($user)?->id);
    }

    public function test_an_explicit_entity_wins_over_the_primary(): void
    {
        $organization = $this->organizationWithStatutorySettings();
        $this->entity($organization);
        $second = $this->entity($organization, [
            'name' => 'CareVance Services Pvt Ltd',
            'pan' => 'AAACS9876Q',
            'tan' => 'DELS54321B',
            'is_primary' => false,
        ]);

        $user = $this->employee($organization, 'assigned@carevance.test', $second);

        $resolved = app(LegalEntityResolver::class)->forUser($user);

        $this->assertSame($second->id, $resolved?->id);
        $this->assertSame('AAACS9876Q', $resolved?->pan);
    }

    public function test_an_entity_from_another_tenant_is_refused(): void
    {
        /*
         * Should be impossible through the UI. A resolver that trusts the
         * foreign key anyway would file one organization's payroll under
         * another's PAN, which is not a mistake anybody can unwind afterwards.
         */
        $organization = $this->organizationWithStatutorySettings();
        $ours = $this->entity($organization);

        $other = Organization::create(['name' => 'Other Group', 'slug' => 'other-entity']);
        $theirs = $this->entity($other, ['name' => 'Other Ltd', 'pan' => 'ZZZZZ9999Z']);

        $user = $this->employee($organization, 'crossed@carevance.test');
        $user->forceFill(['legal_entity_id' => $theirs->id])->save();

        $resolved = app(LegalEntityResolver::class)->forUser($user->fresh());

        $this->assertSame($ours->id, $resolved?->id, 'a foreign entity was accepted');
        $this->assertNotSame('ZZZZZ9999Z', $resolved?->pan);
    }

    public function test_employees_group_by_the_company_that_employs_them(): void
    {
        // What makes a filing run correct for a group: one ECR per PF code,
        // rather than one file mixing two companies under whichever PAN was
        // read first.
        $organization = $this->organizationWithStatutorySettings();
        $first = $this->entity($organization);
        $second = $this->entity($organization, [
            'name' => 'CareVance Services Pvt Ltd',
            'pf_establishment_code' => 'DLCPM7654321000',
            'is_primary' => false,
        ]);

        $users = collect([
            $this->employee($organization, 'a@carevance.test'),
            $this->employee($organization, 'b@carevance.test', $second),
            $this->employee($organization, 'c@carevance.test', $second),
        ]);

        $groups = app(LegalEntityResolver::class)->groupUsers($users);

        $this->assertCount(2, $groups);

        $byEntity = $groups->keyBy(fn (array $group) => $group['entity']?->id);
        $this->assertCount(1, $byEntity[$first->id]['users']);
        $this->assertCount(2, $byEntity[$second->id]['users']);
    }

    public function test_only_one_entity_can_be_primary(): void
    {
        // "No primary" means "nobody has a PAN"; two primaries means the answer
        // depends on row order. Enforced by a partial unique index on pgsql.
        if (\DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('Partial unique indexes are a pgsql feature; sqlite stores no constraint.');
        }

        $organization = $this->organizationWithStatutorySettings();
        $this->entity($organization);

        $this->expectException(\Illuminate\Database\QueryException::class);
        $this->entity($organization, ['name' => 'Second Primary', 'is_primary' => true]);
    }

    public function test_statutory_readiness_is_asked_per_identifier(): void
    {
        /*
         * ESI and PF are separate registrations and an entity can hold one
         * without the other, so a single "is it ready" flag would either block
         * a filing it should allow or allow one it should block.
         */
        $organization = $this->organizationWithStatutorySettings();
        $entity = $this->entity($organization, ['esi_code' => null]);

        $this->assertTrue($entity->hasStatutoryIdentity('pan', 'tan'));
        $this->assertTrue($entity->hasStatutoryIdentity('pf_establishment_code'));
        $this->assertFalse($entity->hasStatutoryIdentity('esi_code'));
    }

    public function test_an_organization_with_no_entity_still_resolves_to_nothing_rather_than_erroring(): void
    {
        // Mid-migration state. Filing then falls back to organization settings,
        // which is exactly what it did before entities existed.
        $organization = $this->organizationWithStatutorySettings('carevance-no-entity');
        $user = $this->employee($organization, 'orphan@carevance.test');

        $this->assertNull(app(LegalEntityResolver::class)->forUser($user));
    }
}
