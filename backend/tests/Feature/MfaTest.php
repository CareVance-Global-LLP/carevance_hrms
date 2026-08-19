<?php

namespace Tests\Feature;

use App\Models\User;
use App\Models\UserMfaSecret;
use App\Services\Security\MfaService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use PragmaRX\Google2FA\Google2FA;
use Tests\Concerns\BuildsPayrollFixture;
use Tests\TestCase;

/**
 * Two-factor authentication.
 *
 * The product previously had no second factor of any kind, so a single leaked
 * password exposed the salary, PAN, Aadhaar and bank details of every employee
 * in the tenant.
 */
class MfaTest extends TestCase
{
    use RefreshDatabase, BuildsPayrollFixture;

    private const PASSWORD = 'correct-horse-battery-staple';

    protected function setUp(): void
    {
        parent::setUp();

        $this->buildPayrollFixture();

        foreach ([$this->admin, $this->employee] as $user) {
            $user->forceFill([
                'password' => Hash::make(self::PASSWORD),
                'email_verified_at' => now(),
            ])->saveQuietly();
        }
    }

    // ------------------------------------------------------------- enrolment

    public function test_an_account_starts_with_no_second_factor(): void
    {
        $this->actingAs($this->admin)
            ->getJson('/api/auth/mfa')
            ->assertOk()
            ->assertJsonPath('data.enrolled', false)
            ->assertJsonPath('data.privileged', true);
    }

    public function test_enrolment_produces_a_secret_and_a_scannable_uri(): void
    {
        $response = $this->actingAs($this->admin)
            ->postJson('/api/auth/mfa/setup')
            ->assertOk();

        $this->assertNotEmpty($response->json('data.secret'));
        $this->assertStringStartsWith('otpauth://totp/', $response->json('data.otpauth_url'));

        // Not yet in force: an abandoned setup must never lock anyone out.
        $this->assertFalse(app(MfaService::class)->isEnrolled($this->admin));
    }

    public function test_a_wrong_code_does_not_complete_enrolment(): void
    {
        $this->actingAs($this->admin)->postJson('/api/auth/mfa/setup')->assertOk();

        $this->actingAs($this->admin)
            ->postJson('/api/auth/mfa/confirm', ['code' => '000000'])
            ->assertStatus(422);

        $this->assertFalse(app(MfaService::class)->isEnrolled($this->admin));
    }

    public function test_confirming_switches_it_on_and_issues_recovery_codes(): void
    {
        $secret = $this->beginEnrolment($this->admin);

        $response = $this->actingAs($this->admin)
            ->postJson('/api/auth/mfa/confirm', ['code' => $this->codeFor($secret)])
            ->assertOk();

        $codes = $response->json('data.recovery_codes');

        $this->assertCount(MfaService::RECOVERY_CODE_COUNT, $codes);
        $this->assertTrue(app(MfaService::class)->isEnrolled($this->admin));
    }

    /**
     * A TOTP secret is a credential: anyone holding it can mint valid codes
     * forever. It must not sit in the clear in a database dump.
     */
    public function test_the_secret_is_encrypted_at_rest(): void
    {
        $secret = $this->beginEnrolment($this->admin);

        $raw = DB::table('user_mfa_secrets')->where('user_id', $this->admin->id)->value('secret');

        $this->assertNotSame($secret, $raw, 'The stored secret must not be the plaintext one.');
        $this->assertStringNotContainsString($secret, (string) $raw);

        // ...and still round-trips through the model.
        $this->assertSame($secret, UserMfaSecret::where('user_id', $this->admin->id)->first()->secret);
    }

    public function test_recovery_codes_are_hashed_not_stored_in_the_clear(): void
    {
        $codes = $this->enrol($this->admin);

        $stored = DB::table('user_recovery_codes')->where('user_id', $this->admin->id)->pluck('code_hash');

        foreach ($stored as $hash) {
            $this->assertNotContains($hash, $codes, 'Recovery codes must be hashed.');
        }
    }

    // ----------------------------------------------------------------- login

