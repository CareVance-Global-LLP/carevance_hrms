<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Billing\SeatGuard;
use App\Services\Billing\WorkspaceBillingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A quote prices the people who still hold access, and nobody else.
 *
 * Releasing a seat on the last working day (see SeatReleasedOnExitTest) was
 * paired with a second count, `billableHeadcount()` — every row the
 * organization had ever had — so that no invoice moved when the release
 * landed. Every price read it: the seat floor in `upgradePlan`, both the
 * full-payment and the prorated-upgrade amounts, and `suggested_seats`, which
 * the checkout page prefills into the seat box and posts straight back.
 *
 * Held against a real workspace it charged for people who had left. A trial
 * with five active employees and thirty deactivated two years ago was quoted
 *
 *     max(requested 5, floor 5, ever-existed 35) = 35 seats
 *     3999 x 35 = Rs.139,965   instead of   3999 x 5 = Rs.19,995
 *
 * and `confirmUpgrade` then wrote `max_seats = 35`, so the renewal recurred at
 * that level for ever. Charging for people who left is an overcharge; the seat
 * release exists precisely so that a workspace stops paying for them, and a
 * release that relaxes the cap but not the bill has done the half that costs
 * nothing.
 *
 * Two things made it worse than the behaviour it was preserving. The billing
 * page used to show 35 too, so the number was at least visible; after the
 * release it read "5 of 10" and 35 appeared nowhere on any screen. And
 * `UserController::destroy` now refuses to delete somebody with real history,
 * so the figure could never come down again either.
 *
 * Hence the rule this file exists to hold: THE QUOTE AND THE BILLING PAGE
 * REPORT THE SAME NUMBER. That is what makes a price checkable by the customer
 * who pays it — an invoice they can reconcile against the meter in front of
 * them, rather than one they have to take on trust.
 *
 * What survives is the plan's commercial floor. `upgradePlan` floors at 5 seats
 * for a converting trial and 10 for everyone else, and a workspace that has
 * emptied out is still quoted the floor. Only the ever-existed headcount is
 * gone.
 */
class SeatBillingPricesActiveStaffTest extends TestCase
{
    use RefreshDatabase;

    /** basic_payroll, config/carevance.php. The Rs.3,999 in the story above. */
    private const BASIC_PAYROLL_MONTHLY = 3999;

    /** professional_payroll. The prorated branch charges the difference. */
    private const PROFESSIONAL_PAYROLL_MONTHLY = 5999;

