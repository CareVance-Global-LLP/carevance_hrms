<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Monitoring\MonitoringConsentService;
use App\Services\Security\BreakGlassService;
use App\Services\Security\MfaService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The state nobody configures.
 *
 * Every other suite sets the thing it is testing, which is what a good test
 * does — and it is also why an entire class of bug walks straight past them.
 * The MFA grace window once defaulted to `organization.created_at + 14 days`.
 * Every test set an explicit deadline, so every test passed, and on deploy day
 * every real organisation — all of them created more than fourteen days
 * earlier — locked its admins out of the whole API. A human found it by
 * clicking on a blank screen.
 *
 * This suite exists to exercise the defaults instead: an organisation whose
 * settings are empty, one whose settings are null, one created years ago, a
 * user with no role. If a policy is going to fail closed on somebody who never
 * touched it, it should fail here first.
 *
 * When you add a policy with a default, add it to this file.
 */
class UnconfiguredDefaultsTest extends TestCase
{
    use RefreshDatabase;

    /**
     * An organisation nobody has configured, created long before any of this
     * shipped. This is what every existing tenant looks like on upgrade day.
     */
    private function untouchedOrganization(mixed $settings = []): Organization
    {
        $organization = Organization::factory()->create();

        $organization->forceFill([
            'settings' => $settings,
            'created_at' => now()->subYears(2),
        ])->saveQuietly();

        return $organization->fresh();
    }

