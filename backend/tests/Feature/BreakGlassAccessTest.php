<?php

namespace Tests\Feature;

use App\Mail\BreakGlassAccessMail;
use App\Models\AuditLog;
use App\Models\BreakGlassSession;
use App\Models\Organization;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Mail;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * Governed vendor access to a customer tenant.
 *
 * Replaces `POST /super-admin/users/{user}/impersonate`, which minted an
 * unlimited, non-expiring, unlogged token for any user in any organisation —
 * no reason, no customer approval, no notification, no audit entry.
 */
class BreakGlassAccessTest extends TestCase
{
    use RefreshDatabase, BuildsPayrollFixture;

    private User $vendor;

    protected function setUp(): void
    {
        parent::setUp();

        Mail::fake();

        $this->buildPayrollFixture();

        // The customer's owner is who gets told about all of this.
        $this->organization->forceFill(['owner_user_id' => $this->admin->id])->saveQuietly();

        // A CareVance engineer. Deliberately outside any customer tenant.
        $this->vendor = User::factory()->create([
            'organization_id' => null,
            'role' => 'super_admin',
            'name' => 'Vendor Engineer',
            'email' => 'engineer@carevance.test',
        ]);
    }

    // ------------------------------------------------------------ the old way

    public function test_the_old_unlogged_impersonation_route_is_gone(): void
    {
        $uris = collect(\Illuminate\Support\Facades\Route::getRoutes())
            ->map(fn ($route) => $route->uri())
            ->all();

        $this->assertNotContains(
            'api/super-admin/users/{user}/impersonate',
            $uris,
            'Unlogged, unlimited impersonation must not be reachable.'
        );
    }

    public function test_super_admin_controller_no_longer_calls_a_sanctum_method_it_does_not_have(): void
    {
        $source = file_get_contents(base_path('app/Http/Controllers/Api/SuperAdminController.php'));

        $this->assertStringNotContainsString(
            '->createToken(',
            $source,
            'User does not use HasApiTokens and Sanctum is not installed — this raised a fatal error on every call.'
        );
    }

    // ------------------------------------------------------------- requesting

