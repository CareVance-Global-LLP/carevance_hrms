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
            'plan_code' => 'basic',
            'signup_mode' => 'trial',
            'billing_cycle' => 'monthly',
            'terms_accepted' => true,
        ]);

        $response
            ->assertCreated()
            ->assertJsonPath('user.role', 'admin')
            ->assertJsonPath('organization.name', 'CareVance Labs')
            ->assertJsonPath('organization.plan_code', 'basic')
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
            'plan_code' => 'advanced_tracker',
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
                'plan_code' => 'basic',
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
            'plan_code' => 'basic',
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
            'plan_code' => 'basic',
            'signup_mode' => 'trial',
            'billing_cycle' => 'monthly',
        ]);

        $response
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['terms_accepted']);
    }
}
