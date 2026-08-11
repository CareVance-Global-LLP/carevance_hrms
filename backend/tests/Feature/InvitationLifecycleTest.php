<?php

namespace Tests\Feature;

use App\Jobs\SendInvitationMail;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Queue;
use Tests\TestCase;

/**
 * What happens to an invitation after it is sent.
 *
 * The invite flow could previously only create: an invitation whose mail failed
 * could not be resent, one sent to the wrong address could not be withdrawn,
 * and none of them could carry a joining date, so every invited employee's
 * onboarding checklist anchored on whenever they clicked the link.
 */
class InvitationLifecycleTest extends TestCase
{
    use RefreshDatabase;

    public function test_resend_rotates_the_token_so_the_old_link_stops_working(): void
    {
        Mail::fake();
        [, $owner] = $this->createWorkspaceOwner();

        $originalToken = $this->createPendingInvitation($owner, 'resend.me@example.com');
        $invitation = Invitation::first();

        $response = $this->postJson(
            "/api/invitations/{$invitation->id}/resend",
            [],
            $this->apiHeadersFor($owner)
        )->assertOk();

        $newUrl = (string) $response->json('invitation.invite_url');
        $newToken = basename(parse_url($newUrl, PHP_URL_PATH) ?: '');

        $this->assertNotSame($originalToken, $newToken, 'Resend must issue a fresh token.');

        // Only the hash is stored, so a resend cannot repeat the original link.
        // Rotating is what makes this the regenerate action for link invites.
        $this->getJson("/api/invitations/{$originalToken}")->assertStatus(404);
        $this->getJson("/api/invitations/{$newToken}")
            ->assertOk()
            ->assertJsonPath('invitation.can_accept', true);
    }

    public function test_resend_extends_the_expiry_of_an_expired_invitation(): void
    {
        Mail::fake();
        [$organization, $owner] = $this->createWorkspaceOwner();

        Invitation::create([
            'organization_id' => $organization->id,
            'email' => 'lapsed@example.com',
            'role' => 'employee',
            'token_hash' => Invitation::hashPublicToken(Invitation::generatePublicToken()),
            'invited_by' => $owner->id,
            'status' => 'pending',
            'delivery_method' => 'email',
            'expires_at' => now()->subDay(),
        ]);

        $invitation = Invitation::first();

        $this->postJson("/api/invitations/{$invitation->id}/resend", [], $this->apiHeadersFor($owner))
            ->assertOk()
            ->assertJsonPath('invitation.status', 'pending');

        $this->assertTrue(Invitation::first()->expires_at->isFuture());
    }

    public function test_an_accepted_invitation_cannot_be_resent_or_revoked(): void
    {
        Mail::fake();
        [$organization, $owner] = $this->createWorkspaceOwner();

        $token = $this->createPendingInvitation($owner, 'already.in@example.com');

        $this->postJson("/api/invitations/{$token}/accept", [
            'name' => 'Already In',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])->assertCreated();

        $invitation = Invitation::first();

        $this->postJson("/api/invitations/{$invitation->id}/resend", [], $this->apiHeadersFor($owner))
            ->assertStatus(422);

        $this->deleteJson("/api/invitations/{$invitation->id}", [], $this->apiHeadersFor($owner))
            ->assertStatus(422);
    }

    public function test_revoke_kills_the_link_without_deleting_the_record(): void
    {
        Mail::fake();
        [, $owner] = $this->createWorkspaceOwner();

        $token = $this->createPendingInvitation($owner, 'withdrawn@example.com');
        $invitation = Invitation::first();

        $this->deleteJson("/api/invitations/{$invitation->id}", [], $this->apiHeadersFor($owner))
            ->assertOk()
            ->assertJsonPath('invitation.status', 'revoked');

        $this->postJson("/api/invitations/{$token}/accept", [
            'name' => 'Withdrawn',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])->assertStatus(422);

        // Revoked, not deleted: who was invited and by whom stays on the record.
        $this->assertDatabaseHas('invitations', [
            'email' => 'withdrawn@example.com',
            'status' => 'revoked',
        ]);
    }

    public function test_an_invitation_from_another_workspace_cannot_be_resent_or_revoked(): void
    {
        Mail::fake();
        [, $owner] = $this->createWorkspaceOwner();
        [, $outsider] = $this->createWorkspaceOwner('Rival', 'rival', 'rival-owner@example.com');

        $this->createPendingInvitation($owner, 'target@example.com');
        $invitation = Invitation::first();

        // Invitation carries no tenant scope, so the organization filter is
        // written out in the controller. Without it an id from another
        // workspace would resolve and be actionable across the boundary.
        $this->postJson("/api/invitations/{$invitation->id}/resend", [], $this->apiHeadersFor($outsider))
            ->assertStatus(404);

        $this->deleteJson("/api/invitations/{$invitation->id}", [], $this->apiHeadersFor($outsider))
            ->assertStatus(404);

        $this->assertSame('pending', Invitation::first()->status);
    }

    public function test_an_employee_cannot_resend_or_revoke(): void
    {
        Mail::fake();
        [$organization, $owner] = $this->createWorkspaceOwner();

        $employee = User::create([
            'name' => 'Regular',
            'email' => 'regular@example.com',
            'password' => Hash::make('password123'),
            'role' => 'employee',
            'organization_id' => $organization->id,
            'email_verified_at' => now(),
        ]);

        $this->createPendingInvitation($owner, 'someone@example.com');
        $invitation = Invitation::first();

        $this->postJson("/api/invitations/{$invitation->id}/resend", [], $this->apiHeadersFor($employee))
            ->assertStatus(403);

        $this->deleteJson("/api/invitations/{$invitation->id}", [], $this->apiHeadersFor($employee))
            ->assertStatus(403);
    }