    private function makeOrganization(array $attributes = []): Organization
    {
        return Organization::create(array_merge([
            'name' => 'Churny',
            'slug' => 'churny-'.uniqid(),
            'plan_code' => 'basic_payroll',
            'billing_cycle' => 'monthly',
            'subscription_status' => 'trial',
            'subscription_intent' => 'trial',
            'max_seats' => 10,
            // Left unset on purpose: `suggestedSeats()` would otherwise floor on
            // the headcount band, which is a different lever and would mask
            // whichever seat count these tests are actually measuring.
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

    /**
     * People who left. `deactivated_at` is what `ExitService::revokeAccess`
     * stamps and it is not fillable — stamped, never posted — so this
     * force-fills it the way the exit path does. Dated two years back: these
     * are not this cycle's leavers, they are history.
     */
    private function addLeavers(Organization $organization, int $count): void
    {
        foreach ($this->addUsers($organization, $count) as $leaver) {
            $leaver->forceFill([
                'deactivated_at' => now()->subYears(2),
                'deactivation_reason' => 'exit',
            ])->save();
        }
    }

    /** @return array{0: int, 1: array<string, mixed>} amount and proration details */
    private function quote(User $admin, array $payload = []): array
    {
        $response = $this->actingAs($admin)->postJson('/api/billing/upgrade', array_merge([
            'target_plan_code' => 'professional_payroll',
            'billing_cycle' => 'monthly',
        ], $payload));

        $response->assertOk();

        return [(int) $response->json('amount'), (array) $response->json('proration_details')];
    }

    /* ── the defect ────────────────────────────────────────────── */

    public function test_a_trial_with_thirty_leavers_is_quoted_on_the_five_people_who_are_left(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 10]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 4);
        $this->addLeavers($organization, 30);

        // 35 rows, 5 of them able to sign in. This is the workspace the billing
        // page renders as "used 5 / max 10".
        $this->assertSame(35, $organization->users()->count());
        $this->assertSame(5, app(SeatGuard::class)->usedSeats($organization));

        [$amount, $details] = $this->quote($admin, [
            'target_plan_code' => 'basic_payroll',
            'seats' => 5,
        ]);

        $this->assertSame(5, $details['seats']);
        $this->assertSame(5, $details['used_seats']);
        $this->assertSame(5 * self::BASIC_PAYROLL_MONTHLY, $amount);

        // The number that used to be charged, spelled out so a future change
        // that reintroduces it fails here and names itself.
        $this->assertNotSame(35 * self::BASIC_PAYROLL_MONTHLY, $amount);

        // And what the Razorpay button reads: PaymentPage.tsx posts
        // `pending_upgrade_amount` verbatim, so the overcharge lived here.
        $organization->refresh();
        $this->assertSame(5, (int) $organization->pending_seats);
        $this->assertSame(5 * self::BASIC_PAYROLL_MONTHLY, (int) $organization->pending_upgrade_amount);
    }

    /* ── no regression for the common case ─────────────────────── */

    public function test_a_workspace_with_no_leavers_is_quoted_exactly_as_before(): void
    {
        // The overwhelming majority of workspaces. Nobody has ever left, so the
        // two counts were equal and this change must be invisible: same seats,
        // same amount, to the rupee.
        $organization = $this->makeOrganization(['max_seats' => 10]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 7);

        $this->assertSame(8, $organization->users()->count());
        $this->assertSame(8, app(SeatGuard::class)->usedSeats($organization));

        [$amount, $details] = $this->quote($admin, [
            'target_plan_code' => 'basic_payroll',
            'seats' => 8,
        ]);

        $this->assertSame(8, $details['seats']);
        $this->assertSame(8, $details['used_seats']);
        $this->assertSame(8 * self::BASIC_PAYROLL_MONTHLY, $amount);
    }

    /* ── the floor that stays ──────────────────────────────────── */

    public function test_the_converting_trial_floor_of_five_seats_is_not_undercut(): void
    {
        // Two people left in a workspace that once had thirty-two. The leavers
        // no longer raise the price; the plan's commercial floor still stops it
        // falling below five, and that floor is deliberately untouched.
        $organization = $this->makeOrganization(['max_seats' => 10]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 1);
        $this->addLeavers($organization, 30);

        [$amount, $details] = $this->quote($admin, [
            'target_plan_code' => 'basic_payroll',
            'seats' => 1,
        ]);

        $this->assertSame(5, $details['seats']);
        $this->assertSame(2, $details['used_seats']);
        $this->assertSame(5 * self::BASIC_PAYROLL_MONTHLY, $amount);
    }

    public function test_the_paid_floor_of_ten_seats_is_not_undercut(): void
    {
        // Not a trial, so the floor is ten rather than five. Same shape: asking
        // for one seat in a two-person workspace buys ten.
        //
        // `max_seats` is 5 rather than 40 so that the PLAN floor is what binds
        // here. A paid workspace's own cap is now a floor too — an upgrade
        // quote may raise a cap and may never lower one, because
        // `confirmUpgrade` writes the quote straight into `max_seats` and this
        // was therefore a free, immediate seat reduction that skipped
        // `reduce-seats` and its rules entirely. See
        // SeatQuoteCannotShrinkTheCapTest. With 40 here the assertion below
        // would be asserting that reduction still works.
        $organization = $this->makeOrganization([
            'max_seats' => 5,
            'subscription_status' => 'active',
            'subscription_intent' => 'paid',
            'subscription_expires_at' => now()->addMonth(),
        ]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 1);
        $this->addLeavers($organization, 30);

        [, $details] = $this->quote($admin, ['seats' => 1]);

        $this->assertSame(10, $details['seats']);
        $this->assertSame(2, $details['used_seats']);
    }

    public function test_the_seat_cap_floor_still_reads_the_plan_before_the_headcount(): void
    {
        // SeatGuard's own floor — what `reduceSeats` refuses below — is the
        // plan's minimum or the people in the workspace, whichever is higher.
        // Only the ever-existed headcount was removed; this max() is intact.
        $organization = $this->makeOrganization([
            'plan_code' => 'basic_payroll',
            'subscription_status' => 'active',
        ]);
        $this->addUsers($organization, 3);
        $this->addLeavers($organization, 30);

        // 50 is the payroll-plan floor, and it outranks the three people here.
        $this->assertSame(50, app(SeatGuard::class)->minimumAllowedSeats($organization));
    }

    /* ── both pricing branches agree ───────────────────────────── */

    public function test_the_prorated_upgrade_branch_prices_the_same_active_number(): void
    {
        // Identical populations, two different code paths through upgradePlan:
        // a converting trial takes the full-payment branch, a live paid plan
        // takes the prorated one. They must agree about how many people are in
        // the workspace, or the same company is two different sizes depending
        // on when it upgrades.
        $trial = $this->makeOrganization(['max_seats' => 20]);
        [$trialAdmin] = $this->addUsers($trial, 1, 'admin');
        $this->addUsers($trial, 11);
        $this->addLeavers($trial, 30);

        // The paid workspace's cap matches its active headcount, so neither
        // the plan floor nor the cap floor moves the number and the two
        // branches are being compared on the population alone. A larger cap
        // here would be a floor on the prorated branch — see
        // SeatQuoteCannotShrinkTheCapTest for why that floor exists.
        $paid = $this->makeOrganization([
            'max_seats' => 12,
            'subscription_status' => 'active',
            'subscription_intent' => 'paid',
            'subscription_expires_at' => now()->addMonth(),
        ]);
        [$paidAdmin] = $this->addUsers($paid, 1, 'admin');
        $this->addUsers($paid, 11);
        $this->addLeavers($paid, 30);

        [$fullAmount, $fullDetails] = $this->quote($trialAdmin, ['seats' => 12]);
        [$proratedAmount, $proratedDetails] = $this->quote($paidAdmin, ['seats' => 12]);

        $this->assertSame('full_payment', $fullDetails['type']);
        $this->assertSame('prorated_upgrade', $proratedDetails['type']);

        // The same twelve people, counted the same way on both paths.
        $this->assertSame(12, $fullDetails['seats']);
        $this->assertSame(12, $proratedDetails['seats']);
        $this->assertSame($fullDetails['used_seats'], $proratedDetails['used_seats']);
        $this->assertSame(12, $proratedDetails['used_seats']);

        // The amounts differ because proration charges only the difference —
        // that is the branch doing its job. What must not differ is the seat
        // count underneath, so both are priced off twelve.
        $this->assertSame(12 * self::PROFESSIONAL_PAYROLL_MONTHLY, $fullAmount);
        $this->assertSame(
            12 * (self::PROFESSIONAL_PAYROLL_MONTHLY - self::BASIC_PAYROLL_MONTHLY),
            $proratedAmount
        );

        // Every seat is an existing one: with 12 under a cap of 40 the prorated
        // branch buys nothing new. Priced on 42 it would have charged the
        // difference on 40 and full price on two "new" seats for people who
        // left two years ago.
        $this->assertSame(12, $proratedDetails['existing_seats']);
        $this->assertSame(0, $proratedDetails['new_seats']);
    }

    /* ── the quote and the page agree ──────────────────────────── */

    public function test_the_quote_matches_the_seat_count_the_billing_snapshot_reports(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 10]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 6);
        $this->addLeavers($organization, 30);

        $snapshot = app(WorkspaceBillingService::class)->snapshot($organization->fresh());

        // What the billing page renders.
        $this->assertSame(7, $snapshot['seats']['used']);
        $this->assertSame(7, $snapshot['plan']['used_seats']);
        // What the checkout page prefills into the seat box and posts back.
        $this->assertSame(7, $snapshot['company_profile']['suggested_seats']);
        // And nothing beside them carrying a second, higher number.
        $this->assertArrayNotHasKey('billable', $snapshot['seats']);

        [$amount, $details] = $this->quote($admin, [
            'target_plan_code' => 'basic_payroll',
            'seats' => $snapshot['company_profile']['suggested_seats'],
        ]);

        // The invoice is arithmetic the customer can do from the page in front
        // of them. That they disagreed was half the defect.
        $this->assertSame($snapshot['seats']['used'], $details['used_seats']);
        $this->assertSame($snapshot['seats']['used'], $details['seats']);
        $this->assertSame($snapshot['seats']['used'] * self::BASIC_PAYROLL_MONTHLY, $amount);
    }