    public function test_login_without_mfa_still_returns_a_token(): void
    {
        $this->postJson('/api/auth/login', [
            'email' => $this->admin->email,
            'password' => self::PASSWORD,
        ])
            ->assertOk()
            ->assertJsonPath('mfa_required', null)
            ->assertJsonStructure(['token']);
    }

    public function test_login_with_mfa_returns_a_challenge_and_no_token(): void
    {
        $this->enrol($this->admin);

        $response = $this->postJson('/api/auth/login', [
            'email' => $this->admin->email,
            'password' => self::PASSWORD,
        ])->assertOk();

        $this->assertTrue($response->json('mfa_required'));
        $this->assertNotEmpty($response->json('challenge'));
        $this->assertNull($response->json('token'), 'A password alone must not produce a session.');
    }

    public function test_the_correct_code_completes_the_sign_in(): void
    {
        $secret = $this->enrolAndReturnSecret($this->admin);
        $challenge = $this->challengeFor($this->admin);

        $token = $this->postJson('/api/auth/mfa/verify', [
            'challenge' => $challenge,
            'code' => $this->codeFor($secret),
        ])
            ->assertOk()
            ->json('token');

        $this->assertNotEmpty($token);

        $this->withHeaders(['Authorization' => "Bearer {$token}", 'Accept' => 'application/json'])
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('email', $this->admin->email);
    }

    public function test_a_wrong_code_is_refused_but_does_not_throw_away_the_sign_in(): void
    {
        $secret = $this->enrolAndReturnSecret($this->admin);
        $challenge = $this->challengeFor($this->admin);

        $this->postJson('/api/auth/mfa/verify', ['challenge' => $challenge, 'code' => '000000'])
            ->assertStatus(422)
            ->assertJsonPath('error_code', 'MFA_CODE_INVALID');

        // A mistyped digit must not send the user back to the password form.
        $this->postJson('/api/auth/mfa/verify', [
            'challenge' => $challenge,
            'code' => $this->codeFor($secret),
        ])->assertOk();
    }

    public function test_a_challenge_cannot_be_used_twice(): void
    {
        $secret = $this->enrolAndReturnSecret($this->admin);
        $challenge = $this->challengeFor($this->admin);

        $this->postJson('/api/auth/mfa/verify', [
            'challenge' => $challenge,
            'code' => $this->codeFor($secret),
        ])->assertOk();

        $this->postJson('/api/auth/mfa/verify', [
            'challenge' => $challenge,
            'code' => $this->codeFor($secret),
        ])
            ->assertStatus(401)
            ->assertJsonPath('error_code', 'MFA_CHALLENGE_EXPIRED');
    }

    public function test_an_unknown_challenge_is_refused(): void
    {
        $this->postJson('/api/auth/mfa/verify', ['challenge' => 'made-up', 'code' => '123456'])
            ->assertStatus(401);
    }

    /**
     * The same code must not be accepted twice inside its own 30-second
     * window — otherwise a code read over someone's shoulder is reusable.
     */
    public function test_a_code_cannot_be_replayed(): void
    {
        $secret = $this->enrolAndReturnSecret($this->admin);
        $code = $this->codeFor($secret);

        $this->postJson('/api/auth/mfa/verify', [
            'challenge' => $this->challengeFor($this->admin),
            'code' => $code,
        ])->assertOk();

        $this->postJson('/api/auth/mfa/verify', [
            'challenge' => $this->challengeFor($this->admin),
            'code' => $code,
        ])->assertStatus(422);
    }

    public function test_a_recovery_code_works_once_and_only_once(): void
    {
        $codes = $this->enrol($this->admin);
        $code = $codes[0];

        $this->postJson('/api/auth/mfa/verify', [
            'challenge' => $this->challengeFor($this->admin),
            'code' => $code,
        ])->assertOk();

        $this->postJson('/api/auth/mfa/verify', [
            'challenge' => $this->challengeFor($this->admin),
            'code' => $code,
        ])->assertStatus(422);

        $this->assertSame(
            MfaService::RECOVERY_CODE_COUNT - 1,
            app(MfaService::class)->unusedRecoveryCodeCount($this->admin)
        );
    }