    private function adminIn(Organization $organization): User
    {
        return User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'admin',
        ]);
    }

    // ------------------------------------------------------------------ MFA

    /**
     * The regression that shipped. Kept first because it is the whole point.
     */
    public function test_an_untouched_organisation_does_not_lock_its_admins_out(): void
    {
        $organization = $this->untouchedOrganization();
        $admin = $this->adminIn($organization);

        $this->assertFalse(
            app(MfaService::class)->mustEnrolNow($admin),
            'An organisation that never chose an MFA deadline must not block anybody.'
        );

        $this->actingAs($admin)
            ->getJson('/api/payroll/filings/catalogue')
            ->assertOk();
    }

    public function test_the_same_holds_when_settings_are_null_rather_than_empty(): void
    {
        // Null and [] reach data_get() differently, and a tenant that has never
        // saved settings has null.
        $organization = $this->untouchedOrganization(null);
        $admin = $this->adminIn($organization);

        $this->assertFalse(app(MfaService::class)->mustEnrolNow($admin));

        $this->actingAs($admin)
            ->getJson('/api/payroll/filings/catalogue')
            ->assertOk();
    }

    public function test_an_untouched_organisation_has_no_mfa_deadline_at_all(): void
    {
        $organization = $this->untouchedOrganization();

        $this->assertNull(
            app(MfaService::class)->graceEndsAt($organization),
            'A deadline must be given deliberately, never inferred from the organisation age.'
        );
    }

    public function test_a_malformed_mfa_deadline_does_not_take_the_application_down(): void
    {
        $organization = $this->untouchedOrganization([
            'security' => ['mfa_policy' => 'grace', 'mfa_grace_ends_at' => 'not-a-date'],
        ]);
        $admin = $this->adminIn($organization);

        // Unparseable must read as "no deadline", not as "already expired".
        $this->assertNull(app(MfaService::class)->graceEndsAt($organization));
        $this->assertFalse(app(MfaService::class)->mustEnrolNow($admin));
    }

    /**
     * An organisation opts in to MFA. Reading an unset setting as 'grace' made
     * every tenant that had never heard of the feature look like one part-way
     * through adopting it, and put them one stray deadline away from a
     * lockout — see the deadline test below.
     */
    public function test_an_organisation_that_never_chose_a_policy_has_mfa_off(): void
    {
        $this->assertSame('off', app(MfaService::class)->policyFor($this->untouchedOrganization()));
        $this->assertSame('off', app(MfaService::class)->policyFor($this->untouchedOrganization(null)));
    }

    public function test_an_unrecognised_mfa_policy_falls_back_to_the_one_that_blocks_nobody(): void
    {
        $organization = $this->untouchedOrganization(['security' => ['mfa_policy' => 'banana']]);

        $this->assertSame('off', app(MfaService::class)->policyFor($organization));
        $this->assertFalse(app(MfaService::class)->mustEnrolNow($this->adminIn($organization)));
    }

    /**
     * The policy and its deadline are two independent keys, so a stale or
     * hand-edited `mfa_grace_ends_at` can outlive the `mfa_policy` that
     * justified it. While the fallback was 'grace' that pairing refused every
     * admin, HR and payroll user in the tenant against a deadline nobody had
     * re-confirmed — the same shape of outage as the created_at + 14 days
     * default this suite was written for.
     */
    public function test_a_deadline_left_behind_without_a_policy_blocks_nobody(): void
    {
        $organization = $this->untouchedOrganization([
            'security' => ['mfa_grace_ends_at' => now()->subYear()->toIso8601String()],
        ]);
        $admin = $this->adminIn($organization);

        $this->assertSame('off', app(MfaService::class)->policyFor($organization));
        $this->assertFalse(app(MfaService::class)->mustEnrolNow($admin));

        $this->actingAs($admin)
            ->getJson('/api/payroll/filings/catalogue')
            ->assertOk();
    }

    // ------------------------------------------------------- monitoring

    public function test_an_untouched_organisation_keeps_capturing_while_it_collects_consent(): void
    {
        $organization = $this->untouchedOrganization();
        $employee = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'employee',
        ]);

        // No notice published and no consent recorded. Refusing here would stop
        // every tracker in every existing tenant the moment this shipped.
        $this->assertSame('grace', app(MonitoringConsentService::class)->policyFor($organization));
        $this->assertTrue(
            app(MonitoringConsentService::class)->isCaptureAllowed($employee, 'screenshot'),
            'An organisation that has not published a notice yet must not have its tracker switched off for it.'
        );
    }

    public function test_monitoring_is_treated_as_on_when_nobody_has_said_otherwise(): void
    {
        // Absent means enabled: monitoring predates the switch, and defaulting
        // it off would silently stop every existing tracker.
        $this->assertTrue(
            app(MonitoringConsentService::class)->monitoringEnabled($this->untouchedOrganization())
        );
    }

    public function test_an_unrecognised_consent_policy_falls_back_to_grace(): void
    {
        $organization = $this->untouchedOrganization(['monitoring' => ['consent_policy' => 'whatever']]);

        $this->assertSame('grace', app(MonitoringConsentService::class)->policyFor($organization));
    }

    // ------------------------------------------------------- break-glass

    public function test_an_untouched_organisation_requires_approval_for_support_access(): void
    {
        // The one default that is deliberately strict: nobody is opted out of
        // the control without choosing to be.
        $this->assertSame(
            'approval_required',
            app(BreakGlassService::class)->policyFor($this->untouchedOrganization())
        );
    }

    public function test_an_unrecognised_break_glass_policy_falls_back_to_requiring_approval(): void
    {
        $organization = $this->untouchedOrganization([
            'security' => ['break_glass_policy' => 'let_them_all_in'],
        ]);

        $this->assertSame('approval_required', app(BreakGlassService::class)->policyFor($organization));
    }

    // ------------------------------------------------------------- people

    public function test_a_user_with_an_unknown_role_holds_no_permissions_and_is_not_privileged(): void
    {
        $organization = $this->untouchedOrganization();

        $stranger = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'consultant_contractor_temp',
        ]);

        $this->assertFalse($stranger->hasPermission('payroll.view'));
        $this->assertFalse($stranger->hasPermission('dashboard.view'));

        // Unknown roles rank below employees, so MFA enforcement must not
        // treat them as privileged either.
        $this->assertFalse(app(MfaService::class)->isPrivileged($stranger));
    }

    /**
     * A null role is impossible, and that is worth pinning rather than
     * guarding against.
     *
     * This test was originally written to check that the policy checks survive
     * `role => null`, and it failed — the column is NOT NULL, so the state
     * cannot exist. That is a better answer than defensive code, so the
     * assertion became the guarantee itself. If someone ever relaxes the
     * column, every `match ($this->role)` in the codebase gains a new branch
     * and this fails to say so.
     */
    public function test_a_role_can_never_be_null_at_the_database_level(): void
    {
        $organization = $this->untouchedOrganization();

        $this->expectException(\Illuminate\Database\QueryException::class);

        User::factory()->create([
            'organization_id' => $organization->id,
            'role' => null,
        ]);
    }

    /**
     * An organisation-less user, which IS possible — a user row whose
     * organization_id is null. The tenant scope fails closed for them by
     * design; nothing here may crash instead.
     */
    public function test_a_user_with_no_organisation_is_handled_rather_than_crashing(): void
    {
        $orphan = User::factory()->create([
            'organization_id' => null,
            'role' => 'employee',
        ]);

        $this->assertIsInt($orphan->getHierarchyLevel());
        $this->assertFalse(app(MfaService::class)->mustEnrolNow($orphan));
        $this->assertSame('off', app(MfaService::class)->policyFor($orphan->organization));

        // No organisation means no monitoring to consent to, and the refusal
        // must be a stated reason rather than an exception.
        $this->assertNotNull(
            app(MonitoringConsentService::class)->refusalReason($orphan, 'screenshot')
        );
    }

    // -------------------------------------------------------------- payroll

    /**
     * Maker-checker's own default. A two-admin organisation that never chose
     * must still be able to pay its people.
     */
    public function test_a_small_untouched_organisation_can_still_run_payroll(): void
    {
        $organization = $this->untouchedOrganization();
        $admin = $this->adminIn($organization);

        $this->actingAs($admin)
            ->getJson('/api/payroll/filings/catalogue')
            ->assertOk();

        $this->assertFalse(
            app(MfaService::class)->mustEnrolNow($admin),
            'Nothing about an unconfigured organisation may stand between it and payroll.'
        );
    }

    /**
     * The property this whole file is defending, stated once directly.
     *
     * Every policy that can refuse a request must, in its unconfigured state,
     * either allow the request or be a control the organisation deliberately
     * opted into. Nothing may fail closed on somebody who never touched it.
     */
    public function test_no_policy_fails_closed_on_an_organisation_that_never_configured_anything(): void
    {
        $organization = $this->untouchedOrganization();
        $admin = $this->adminIn($organization);
        $employee = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'employee',
        ]);

        $refusals = [];

        if (app(MfaService::class)->mustEnrolNow($admin)) {
            $refusals[] = 'MFA blocks the admin';
        }

        foreach (MonitoringConsentService::CAPTURE_TYPES as $type) {
            if (! app(MonitoringConsentService::class)->isCaptureAllowed($employee, $type)) {
                $refusals[] = "monitoring refuses {$type}";
            }
        }

        $this->assertSame(
            [],
            $refusals,
            "An organisation that configured nothing is being refused:\n  ".implode("\n  ", $refusals)
        );
    }
}
