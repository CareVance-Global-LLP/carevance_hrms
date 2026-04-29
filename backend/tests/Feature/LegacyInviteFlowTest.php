<?php

namespace Tests\Feature;

use App\Mail\VerifyEmailMail;
use App\Models\Invite;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class LegacyInviteFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_legacy_invite_acceptance_creates_a_user_in_the_inviter_workspace(): void
    {
        Mail::fake();

        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
        ]);

        $creator = User::create([
            'name' => 'Admin User',
            'email' => 'admin@example.com',
            'password' => 'password123',
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $invite = Invite::create([
            'email' => 'new.employee@example.com',
            'role' => 'employee',
            'token' => 'legacy-invite-token',
            'created_by' => $creator->id,
            'expires_at' => now()->addDay(),
        ]);

        $this->postJson('/api/invites/accept', [
            'token' => $invite->token,
            'name' => 'New Employee',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])
            ->assertCreated()
            ->assertJsonPath('user.email', 'new.employee@example.com')
            ->assertJsonPath('organization.id', $organization->id)
            ->assertJsonPath('requires_verification', true)
            ->assertJsonPath('email', 'new.employee@example.com');

        $this->assertDatabaseHas('users', [
            'email' => 'new.employee@example.com',
            'organization_id' => $organization->id,
            'role' => 'employee',
            'invited_by' => $creator->id,
        ]);

        $this->assertNotNull($invite->fresh()?->accepted_at);
        Mail::assertQueued(VerifyEmailMail::class);
    }
}
