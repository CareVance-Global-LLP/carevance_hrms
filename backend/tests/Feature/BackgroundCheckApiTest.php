<?php

namespace Tests\Feature;

use App\Models\Candidate;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The background verification API.
 *
 * Where the gate sits matters more here than anywhere else in recruitment. A
 * completed check can contain a criminal record, an address history and
 * somebody's real salary at a previous employer — so it sits behind the payroll
 * gate rather than the manager one the rest of hiring uses. A hiring manager
 * decides whether to hire; they do not need a police verification to do it.
 */
class BackgroundCheckApiTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $hr;
    private User $manager;
    private User $employee;
    private Candidate $candidate;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'CareVance', 'slug' => 'carevance-bgv-api']);
        $this->hr = $this->makeUser('hr@carevance.test', 'hr');
        $this->manager = $this->makeUser('manager@carevance.test', 'manager');
        $this->employee = $this->makeUser('kajal@carevance.test', 'employee');

        $this->candidate = Candidate::query()->create([
            'organization_id' => $this->organization->id,
            'first_name' => 'Priya',
            'email' => 'priya@example.test',
        ]);
    }

    private function makeUser(string $email, string $role): User
    {
        return User::create([
            'name' => explode('@', $email)[0],
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $this->organization->id,
        ]);
    }

    private function consent(array $scope = ['identity', 'education']): int
    {
        return (int) $this->postJson('/api/recruitment/bgv-consents', [
            'candidate_id' => $this->candidate->id,
            'consented_name' => 'Priya Nair',
            'scope' => $scope,
            'notice_text' => 'We will verify your identity and education.',
        ])->assertCreated()->json('data.id');
    }

    public function test_hr_can_record_consent_and_open_a_check(): void
    {
        $this->actingAs($this->hr);

        $check = $this->postJson('/api/recruitment/background-checks', [
            'candidate_id' => $this->candidate->id,
            'consent_id' => $this->consent(),
            'types' => ['identity', 'education'],
            'package' => 'Standard',
        ])->assertCreated();

        $this->assertSame('in_progress', $check->json('data.status'));
        $this->assertCount(2, $check->json('data.items'));
    }

    public function test_the_recorded_ip_comes_from_the_request_not_the_payload(): void
    {
        $this->actingAs($this->hr);

        $consentId = (int) $this->postJson('/api/recruitment/bgv-consents', [
            'candidate_id' => $this->candidate->id,
            'consented_name' => 'Priya Nair',
            'scope' => ['identity'],
            // A client-supplied address is not evidence of anything.
            'ip_address' => '10.0.0.1',
        ])->assertCreated()->json('data.id');

        $consent = \App\Models\BackgroundCheckConsent::withoutOrganizationScope()->findOrFail($consentId);

        $this->assertNotSame('10.0.0.1', $consent->ip_address);
    }

    public function test_a_check_outside_the_consented_scope_is_a_422_naming_the_gap(): void
    {
        $this->actingAs($this->hr);

        $this->postJson('/api/recruitment/background-checks', [
            'candidate_id' => $this->candidate->id,
            'consent_id' => $this->consent(['identity']),
            'types' => ['identity', 'criminal'],
        ])->assertStatus(422)->assertJsonFragment([
            'message' => 'Consent does not cover: criminal. Ask again for those.',
        ]);
    }

    public function test_a_discrepancy_without_both_sides_is_refused(): void
    {
        $this->actingAs($this->hr);

        $check = $this->postJson('/api/recruitment/background-checks', [
            'candidate_id' => $this->candidate->id,
            'consent_id' => $this->consent(),
            'types' => ['education'],
        ])->assertCreated();

        $itemId = $check->json('data.items.0.id');

        // An accusation with no comparison behind it is one nobody can answer.
        $this->postJson("/api/recruitment/background-check-items/{$itemId}", [
            'status' => 'discrepancy',
            'claimed' => 'B.Tech 2019',
        ])->assertStatus(422);
    }

    public function test_the_check_surfaces_that_somebody_has_to_be_told(): void
    {
        $this->actingAs($this->hr);

        $check = $this->postJson('/api/recruitment/background-checks', [
            'candidate_id' => $this->candidate->id,
            'consent_id' => $this->consent(),
            'types' => ['education'],
        ])->assertCreated();

        $itemId = $check->json('data.items.0.id');
        $checkId = $check->json('data.id');

        $this->postJson("/api/recruitment/background-check-items/{$itemId}", [
            'status' => 'discrepancy',
            'claimed' => 'B.Tech 2019',
            'verified' => 'University records show 2018',
        ])->assertOk();

        // Forgetting to tell somebody is the failure that matters, so it is
        // surfaced rather than left for the UI to work out.
        $this->getJson("/api/recruitment/background-checks/{$checkId}")
            ->assertOk()
            ->assertJsonPath('needs_adverse_action_notice', true);
    }

    public function test_a_hiring_manager_cannot_read_background_checks(): void
    {
        $this->actingAs($this->manager);

        /*
         * The rest of recruitment is open to a manager on purpose — hiring is
         * line-management work. This is not: they decide whether to hire, and
         * do not need a criminal record to do it.
         */
        $this->getJson('/api/recruitment/background-checks')->assertForbidden();
        $this->postJson('/api/recruitment/bgv-consents', [
            'candidate_id' => $this->candidate->id,
            'consented_name' => 'Priya Nair',
            'scope' => ['criminal'],
        ])->assertForbidden();
    }

    public function test_an_employee_cannot_reach_it_either(): void
    {
        $this->actingAs($this->employee);

        $this->getJson('/api/recruitment/background-checks')->assertForbidden();
    }

    public function test_the_listing_does_not_carry_the_findings(): void
    {
        $this->actingAs($this->hr);

        $check = $this->postJson('/api/recruitment/background-checks', [
            'candidate_id' => $this->candidate->id,
            'consent_id' => $this->consent(),
            'types' => ['education'],
        ])->assertCreated();

        $this->postJson("/api/recruitment/background-check-items/{$check->json('data.items.0.id')}", [
            'status' => 'discrepancy',
            'claimed' => 'B.Tech 2019',
            'verified' => 'University records show 2018',
        ])->assertOk();

        $listed = $this->getJson('/api/recruitment/background-checks')->assertOk()->json('data.0.items.0');

        // The listing is a worklist. Findings are read one check at a time, so
        // a criminal record does not travel in a paginated response.
        $this->assertArrayHasKey('status', $listed);
        $this->assertArrayNotHasKey('verified', $listed);
        $this->assertArrayNotHasKey('notes', $listed);
    }

    public function test_another_workspaces_check_is_not_found(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'other-bgv-api']);
        $theirCandidate = Candidate::withoutOrganizationScope()->create([
            'organization_id' => $other->id,
            'first_name' => 'Someone',
            'email' => 'someone@other.test',
        ]);

        $this->actingAs($this->hr);

        $this->postJson('/api/recruitment/bgv-consents', [
            'candidate_id' => $theirCandidate->id,
            'consented_name' => 'Someone Else',
            'scope' => ['identity'],
        ])->assertNotFound();
    }
}
