<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Billing\CompanyProfileService;
use App\Services\Billing\PlanService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The claims the signup screen makes, and what has to be true at conversion.
 *
 * The trial choice is presented as "Tracker" and "Tracker + Payroll" — additive,
 * not exclusive. That wording is only honest while basic_payroll contains
 * everything basic_tracking does, so the relationship is pinned here rather than
 * left to whoever next edits a feature list.
 */
class TrialPlanAndConversionTest extends TestCase
{
    use RefreshDatabase;

    public function test_payroll_trial_plan_is_a_superset_of_the_tracking_plan(): void
    {
        $tracking = PlanService::FEATURES['basic_tracking'];
        $payroll = PlanService::FEATURES['basic_payroll'];

        $missing = array_values(array_diff($tracking, $payroll));

        $this->assertSame(
            [],
            $missing,
            'basic_payroll must grant everything basic_tracking does, or the '
            . '"Tracker + Payroll" label on the signup form is false. Missing: '
            . implode(', ', $missing)
        );
    }

    public function test_trial_plan_resolution_falls_back_to_the_superset(): void
    {
        $this->assertSame('basic_tracking', PlanService::resolveTrialPlan('basic_tracking'));
        $this->assertSame('basic_payroll', PlanService::resolveTrialPlan('basic_payroll'));

        // Anything unrecognised — including a paid plan code someone tried to
        // smuggle in through the trial field — lands on the trial default.
        $this->assertSame('basic_payroll', PlanService::resolveTrialPlan(null));
        $this->assertSame('basic_payroll', PlanService::resolveTrialPlan(''));
        $this->assertSame('basic_payroll', PlanService::resolveTrialPlan('professional_payroll'));
    }

    public function test_company_size_seeds_the_seat_suggestion(): void
    {
        $service = new CompanyProfileService();

        $this->assertSame(25, $service->seatsFromSize('11-50'));
        $this->assertNull($service->seatsFromSize(null));
        $this->assertNull($service->seatsFromSize('  '));

        $organization = Organization::factory()->create(['size' => '51-200']);

        // Above the floor, so the headcount wins.
        $this->assertSame(75, $service->suggestedSeats($organization, 10, 1));
        // Never below the people already in the workspace, whatever the bucket says.
        $this->assertSame(120, $service->suggestedSeats($organization, 10, 120));
    }

    public function test_seat_suggestion_falls_back_to_the_floor_without_a_recorded_size(): void
    {
        $service = new CompanyProfileService();
        $organization = Organization::factory()->create(['size' => null]);

        $this->assertSame(10, $service->suggestedSeats($organization, 10, 1));
    }

    public function test_billing_profile_reports_exactly_which_address_fields_are_missing(): void
    {
        $service = new CompanyProfileService();

        $organization = Organization::factory()->create([
            'address_line' => '4th Floor, MG Road',
            'city' => 'Bengaluru',
            'state' => null,
            'postal_code' => '   ',
            'country' => 'India',
        ]);

        $this->assertFalse($service->hasBillingProfile($organization));
        $this->assertSame(['state', 'postal_code'], $service->missingBillingFields($organization));
        $this->assertSame(['State', 'Postal code'], $service->missingBillingLabels($organization));
    }

    /**
     * A converting trial that sends no explicit seat count must not land on the
     * 5-seat trial cap. That is how a company of forty would silently buy five.
     */
    public function test_converting_trial_defaults_seats_from_recorded_headcount(): void
    {
        $organization = Organization::factory()->create([
            'plan_code' => 'basic_payroll',
            'subscription_status' => 'trial',
            'subscription_intent' => 'trial',
            'max_seats' => 5,
            'size' => '51-200',
            'billing_cycle' => 'monthly',
        ]);

        $owner = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'admin',
        ]);

        $this->actingAs($owner)
            ->postJson('/api/billing/upgrade', [
                'target_plan_code' => 'professional_payroll',
                'billing_cycle' => 'monthly',
            ])
            ->assertOk();

        // 75 is the bottom of the 51-200 band, not the 5 the trial was capped at.
        $this->assertSame(75, (int) $organization->fresh()->pending_seats);
    }

    public function test_payment_order_is_refused_until_there_is_a_billing_address(): void
    {
        $organization = Organization::factory()->create([
            'plan_code' => 'basic_payroll',
            'subscription_status' => 'trial',
            'address_line' => null,
            'city' => null,
            'state' => null,
            'postal_code' => null,
            'country' => null,
        ]);

        $owner = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'admin',
        ]);

        $this->actingAs($owner)
            ->postJson('/api/billing/razorpay/create-order', ['amount' => 4999])
            ->assertUnprocessable()
            ->assertJsonPath('error_code', 'BILLING_PROFILE_INCOMPLETE')
            ->assertJsonPath('missing_fields', ['address_line', 'city', 'state', 'postal_code', 'country']);
    }
}
