<?php

namespace Tests\Feature;

use App\Mail\CareVanceInvitationMail;
use App\Mail\VerifyEmailMail;
use App\Models\Invitation;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

class InvitationFlowTest extends TestCase
{
    use RefreshDatabase;

    public function test_owner_can_send_invitation_email_and_invited_user_can_accept_once(): void
    {
        Mail::fake();

        [$organization, $owner] = $this->createWorkspaceOwner();

        $inviteResponse = $this->postJson('/api/invitations', [
            'emails' => ['new.employee@example.com'],
            'role' => 'employee',
            'delivery' => 'email',
        ], $this->apiHeadersFor($owner));

        $inviteResponse
            ->assertCreated()
            ->assertJsonPath('invited_count', 1)
            ->assertJsonPath('invitations.0.role', 'employee')
            ->assertJsonPath('invitations.0.mail_delivery', 'sent');

        Mail::assertSent(CareVanceInvitationMail::class);

        $inviteUrl = (string) $inviteResponse->json('invitations.0.invite_url');
        $token = basename(parse_url($inviteUrl, PHP_URL_PATH) ?: '');

        $this->getJson("/api/invitations/{$token}")
            ->assertOk()
            ->assertJsonPath('invitation.email', 'new.employee@example.com')
            ->assertJsonPath('invitation.role', 'employee')
            ->assertJsonPath('invitation.organization.id', $organization->id)
            ->assertJsonPath('invitation.can_accept', true);

        $acceptResponse = $this->postJson("/api/invitations/{$token}/accept", [
            'name' => 'New Employee',
            'password' => 'password123',
            'password_confirmation' => 'password123',
            'role' => 'admin',
        ]);

        $acceptResponse
            ->assertCreated()
            ->assertJsonPath('user.email', 'new.employee@example.com')
            ->assertJsonPath('user.role', 'employee')
            ->assertJsonPath('organization.id', $organization->id)
            ->assertJsonPath('requires_verification', true)
            ->assertJsonMissingPath('token')
            ->assertJsonPath('verification_email_sent', true);

        $this->assertDatabaseHas('invitations', [
            'organization_id' => $organization->id,
            'email' => 'new.employee@example.com',
            'status' => 'accepted',
        ]);
        Mail::assertQueued(VerifyEmailMail::class);

        $this->postJson("/api/invitations/{$token}/accept", [
            'name' => 'New Employee',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])->assertStatus(422);
    }