    public function test_a_request_without_a_real_reason_is_refused(): void
    {
        $this->actingAs($this->vendor)
            ->postJson('/api/super-admin/break-glass', [
                'user_id' => $this->employee->id,
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('reason');

        $this->actingAs($this->vendor)
            ->postJson('/api/super-admin/break-glass', [
                'user_id' => $this->employee->id,
                'reason' => 'test',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('reason');
    }

    public function test_requesting_creates_a_pending_session_and_hands_out_no_token(): void
    {
        $response = $this->actingAs($this->vendor)
            ->postJson('/api/super-admin/break-glass', [
                'user_id' => $this->employee->id,
                'reason' => 'Investigating a payslip that shows a negative net pay.',
            ])
            ->assertStatus(201);

        $this->assertArrayNotHasKey('token', $response->json('data'));

        $session = BreakGlassSession::withoutOrganizationScope()->firstOrFail();

        $this->assertSame('pending', $session->status);
        $this->assertSame($this->organization->id, $session->organization_id);
        $this->assertSame($this->employee->id, $session->target_user_id);
        $this->assertSame($this->vendor->id, $session->requested_by_user_id);
        $this->assertNull($session->expires_at);
        $this->assertFalse($session->isUsable());
    }

    public function test_the_customer_owner_is_told_when_access_is_requested(): void
    {
        $this->actingAs($this->vendor)
            ->postJson('/api/super-admin/break-glass', [
                'user_id' => $this->employee->id,
                'reason' => 'Investigating a failed bank transfer batch.',
            ])
            ->assertStatus(201);

        Mail::assertQueued(BreakGlassAccessMail::class, function (BreakGlassAccessMail $mail) {
            return $mail->hasTo($this->admin->email) && $mail->stage === 'requested';
        });
    }

    public function test_the_request_itself_is_audited_with_its_reason(): void
    {
        $this->actingAs($this->vendor)
            ->postJson('/api/super-admin/break-glass', [
                'user_id' => $this->employee->id,
                'reason' => 'Customer reported a duplicate PF ECR line.',
            ])
            ->assertStatus(201);

        $entry = AuditLog::withoutOrganizationScope()
            ->where('action', 'break_glass.requested')
            ->first();

        $this->assertNotNull($entry);
        $this->assertSame($this->vendor->id, $entry->actor_user_id);
        $this->assertSame($this->organization->id, $entry->organization_id);
        $this->assertSame('Customer reported a duplicate PF ECR line.', $entry->metadata['reason']);
    }

    // ---------------------------------------------------------------- the gate

    public function test_a_token_cannot_be_minted_while_the_request_is_pending(): void
    {
        $session = $this->requestAccess();

        $this->actingAs($this->vendor)
            ->postJson("/api/super-admin/break-glass/{$session->id}/token")
            ->assertStatus(403)
            ->assertJsonPath('error_code', 'BREAK_GLASS_UNAVAILABLE');

        $this->assertSame(
            0,
            DB::table('personal_access_tokens')->where('name', "break-glass:{$session->id}")->count()
        );
    }

    public function test_only_the_engineer_who_asked_may_use_the_session(): void
    {
        $session = $this->requestAccess();
        $this->approveAs($this->admin, $session);

        $otherEngineer = User::factory()->create([
            'organization_id' => null,
            'role' => 'super_admin',
            'email' => 'other@carevance.test',
        ]);

        $this->actingAs($otherEngineer)
            ->postJson("/api/super-admin/break-glass/{$session->id}/token")
            ->assertStatus(403);
    }

    public function test_a_customer_admin_cannot_reach_another_organisations_session(): void
    {
        $session = $this->requestAccess();

        $otherOrg = Organization::factory()->create(['name' => 'Someone Else Ltd']);
        $outsider = User::factory()->create([
            'organization_id' => $otherOrg->id,
            'role' => 'admin',
            'email' => 'outsider@elsewhere.test',
        ]);

        $this->actingAs($outsider)
            ->postJson("/api/security/break-glass/{$session->id}/approve")
            ->assertStatus(404);

        $this->assertSame('pending', $session->refresh()->status);
    }

    public function test_an_ordinary_admin_cannot_request_access_to_anyone(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/super-admin/break-glass', [
                'user_id' => $this->employee->id,
                'reason' => 'I would simply like to read a colleague payslip.',
            ])
            ->assertStatus(403);
    }

    // -------------------------------------------------------------- the grant

    public function test_approval_lets_the_engineer_act_as_the_target_user(): void
    {
        $session = $this->requestAccess();
        $this->approveAs($this->admin, $session);

        $token = $this->mintToken($session);

        $this->withHeaders(['Authorization' => "Bearer {$token}", 'Accept' => 'application/json'])
            ->getJson('/api/auth/me')
            ->assertOk()
            // successResponse() spreads the payload at the top level.
            ->assertJsonPath('email', $this->employee->email)
            ->assertJsonPath('id', $this->employee->id);
    }

    public function test_the_grant_is_capped_at_one_hour_however_long_is_asked_for(): void
    {
        $session = $this->requestAccess();

        $this->actingAs($this->admin)
            ->postJson("/api/security/break-glass/{$session->id}/approve", ['minutes' => 100000])
            ->assertStatus(422)
            ->assertJsonValidationErrors('minutes');

        $this->approveAs($this->admin, $session, BreakGlassSession::MAX_DURATION_MINUTES);

        $session->refresh();

        $this->assertLessThanOrEqual(
            BreakGlassSession::MAX_DURATION_MINUTES,
            $session->remainingMinutes()
        );
    }

    public function test_the_issued_token_never_outlives_the_session(): void
    {
        $session = $this->requestAccess();
        $this->approveAs($this->admin, $session);
        $this->mintToken($session);

        $tokenRow = DB::table('personal_access_tokens')
            ->where('name', "break-glass:{$session->id}")
            ->first();

        $this->assertNotNull($tokenRow);
        $this->assertNotNull($tokenRow->expires_at, 'A break-glass token must always expire.');

        $this->assertLessThanOrEqual(
            $session->refresh()->expires_at->addMinute()->timestamp,
            \Carbon\Carbon::parse($tokenRow->expires_at)->timestamp,
            'The token must not outlive the approved window.'
        );
    }

    // ------------------------------------------------------------ termination

    public function test_revoking_kills_the_live_token_immediately(): void
    {
        $session = $this->requestAccess();
        $this->approveAs($this->admin, $session);
        $token = $this->mintToken($session);

        // Working before.
        $this->withHeaders(['Authorization' => "Bearer {$token}", 'Accept' => 'application/json'])
            ->getJson('/api/auth/me')
            ->assertOk();

        $this->actingAs($this->admin)
            ->postJson("/api/security/break-glass/{$session->id}/revoke", ['reason' => 'Done, thanks.'])
            ->assertOk();

        // Dead after. Revocation that leaves a working token behind is theatre.
        $this->withHeaders(['Authorization' => "Bearer {$token}", 'Accept' => 'application/json'])
            ->getJson('/api/auth/me')
            ->assertStatus(401);

        $this->assertSame(
            0,
            DB::table('personal_access_tokens')->where('name', "break-glass:{$session->id}")->count()
        );
    }

    public function test_a_declined_request_can_never_be_used(): void
    {
        $session = $this->requestAccess();

        $this->actingAs($this->admin)
            ->postJson("/api/security/break-glass/{$session->id}/reject", ['reason' => 'No.'])
            ->assertOk();

        $this->assertSame('rejected', $session->refresh()->status);
        $this->assertFalse($session->isUsable());

        $this->actingAs($this->vendor)
            ->postJson("/api/super-admin/break-glass/{$session->id}/token")
            ->assertStatus(403);
    }

    // ------------------------------------------------------------ attribution

    /**
     * The whole reason break-glass is auditable rather than merely logged: the
     * acting user during a session is the CUSTOMER'S employee, so without the
     * session id the trail says "Priya changed this" when Priya was asleep.
     */
    public function test_writes_during_a_session_are_attributed_to_it(): void
    {
        $session = $this->requestAccess();
        $this->approveAs($this->admin, $session);

        $this->actingAs($this->admin);
        request()->attributes->set('break_glass_session_id', $session->id);

        AuditLog::withoutOrganizationScope()->delete();

        PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => now()->format('Y-m'),
            'status' => 'draft',
        ]);

        $entry = AuditLog::withoutOrganizationScope()
            ->where('action', 'payroll_monthly_run.created')
            ->first();

        $this->assertNotNull($entry);
        $this->assertSame(
            $session->id,
            $entry->metadata['break_glass_session_id'] ?? null,
            'Every write during a break-glass session must name the session.'
        );
    }

