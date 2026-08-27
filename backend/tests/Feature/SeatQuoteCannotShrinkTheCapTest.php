<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Billing\SeatGuard;
use App\Services\Lifecycle\ExitService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Changing plan is not a way to reduce seats, and paying is not a way to
 * escape the ones you have.
 *
 * `POST /billing/upgrade` quotes a seat number and `POST /billing/confirm-
 * upgrade` writes it straight into `max_seats`, so the quote path IS a write
 * path for the cap. Two things followed from that and both cost money:
 *
 *  1. The quote floored at a hardcoded 5/10 and never at the workspace's own
 *     cap, so a 40-seat payroll customer could post `{target_plan_code: <its
 *     own plan>, seats: 10}`, be quoted ₹0 — same plan, so the per-user
 *     difference is zero — confirm, and drop to a 10-seat cap mid-cycle for
 *     nothing. `renewal_amount` fell from ₹159,960 to ₹39,990 immediately,
 *     while `POST /billing/reduce-seats` refused the identical number and
 *     promised "next billing cycle, no refund". Pricing on active staff made
 *     this much wider: the ever-existed headcount had been accidentally
 *     holding the floor up on any workspace with churn.
 *
 *  2. `confirmUpgrade` wrote the quoted number without re-reading the
 *     headcount, and `SeatGuard::assertCanAdd` — which `ExitService::rejoin`,
 *     `ScimProvisioningService::reactivate` and `InvitationService` all call —
 *     checked the cap still in force. So people admitted between quote and
 *     payment fitted, and the workspace landed permanently above its new cap.
 *     Enforcement is forward-only by design, so it never had to buy the
 *     difference.
 *
 * The rule: an upgrade may raise a cap and may never lower one, and no cap is
 * ever written below the people who hold access.
 */
class SeatQuoteCannotShrinkTheCapTest extends TestCase
{
    use RefreshDatabase;

    private const BASIC_PAYROLL_MONTHLY = 3999;

    private const PROFESSIONAL_PAYROLL_MONTHLY = 5999;

    private function makeOrganization(array $attributes = []): Organization
    {
        return Organization::create(array_merge([
            'name' => 'Churny',
            'slug' => 'churny-'.uniqid(),
            'plan_code' => 'basic_payroll',
            'billing_cycle' => 'monthly',
            'subscription_status' => 'active',
            'subscription_intent' => 'paid',
            'max_seats' => 40,
            'size' => null,
        ], $attributes));
    }

    /** @return array<int, User> */
    private function addUsers(Organization $organization, int $count, string $role = 'employee'): array
    {
        $created = [];

        for ($i = 0; $i < $count; $i++) {
            $created[] = User::create([
                'name' => "User {$i}",
                'email' => 'user'.$i.'-'.uniqid().'@example.test',
                'password' => 'password',
                'role' => $role,
                'organization_id' => $organization->id,
            ]);
        }

        return $created;
    }

    /** @return array<int, User> */
    private function addLeavers(Organization $organization, int $count): array
    {
        $leavers = $this->addUsers($organization, $count);

        foreach ($leavers as $leaver) {
            $leaver->forceFill([
                'deactivated_at' => now()->subYears(2),
                'deactivation_reason' => 'exit',
            ])->save();
        }

        return $leavers;
    }

    /* ── 1. the free, immediate cap reduction ──────────────────── */

