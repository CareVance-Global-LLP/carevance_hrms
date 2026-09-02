<?php

namespace Tests\Feature\Payroll;

use App\Models\EmployeeGovernmentId;
use App\Models\EmployeePayrollTemplate;
use App\Models\EmployeeProfile;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A PAN THAT WAS ENTERED HAS TO COUNT AS ENTERED.
 *
 * Statutory identifiers live in TWO places — the profile column and
 * `employee_government_ids` — and `User::statutoryId()` exists precisely to
 * resolve across both. The payroll readiness counter did not use it:
 *
 *     EmployeeProfile::whereIn('user_id', $ids)
 *         ->where(fn ($q) => $q->whereNull('pan_number')->orWhere('pan_number', '')
 *                              ->orWhereNull('uan_number')->orWhere('uan_number', ''))
 *
 * so a PAN captured through the Government IDs section — which is where the
 * product actually collects it, alongside the scan — was invisible. An admin
 * entered six PANs, watched the count stay at six, and reasonably concluded the
 * save had not worked.
 *
 * The two are also SPLIT here. "Missing PAN or UAN" collapses two different
 * jobs into one number, so filling in every PAN moved nothing on screen and the
 * card looked broken. A PAN is collected from the employee; a UAN is issued by
 * EPFO. Whoever reads this has to be able to tell which one is outstanding.
 */
class StatutoryIdCountsWhereverItLivesTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
    }

    public function test_a_pan_held_only_in_government_ids_counts_as_present(): void
    {
        $user = $this->onPayroll();

        EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'id_type' => 'pan',
            'id_number' => 'ABCDE1234F',
        ]);

        $body = $this->readiness();

        $this->assertSame(
            0,
            $body['attention']['missing_pan'],
            'a PAN entered through Government IDs is still a PAN'
        );
    }

    public function test_a_pan_held_only_on_the_profile_still_counts(): void
    {
        $user = $this->onPayroll();

        EmployeeProfile::updateOrCreate(
            ['user_id' => $user->id],
            ['organization_id' => $this->organization->id, 'pan_number' => 'ABCDE1234F']
        );

        $this->assertSame(0, $this->readiness()['attention']['missing_pan']);
    }

    public function test_somebody_with_no_pan_anywhere_is_counted(): void
    {
        $this->onPayroll();

        $this->assertSame(1, $this->readiness()['attention']['missing_pan']);
    }

    public function test_pan_and_uan_are_reported_as_separate_facts(): void
    {
        $user = $this->onPayroll();

        EmployeeGovernmentId::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'id_type' => 'pan',
            'id_number' => 'ABCDE1234F',
        ]);

        $body = $this->readiness();

        // The PAN is in, the UAN is not. Collapsed into one "PAN or UAN" count
        // this reads as no progress at all, which is what made an admin think
        // six saves had silently failed.
        $this->assertSame(0, $body['attention']['missing_pan']);
        $this->assertSame(1, $body['attention']['missing_uan']);
    }

    public function test_the_combined_count_is_still_published(): void
    {
        $this->onPayroll();

        // Kept so an older client does not lose the tile entirely.
        $body = $this->readiness();
        $this->assertArrayHasKey('missing_pan_uan', $body['attention']);
        $this->assertSame(1, $body['attention']['missing_pan_uan']);
    }

    private function readiness(): array
    {
        return $this->actingAs($this->admin)
            ->getJson('/api/payroll/dashboard-attention')
            ->assertOk()
            ->json();
    }

    private function onPayroll(): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'annual_ctc' => 600000,
            'is_active' => true,
        ]);

        return $user;
    }
}