    /* ── and the renewal recurs at what was quoted ─────────────── */

    public function test_confirm_upgrade_writes_the_seat_count_that_was_quoted(): void
    {
        // `max_seats` is what the next renewal is priced on, so a quote that
        // was right once but confirmed at a different number would overcharge
        // every month afterwards instead of only at conversion.
        $organization = $this->makeOrganization(['max_seats' => 10]);
        [$admin] = $this->addUsers($organization, 1, 'admin');
        $this->addUsers($organization, 4);
        $this->addLeavers($organization, 30);

        [$amount, $details] = $this->quote($admin, [
            'target_plan_code' => 'basic_payroll',
            'seats' => 5,
        ]);

        $this->assertSame(5, $details['seats']);
        $this->assertSame(5 * self::BASIC_PAYROLL_MONTHLY, $amount);

        $this->actingAs($admin)
            ->postJson('/api/billing/confirm-upgrade')
            ->assertOk();

        $organization->refresh();

        $this->assertSame(5, (int) $organization->max_seats);
        $this->assertSame('basic_payroll', $organization->plan_code);
        $this->assertNull($organization->pending_seats);
        $this->assertNull($organization->pending_upgrade_amount);

        // Still true after the fact: the cap the workspace now renews at is the
        // seat count its own billing page shows.
        $this->assertSame(
            app(SeatGuard::class)->usedSeats($organization),
            (int) $organization->max_seats
        );
    }
}