    public function test_an_upgrade_quote_cannot_be_used_to_shrink_the_seat_cap(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 40]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 2);
        $this->addLeavers($organization, 30);

        $this->assertSame(3, app(SeatGuard::class)->usedSeats($organization));

        // reduce-seats, the endpoint whose job this is, refuses.
        $this->actingAs($admin)
            ->postJson('/api/billing/reduce-seats', ['seats' => 10])
            ->assertStatus(422);

        // The same reduction dressed as a plan change must not succeed either.
        $quote = $this->actingAs($admin)->postJson('/api/billing/upgrade', [
            'target_plan_code' => 'basic_payroll',
            'billing_cycle' => 'monthly',
            'seats' => 10,
        ])->assertOk();

        $this->assertSame(40, (int) $quote->json('proration_details.seats'));
        $this->assertSame(3, (int) $quote->json('proration_details.used_seats'));

        $this->actingAs($admin)->postJson('/api/billing/confirm-upgrade')->assertOk();

        $organization->refresh();
        $this->assertSame(40, (int) $organization->max_seats);
    }

    public function test_a_genuine_upgrade_still_prices_the_seats_the_workspace_holds(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 40]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 11);

        $quote = $this->actingAs($admin)->postJson('/api/billing/upgrade', [
            'target_plan_code' => 'professional_payroll',
            'billing_cycle' => 'monthly',
            'seats' => 12,
        ])->assertOk();

        // The cap is the floor, so the difference is charged on all 40 seats
        // the workspace is paying for — not on the 12 it asked to be quoted.
        $expected = (self::PROFESSIONAL_PAYROLL_MONTHLY - self::BASIC_PAYROLL_MONTHLY) * 40;

        $this->assertSame(40, (int) $quote->json('proration_details.seats'));
        $this->assertSame($expected, (int) $quote->json('amount'));
    }

    public function test_a_converting_trial_is_still_quoted_on_its_active_staff_not_on_the_trial_cap(): void
    {
        // The trial cap is not an entitlement anybody paid for, so it is
        // deliberately NOT a floor: flooring there would sell a company of
        // forty a five-seat plan, and this branch exists to stop that.
        $organization = $this->makeOrganization([
            'subscription_status' => 'trial',
            'subscription_intent' => 'trial',
            'max_seats' => 5,
        ]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 4);
        $this->addLeavers($organization, 30);

        $quote = $this->actingAs($admin)->postJson('/api/billing/upgrade', [
            'target_plan_code' => 'basic_payroll',
            'billing_cycle' => 'monthly',
            'seats' => 5,
        ])->assertOk();

        $this->assertSame(5, (int) $quote->json('proration_details.seats'));
        $this->assertSame(self::BASIC_PAYROLL_MONTHLY * 5, (int) $quote->json('amount'));
    }

    /* ── 2. the headcount that moved between quote and payment ── */

    public function test_a_rejoin_between_quote_and_payment_never_leaves_the_workspace_over_its_cap(): void
    {
        $organization = $this->makeOrganization([
            'subscription_status' => 'trial',
            'subscription_intent' => 'trial',
            'max_seats' => 20,
        ]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 11);
        $leavers = $this->addLeavers($organization, 6);

        $this->actingAs($admin)->postJson('/api/billing/upgrade', [
            'target_plan_code' => 'professional_payroll',
            'billing_cycle' => 'monthly',
            'seats' => 12,
        ])->assertOk();

        $organization->refresh();
        $this->assertSame(12, (int) $organization->pending_seats);

        // Six people come back before the payment clears. Each one passes
        // through the same seat guard a rejoin, a SCIM reactivation and an
        // accepted invitation use.
        foreach ($leavers as $leaver) {
            $leaver->forceFill(['deactivated_at' => null, 'deactivation_reason' => null])->save();
        }

        $this->actingAs($admin)->postJson('/api/billing/confirm-upgrade')->assertOk();

        $organization->refresh();
        $guard = app(SeatGuard::class);

        $this->assertSame(18, $guard->usedSeats($organization));
        $this->assertSame(
            18,
            (int) $organization->max_seats,
            'confirmUpgrade wrote a cap below the people holding access, so the workspace is '
            .'permanently over cap and the renewal recurs on the smaller number.'
        );
        $this->assertFalse($guard->summary($organization)['is_over_cap']);
    }

    public function test_a_pending_reduction_is_the_cap_new_people_are_admitted_against(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 40]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 9);

        $guard = app(SeatGuard::class);
        $this->assertSame(10, $guard->usedSeats($organization));
        $this->assertTrue($guard->canAdd($organization, 5));

        // The workspace has already agreed to shrink to 10 next cycle.
        $organization->forceFill(['subscription_intent' => 'reduce_seats', 'pending_seats' => 10])->save();

        $this->assertSame(10, $guard->admissionCap($organization));
        $this->assertFalse(
            $guard->canAdd($organization, 1),
            'Somebody admitted above the incoming cap stays there for ever — enforcement is '
            .'forward-only, so the workspace never has to buy the seat.'
        );

        // A LARGER pending number is seats being bought, not seats paid for,
        // and must not open the door early.
        $organization->forceFill(['subscription_intent' => 'add_seats', 'pending_seats' => 80])->save();
        $this->assertSame(40, $guard->admissionCap($organization));
        $this->assertTrue($guard->canAdd($organization, 5));
    }

    /**
     * `assertCanAdd` is the exact call `ExitService::rejoin`,
     * `ScimProvisioningService::reactivate` and `InvitationService` make, so
     * the refusal has to arrive there rather than only in `canAdd`.
     */
    public function test_the_refusal_reaches_the_guard_every_admission_path_calls(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 12]);
        $this->addUsers($organization, 10);

        $organization->forceFill(['subscription_intent' => 'reduce_seats', 'pending_seats' => 10])->save();

        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);
        $this->expectExceptionMessage('10 of 10 seats');

        app(SeatGuard::class)->assertCanAdd($organization, 1);
    }
}