    // ----------------------------------------------------------------- policy

    public function test_an_organisation_may_choose_notify_only_and_is_told_at_once(): void
    {
        $this->organization->forceFill([
            'settings' => array_merge($this->organization->settings ?? [], [
                'security' => ['break_glass_policy' => 'notify_only'],
            ]),
        ])->saveQuietly();

        $this->actingAs($this->vendor)
            ->postJson('/api/super-admin/break-glass', [
                'user_id' => $this->employee->id,
                'reason' => 'Tenant cannot log in at all, so nobody can approve.',
            ])
            ->assertStatus(201);

        $session = BreakGlassSession::withoutOrganizationScope()->firstOrFail();

        $this->assertSame('approved', $session->status);
        $this->assertTrue($session->isUsable());

        Mail::assertQueued(BreakGlassAccessMail::class, fn (BreakGlassAccessMail $m) => $m->stage === 'granted');
    }

    public function test_approval_required_is_the_default_for_an_organisation_that_has_not_chosen(): void
    {
        $service = app(\App\Services\Security\BreakGlassService::class);

        $this->assertSame('approval_required', $service->policyFor($this->organization));
    }

    // ------------------------------------------------------------------ utils

    private function requestAccess(): BreakGlassSession
    {
        $this->actingAs($this->vendor)
            ->postJson('/api/super-admin/break-glass', [
                'user_id' => $this->employee->id,
                'reason' => 'Investigating a reported payroll discrepancy.',
            ])
            ->assertStatus(201);

        return BreakGlassSession::withoutOrganizationScope()->latest('id')->firstOrFail();
    }

    private function approveAs(User $approver, BreakGlassSession $session, ?int $minutes = null): void
    {
        $this->actingAs($approver)
            ->postJson(
                "/api/security/break-glass/{$session->id}/approve",
                $minutes === null ? [] : ['minutes' => $minutes]
            )
            ->assertOk();
    }

    private function mintToken(BreakGlassSession $session): string
    {
        return $this->actingAs($this->vendor)
            ->postJson("/api/super-admin/break-glass/{$session->id}/token")
            ->assertOk()
            ->json('data.token');
    }
}