    public function test_non_owner_admin_can_invite_another_admin(): void
    {
        [$organization, $owner] = $this->createWorkspaceOwner();

        $admin = User::create([
            'name' => 'Secondary Admin',
            'email' => 'secondary-admin@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);

        $this->postJson('/api/invitations', [
            'emails' => ['forbidden-admin@example.com'],
            'role' => 'admin',
            'delivery' => 'link',
        ], $this->apiHeadersFor($admin))
            ->assertCreated()
            ->assertJsonPath('invited_count', 1)
            ->assertJsonPath('invitations.0.role', 'admin');

        $this->postJson('/api/invitations', [
            'emails' => ['manager@example.com'],
            'role' => 'manager',
            'delivery' => 'link',
        ], $this->apiHeadersFor($admin))
            ->assertCreated()
            ->assertJsonPath('invitations.0.role', 'manager');
    }

    public function test_expired_invitation_cannot_be_accepted(): void
    {
        [$organization, $owner] = $this->createWorkspaceOwner();
        $token = Invitation::generatePublicToken();

        Invitation::create([
            'organization_id' => $organization->id,
            'email' => 'expired@example.com',
            'role' => 'employee',
            'token_hash' => Invitation::hashPublicToken($token),
            'invited_by' => $owner->id,
            'status' => 'pending',
            'delivery_method' => 'link',
            'expires_at' => now()->subHour(),
        ]);

        $this->getJson("/api/invitations/{$token}")
            ->assertOk()
            ->assertJsonPath('invitation.status', 'expired')
            ->assertJsonPath('invitation.can_accept', false);

        $this->postJson("/api/invitations/{$token}/accept", [
            'name' => 'Expired User',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])->assertStatus(422);
    }

    public function test_missing_invitation_token_returns_friendly_not_found_message(): void
    {
        $missingToken = Invitation::generatePublicToken();

        $this->getJson("/api/invitations/{$missingToken}")
            ->assertStatus(404)
            ->assertJsonPath('message', 'This invitation is no longer available.');

        $this->postJson("/api/invitations/{$missingToken}/accept", [
            'name' => 'Missing Invite User',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])
            ->assertStatus(404)
            ->assertJsonPath('message', 'This invitation is no longer available.');
    }

    public function test_manager_can_only_invite_employee_role(): void
    {
        [$organization] = $this->createWorkspaceOwner();

        $manager = User::create([
            'name' => 'Manager',
            'email' => 'manager@example.com',
            'password' => Hash::make('password123'),
            'role' => 'manager',
            'organization_id' => $organization->id,
        ]);

        $this->postJson('/api/invitations', [
            'emails' => ['employee@example.com'],
            'role' => 'employee',
            'delivery' => 'link',
        ], $this->apiHeadersFor($manager))
            ->assertCreated()
            ->assertJsonPath('invitations.0.role', 'employee');

        $this->postJson('/api/invitations', [
            'emails' => ['manager-2@example.com'],
            'role' => 'manager',
            'delivery' => 'link',
        ], $this->apiHeadersFor($manager))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['role']);
    }

    public function test_invitation_accept_endpoint_is_rate_limited(): void
    {
        [$organization, $owner] = $this->createWorkspaceOwner();
        $token = Invitation::generatePublicToken();

        Invitation::create([
            'organization_id' => $organization->id,
            'email' => 'new.employee@example.com',
            'role' => 'employee',
            'token_hash' => Invitation::hashPublicToken($token),
            'invited_by' => $owner->id,
            'status' => 'pending',
            'delivery_method' => 'link',
            'expires_at' => now()->addHours(24),
        ]);

        foreach (range(1, 10) as $attempt) {
            $this->postJson("/api/invitations/{$token}/accept", [
                'name' => 'New Employee',
                'password' => 'short',
                'password_confirmation' => 'short',
            ])->assertStatus(422);
        }

        $this->postJson("/api/invitations/{$token}/accept", [
            'name' => 'New Employee',
            'password' => 'short',
            'password_confirmation' => 'short',
        ])->assertStatus(429);
    }

    public function test_owner_can_bulk_import_csv_invitations_with_row_roles(): void
    {
        Mail::fake();

        [, $owner] = $this->createWorkspaceOwner();

        $rows = collect(range(1, 120))
            ->map(fn (int $index) => [
                'email' => "bulk-user-{$index}@example.com",
                'role' => $index % 3 === 0 ? 'admin' : ($index % 2 === 0 ? 'manager' : 'employee'),
                'group_ids' => [],
            ])
            ->all();

        $response = $this->postJson('/api/invitations/import', [
            'rows' => $rows,
            'settings' => [
                'attendance_monitoring' => true,
            ],
        ], $this->apiHeadersFor($owner));

        $response
            ->assertCreated()
            ->assertJsonPath('invited_count', 120)
            ->assertJsonCount(120, 'invitations')
            ->assertJsonCount(0, 'failed');

        Mail::assertSent(CareVanceInvitationMail::class, 120);

        $this->assertDatabaseCount('invitations', 120);
    }

    public function test_invitation_settings_support_all_monitoring_intervals_and_are_copied_to_user(): void
    {
        [$organization, $owner] = $this->createWorkspaceOwner();

        $inviteResponse = $this->postJson('/api/invitations', [
            'email' => 'settings-user@example.com',
            'role' => 'employee',
            'delivery' => 'link',
            'settings' => [
                'monitoring_interval_minutes' => 1,
                'can_edit_time' => true,
                'attendance_monitoring' => true,
                'payroll_visibility' => true,
                'task_assignment_access' => false,
            ],
        ], $this->apiHeadersFor($owner));

        $inviteResponse
            ->assertCreated()
            ->assertJsonPath('invitations.0.metadata.group_ids', [])
            ->assertJsonPath('invitations.0.role', 'employee');

        $invitation = Invitation::query()->where('email', 'settings-user@example.com')->firstOrFail();
        $this->assertSame(1, $invitation->settings['monitoring_interval_minutes']);
        $this->assertTrue($invitation->settings['can_edit_time']);
        $this->assertFalse($invitation->settings['payroll_visibility']);

        $token = basename(parse_url((string) $inviteResponse->json('invitations.0.invite_url'), PHP_URL_PATH) ?: '');

        $this->postJson("/api/invitations/{$token}/accept", [
            'name' => 'Settings User',
            'password' => 'password123',
            'password_confirmation' => 'password123',
        ])->assertCreated();

        $accepted = User::query()->where('email', 'settings-user@example.com')->firstOrFail();
        $this->assertSame($organization->id, $accepted->organization_id);
        $this->assertSame(1, $accepted->settings['monitoring_interval_minutes']);
        $this->assertTrue($accepted->settings['can_edit_time']);
        $this->assertFalse($accepted->settings['payroll_visibility']);
    }

    public function test_each_invited_employee_keeps_their_own_monitoring_and_edit_time_settings(): void
    {
        [$organization, $owner] = $this->createWorkspaceOwner();

        $firstInviteResponse = $this->postJson('/api/invitations', [
            'email' => 'employee-one@example.com',
            'role' => 'employee',
            'delivery' => 'link',
            'settings' => [
                'monitoring_interval_minutes' => 1,
                'can_edit_time' => false,
                'attendance_monitoring' => true,
                'task_assignment_access' => true,
            ],
        ], $this->apiHeadersFor($owner))->assertCreated();

        $secondInviteResponse = $this->postJson('/api/invitations', [
            'email' => 'employee-two@example.com',
            'role' => 'employee',
            'delivery' => 'link',
            'settings' => [
                'monitoring_interval_minutes' => 5,
                'can_edit_time' => true,
                'attendance_monitoring' => true,
                'task_assignment_access' => true,
            ],
        ], $this->apiHeadersFor($owner))->assertCreated();

        foreach ([
            [$firstInviteResponse, 'Employee One'],
            [$secondInviteResponse, 'Employee Two'],
        ] as [$response, $name]) {
            $token = basename(parse_url((string) $response->json('invitations.0.invite_url'), PHP_URL_PATH) ?: '');

            $this->postJson("/api/invitations/{$token}/accept", [
                'name' => $name,
                'password' => 'password123',
                'password_confirmation' => 'password123',
            ])->assertCreated();
        }

        $firstEmployee = User::query()->where('email', 'employee-one@example.com')->firstOrFail();
        $secondEmployee = User::query()->where('email', 'employee-two@example.com')->firstOrFail();

        $this->assertSame($organization->id, $firstEmployee->organization_id);
        $this->assertSame(1, $firstEmployee->settings['monitoring_interval_minutes']);
        $this->assertFalse($firstEmployee->settings['can_edit_time']);

        $this->assertSame($organization->id, $secondEmployee->organization_id);
        $this->assertSame(5, $secondEmployee->settings['monitoring_interval_minutes']);
        $this->assertTrue($secondEmployee->settings['can_edit_time']);
    }

    public function test_invitation_rejects_unsupported_monitoring_interval(): void
    {
        [, $owner] = $this->createWorkspaceOwner();

        $this->postJson('/api/invitations', [
            'email' => 'invalid-interval@example.com',
            'role' => 'employee',
            'delivery' => 'link',
            'settings' => [
                'monitoring_interval_minutes' => 2,
            ],
        ], $this->apiHeadersFor($owner))
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['settings.monitoring_interval_minutes']);
    }

    private function createWorkspaceOwner(): array
    {
        $organization = Organization::create([
            'name' => 'CareVance',
            'slug' => 'carevance',
            'plan_code' => 'basic',
            'subscription_status' => 'trial',
            'subscription_intent' => 'trial',
            'trial_starts_at' => now(),
            'trial_ends_at' => now()->addDays(14),
            'subscription_expires_at' => now()->addDays(14)->toDateString(),
        ]);

        $owner = User::create([
            'name' => 'Owner',
            'email' => 'owner@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
            'email_verified_at' => now(),
        ]);

        $organization->forceFill(['owner_user_id' => $owner->id])->save();

        return [$organization->fresh(), $owner->fresh()];
    }
}