    public function test_joining_date_survives_the_invitation_and_anchors_onboarding(): void
    {
        Mail::fake();
        [, $owner] = $this->createWorkspaceOwner();

        // A future start date is the normal case — the joiner is set up before
        // day one so the pre-boarding items have somewhere to land.
        $joiningDate = now()->addDays(21)->format('Y-m-d');

        $response = $this->postJson('/api/invitations', [
            'emails' => ['preboarded@example.com'],
            'role' => 'employee',
            'delivery' => 'link',
            'joining_date' => $joiningDate,
            'job_title' => 'Support Analyst',
        ], $this->apiHeadersFor($owner))->assertCreated();

        $this->assertSame($joiningDate, Invitation::first()->metadata['joining_date']);

        $token = basename(parse_url((string) $response->json('invitations.0.invite_url'), PHP_URL_PATH) ?: '');

        $this->postJson("/api/invitations/{$token}/accept", [
            'name' => 'Pre Boarded',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])->assertCreated();

        $user = User::where('email', 'preboarded@example.com')->firstOrFail();

        $this->assertDatabaseHas('employee_work_infos', [
            'user_id' => $user->id,
            'designation' => 'Support Analyst',
        ]);

        // Without the joining date the checklist anchored on the acceptance
        // date, which put every day -14 item in the past on arrival.
        $journey = \DB::table('onboarding_journeys')->where('user_id', $user->id)->first();
        $this->assertNotNull($journey, 'Accepting an invitation must open an onboarding journey.');
        $this->assertStringStartsWith($joiningDate, (string) $journey->joining_date);
    }

    public function test_a_joining_date_far_in_the_future_is_refused(): void
    {
        [, $owner] = $this->createWorkspaceOwner();

        $this->postJson('/api/invitations', [
            'emails' => ['typo@example.com'],
            'role' => 'employee',
            'delivery' => 'link',
            'joining_date' => now()->addYears(5)->format('Y-m-d'),
        ], $this->apiHeadersFor($owner))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['joining_date']);
    }

    public function test_invitation_mail_is_queued_rather_than_sent_inline(): void
    {
        Queue::fake();
        [, $owner] = $this->createWorkspaceOwner();

        $this->postJson('/api/invitations', [
            'emails' => ['one@example.com', 'two@example.com', 'three@example.com'],
            'role' => 'employee',
            'delivery' => 'email',
        ], $this->apiHeadersFor($owner))->assertCreated();

        // One job per recipient, so a single bad address cannot take the batch
        // down with it.
        Queue::assertPushed(SendInvitationMail::class, 3);
    }

    public function test_link_delivery_queues_no_mail(): void
    {
        Queue::fake();
        [, $owner] = $this->createWorkspaceOwner();

        $this->postJson('/api/invitations', [
            'email' => 'link.only@example.com',
            'role' => 'employee',
            'delivery' => 'link',
        ], $this->apiHeadersFor($owner))->assertCreated();

        Queue::assertNotPushed(SendInvitationMail::class);
    }

    public function test_a_revoked_invitation_is_not_mailed_when_its_job_runs(): void
    {
        Mail::fake();
        [$organization, $owner] = $this->createWorkspaceOwner();

        $token = Invitation::generatePublicToken();
        $invitation = Invitation::create([
            'organization_id' => $organization->id,
            'email' => 'called.back@example.com',
            'role' => 'employee',
            'token_hash' => Invitation::hashPublicToken($token),
            'invited_by' => $owner->id,
            'status' => 'revoked',
            'delivery_method' => 'email',
            'expires_at' => now()->addDay(),
        ]);

        // The job re-reads the row instead of trusting a serialized copy, so an
        // invitation withdrawn between dispatch and delivery is not still sent.
        (new SendInvitationMail($invitation->id, $token))->handle();

        Mail::assertNothingSent();
    }

    private function createPendingInvitation(User $owner, string $email): string
    {
        $response = $this->postJson('/api/invitations', [
            'emails' => [$email],
            'role' => 'employee',
            'delivery' => 'link',
        ], $this->apiHeadersFor($owner))->assertCreated();

        return basename(parse_url((string) $response->json('invitations.0.invite_url'), PHP_URL_PATH) ?: '');
    }

    private function createWorkspaceOwner(
        string $name = 'CareVance',
        string $slug = 'carevance',
        string $ownerEmail = 'owner@example.com',
    ): array {
        $organization = Organization::create([
            'name' => $name,
            'slug' => $slug,
            'plan_code' => 'basic',
            'subscription_status' => 'trial',
            'subscription_intent' => 'trial',
            'trial_starts_at' => now(),
            'trial_ends_at' => now()->addDays(14),
            'subscription_expires_at' => now()->addDays(14)->toDateString(),
        ]);

        $owner = User::create([
            'name' => 'Owner',
            'email' => $ownerEmail,
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
            'email_verified_at' => now(),
        ]);

        $organization->forceFill(['owner_user_id' => $owner->id])->save();

        return [$organization->fresh(), $owner->fresh()];
    }
}
