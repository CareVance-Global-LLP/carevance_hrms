<?php

namespace Tests\Feature;

use App\Mail\VerifyEmailMail;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class OwnerSignupApiTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_signup_creates_workspace_admin_trial_and_billing_snapshot(): void
    {
        Mail::fake();

        $response = $this->postJson('/api/auth/signup-owner', [
            'company_name' => 'CareVance Labs',
            'name' => 'Workspace Owner',
            'email' => 'owner@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            // In trial mode `plan_code` is ignored — `trial_plan` is the field
            // that governs, and it must be sent for a specific plan. Leaving it
            // out lands on the default, which the next test covers.
            'trial_plan' => 'basic_tracking',
            'signup_mode' => 'trial',
            'billing_cycle' => 'monthly',
            'terms_accepted' => true,
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('user.role', 'admin')
            ->assertJsonPath('organization.name', 'CareVance Labs')
            ->assertJsonPath('organization.plan_code', 'basic_tracking')
            ->assertJsonPath('organization.subscription_status', 'trial')
            ->assertJsonPath('requires_verification', true)
            ->assertJsonMissingPath('token')
            ->assertJsonPath('verification_email_sent', true);

        $organization = Organization::query()->firstOrFail();
        $owner = User::query()->firstOrFail();

        $this->assertSame($owner->id, $organization->owner_user_id);
        $this->assertSame('trial', $organization->subscription_intent);
        $this->assertNotNull($organization->trial_starts_at);
        $this->assertNotNull($organization->trial_ends_at);
        $this->assertNull($owner->email_verified_at);
        Mail::assertQueued(VerifyEmailMail::class);

        $this->assertDatabaseCount('personal_access_tokens', 0);
    }

    public function test_owner_signup_supports_paid_intent_without_public_role_selection(): void
    {
        $paidIntentResponse = $this->postJson('/api/auth/register', [
            'organization_name' => 'CareVance Growth',
            'name' => 'Paid Intent Owner',
            'email' => 'paid@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'plan_code' => 'advance_tracking',
            'signup_mode' => 'paid',
            'terms_accepted' => true,
            'role' => 'admin',
        ]);

        $paidIntentResponse
            ->assertCreated()
            ->assertJsonPath('organization.subscription_status', 'inactive')
            ->assertJsonPath('organization.subscription_intent', 'paid')
            ->assertJsonPath('requires_verification', true)
            ->assertJsonMissingPath('token');

        $employeeAttempt = $this->postJson('/api/auth/register', [
            'organization_name' => 'CareVance Growth',
            'name' => 'Employee Attempt',
            'email' => 'employee-attempt@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => 'employee',
        ]);

        $employeeAttempt
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role']);
    }

    public function test_owner_signup_is_rate_limited(): void
    {
        foreach (range(1, 3) as $attempt) {
            $this->postJson('/api/auth/signup-owner', [
                'company_name' => 'CareVance Labs '.$attempt,
                'name' => 'Workspace Owner '.$attempt,
                'email' => "owner{$attempt}@example.com",
                'password' => 'password123',
                'password_confirmation' => 'password123',
                'plan_code' => 'basic_tracking',
                'signup_mode' => 'trial',
                'billing_cycle' => 'monthly',
                'terms_accepted' => true,
            ])->assertCreated();
        }

        $this->postJson('/api/auth/signup-owner', [
            'company_name' => 'CareVance Labs 4',
            'name' => 'Workspace Owner 4',
            'email' => 'owner4@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'plan_code' => 'basic_tracking',
            'signup_mode' => 'trial',
            'billing_cycle' => 'monthly',
            'terms_accepted' => true,
        ])->assertStatus(429);
    }

    public function test_owner_signup_requires_terms_acceptance(): void
    {
        $response = $this->postJson('/api/auth/signup-owner', [
            'company_name' => 'CareVance Labs',
            'name' => 'Workspace Owner',
            'email' => 'owner@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'plan_code' => 'basic_tracking',
            'signup_mode' => 'trial',
            'billing_cycle' => 'monthly',
        ]);

        $response
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['terms_accepted']);
    }

    /**
     * The signup form offers "Tracker" and "Tracker + Payroll", with the second
     * preselected. Since basic_payroll is a strict superset, defaulting to the
     * smaller plan is the only choice that can cost the trialist anything.
     */
    public function test_trial_defaults_to_the_superset_plan_when_none_is_chosen(): void
    {
        Mail::fake();

        $this->postJson('/api/auth/signup-owner', [
            'company_name' => 'CareVance Labs',
            'name' => 'Workspace Owner',
            'email' => 'owner@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'signup_mode' => 'trial',
            'terms_accepted' => true,
        ])->assertCreated()->assertJsonPath('organization.plan_code', 'basic_payroll');
    }

    /**
     * The company profile moved off the signup form to the setup checklist, so a
     * payload carrying none of those keys has to remain valid. Making any of
     * them required again would break every current client silently.
     */
    public function test_owner_signup_succeeds_without_any_company_profile_fields(): void
    {
        Mail::fake();

        $this->postJson('/api/auth/signup-owner', [
            'company_name' => 'CareVance Labs',
            'name' => 'Workspace Owner',
            'email' => 'owner@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'signup_mode' => 'trial',
            'terms_accepted' => true,
        ])->assertCreated();

        $organization = Organization::query()->firstOrFail();

        $this->assertNull($organization->address_line);
        $this->assertNull($organization->size);
        $this->assertNull($organization->industry);
    }

    /** A trial is capped at 5 seats however many the client asks for. */
    public function test_trial_seats_are_fixed_regardless_of_what_is_requested(): void
    {
        Mail::fake();

        $this->postJson('/api/auth/signup-owner', [
            'company_name' => 'CareVance Labs',
            'name' => 'Workspace Owner',
            'email' => 'owner@example.com',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'signup_mode' => 'trial',
            'seats' => 500,
            'terms_accepted' => true,
        ])->assertCreated();

        $this->assertSame(5, (int) Organization::query()->firstOrFail()->max_seats);
    }
}