    // ----------------------------------------------------------- enforcement

    public function test_a_privileged_user_is_blocked_once_the_policy_is_enforced(): void
    {
        $this->setPolicy('enforced');

        $this->actingAs($this->admin)
            ->getJson('/api/payroll/filings/catalogue')
            ->assertStatus(403)
            ->assertJsonPath('error_code', 'MFA_ENROLMENT_REQUIRED');
    }

    public function test_a_blocked_user_can_still_reach_the_endpoints_that_unblock_them(): void
    {
        $this->setPolicy('enforced');

        $this->actingAs($this->admin)->getJson('/api/auth/mfa')->assertOk();
        $this->actingAs($this->admin)->postJson('/api/auth/mfa/setup')->assertOk();
        $this->actingAs($this->admin)->getJson('/api/auth/me')->assertOk();
    }

    public function test_enrolling_lifts_the_block(): void
    {
        $this->setPolicy('enforced');
        $this->enrol($this->admin);

        $this->actingAs($this->admin)
            ->getJson('/api/payroll/filings/catalogue')
            ->assertOk();
    }

    public function test_an_ordinary_employee_is_never_blocked(): void
    {
        $this->setPolicy('enforced');

        $this->assertFalse(app(MfaService::class)->isPrivileged($this->employee));
        $this->assertFalse(app(MfaService::class)->mustEnrolNow($this->employee));
    }

    public function test_the_grace_policy_does_not_block_before_the_window_closes(): void
    {
        $this->setPolicy('grace', now()->addDays(7)->toIso8601String());

        $this->assertFalse(app(MfaService::class)->mustEnrolNow($this->admin->fresh()));
    }

    /**
     * The deploy-day regression, pinned.
     *
     * The grace deadline once defaulted to `organization.created_at + 14 days`.
     * Every organisation that existed before the feature shipped was created
     * more than fourteen days ago, so the window was already in the past and
     * every admin, HR and payroll user was locked out of the whole API the
     * moment the code went live.
     */
    public function test_an_organisation_that_has_never_set_a_deadline_blocks_nobody(): void
    {
        $this->setPolicy('grace');

        // Deliberately old, exactly like every real tenant on the day this
        // shipped.
        $this->organization->forceFill(['created_at' => now()->subYears(2)])->saveQuietly();
        $this->organization->refresh();

        $this->assertNull(
            app(MfaService::class)->graceEndsAt($this->organization),
            'No deadline means no deadline — it must not be inferred from when the organisation was created.'
        );

        $this->assertFalse(
            app(MfaService::class)->mustEnrolNow($this->admin->fresh()),
            'An organisation that never chose a deadline must not have its admins locked out.'
        );

        $this->actingAs($this->admin)
            ->getJson('/api/payroll/filings/catalogue')
            ->assertOk();
    }

    public function test_the_grace_policy_blocks_once_the_window_has_closed(): void
    {
        $this->setPolicy('grace', now()->subDay()->toIso8601String());

        $this->assertTrue(app(MfaService::class)->mustEnrolNow($this->admin->fresh()));
    }

    public function test_a_policy_of_off_never_blocks_anyone(): void
    {
        $this->setPolicy('off');

        $this->assertFalse(app(MfaService::class)->mustEnrolNow($this->admin->fresh()));
    }

    // -------------------------------------------------------------- removal

    public function test_switching_it_off_needs_both_the_password_and_a_code(): void
    {
        $secret = $this->enrolAndReturnSecret($this->admin);

        $this->actingAs($this->admin)
            ->deleteJson('/api/auth/mfa', ['password' => 'wrong', 'code' => $this->codeFor($secret)])
            ->assertStatus(422);

        $this->actingAs($this->admin)
            ->deleteJson('/api/auth/mfa', ['password' => self::PASSWORD, 'code' => '000000'])
            ->assertStatus(422);

        $this->assertTrue(app(MfaService::class)->isEnrolled($this->admin));
    }

    public function test_it_cannot_be_switched_off_while_the_policy_enforces_it(): void
    {
        $secret = $this->enrolAndReturnSecret($this->admin);
        $this->setPolicy('enforced');

        $this->actingAs($this->admin)
            ->deleteJson('/api/auth/mfa', [
                'password' => self::PASSWORD,
                'code' => $this->codeFor($secret),
            ])
            ->assertStatus(409)
            ->assertJsonPath('error_code', 'MFA_REQUIRED_BY_POLICY');

        $this->assertTrue(app(MfaService::class)->isEnrolled($this->admin));
    }

    public function test_switching_it_off_signs_the_account_out_everywhere(): void
    {
        $secret = $this->enrolAndReturnSecret($this->admin);
        $this->setPolicy('off');

        $this->actingAs($this->admin)
            ->deleteJson('/api/auth/mfa', [
                'password' => self::PASSWORD,
                'code' => $this->codeFor($secret),
            ])
            ->assertOk();

        $this->assertFalse(app(MfaService::class)->isEnrolled($this->admin));
        $this->assertSame(
            0,
            DB::table('personal_access_tokens')
                ->where('tokenable_type', User::class)
                ->where('tokenable_id', $this->admin->id)
                ->count(),
            'Leaving sessions alive keeps the account reachable under the credential the user just stopped trusting.'
        );
    }

    // ----------------------------------------------------------------- utils

    private function setPolicy(string $policy, ?string $graceEndsAt = null): void
    {
        $security = ['mfa_policy' => $policy];

        if ($graceEndsAt !== null) {
            $security['mfa_grace_ends_at'] = $graceEndsAt;
        }

        $this->organization->forceFill([
            'settings' => array_merge($this->organization->settings ?? [], ['security' => $security]),
        ])->saveQuietly();

        $this->organization->refresh();
    }

    private function beginEnrolment(User $user): string
    {
        return $this->actingAs($user)
            ->postJson('/api/auth/mfa/setup')
            ->assertOk()
            ->json('data.secret');
    }

    /** @return array<int, string> the recovery codes */
    private function enrol(User $user): array
    {
        $secret = $this->beginEnrolment($user);

        $codes = $this->actingAs($user)
            ->postJson('/api/auth/mfa/confirm', ['code' => $this->codeFor($secret)])
            ->assertOk()
            ->json('data.recovery_codes');

        $this->allowTheNextCode($user);

        return $codes;
    }

    private function enrolAndReturnSecret(User $user): string
    {
        $secret = $this->beginEnrolment($user);

        $this->actingAs($user)
            ->postJson('/api/auth/mfa/confirm', ['code' => $this->codeFor($secret)])
            ->assertOk();

        $this->allowTheNextCode($user);

        return $secret;
    }

    /**
     * Clear the replay marker left by enrolment.
     *
     * Confirming enrolment spends a code, and a test that then signs in
     * milliseconds later would present that same code again — which the replay
     * guard correctly refuses. Real users do not hit this: enrolment happens
     * while already signed in, and anyone who does log out and straight back in
     * simply waits for the next code, exactly as GitHub and Google require.
     *
     * Clearing it here keeps that behaviour honest while letting tests about
     * *other* things use a code without waiting thirty seconds of wall clock.
     * The replay test deliberately does not call this.
     */
    private function allowTheNextCode(User $user): void
    {
        UserMfaSecret::where('user_id', $user->id)
            ->update(['last_used_timestamp' => null]);
    }

    private function challengeFor(User $user): string
    {
        // A fresh request object, so the default headers actingAs() pinned for
        // an earlier user cannot leak into this unauthenticated call.
        return $this->withHeaders(['Accept' => 'application/json'])
            ->postJson('/api/auth/login', [
                'email' => $user->email,
                'password' => self::PASSWORD,
            ])
            ->assertOk()
            ->json('challenge');
    }

    private function codeFor(string $secret): string
    {
        return app(Google2FA::class)->getCurrentOtp($secret);
    }
}
