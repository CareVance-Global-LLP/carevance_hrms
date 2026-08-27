<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Billing\SeatGuard;
use App\Services\Billing\WorkspaceBillingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * A seat is released on the last working day.
 *
 * `SeatGuard::usedSeats()` counted every row on `organizations.users`, and
 * `User` has no SoftDeletes and is deliberately not gaining any — so a leaver
 * held a paid seat for ever. The only way to free one was to DELETE the person,
 * and 108 foreign keys cascade off `users.id`: that destroys their payslips,
 * payroll items, bank transfer lines, attendance and leave ledger, which are
 * exactly the records an inspection asks for. A billing limit was therefore
 * pushing admins into deleting statutory records to be able to hire.
 *
 * The release signal is `deactivated_at`, stamped by `ExitService::revokeAccess`
 * when the nightly `lifecycle:process` sweep runs after the last working day —
 * NOT full-and-final closure, which can be weeks later and is about money, not
 * access. The moment somebody can no longer sign in is the moment they stop
 * occupying a seat.
 *
 * There is exactly one seat count, and this file no longer asserts a second.
 * `billableHeadcount()` — every row the organization had ever had — was added
 * beside `usedSeats()` so that releasing a seat moved no invoice. It is gone:
 * it charged for people who had left, and it did so invisibly, because the
 * billing page showed the active number and nothing on any screen showed the
 * one being billed. Caps, refusals and prices all read `usedSeats()` now. See
 * SeatBillingPricesActiveStaffTest for the pricing half.
 */
class SeatReleasedOnExitTest extends TestCase
{
    use RefreshDatabase;

    private function makeOrganization(array $attributes = []): Organization
    {
        return Organization::create(array_merge([
            'name' => 'CareVance',
            'slug' => 'carevance-'.uniqid(),
            'plan_code' => 'basic_tracking',
            'billing_cycle' => 'monthly',
            'subscription_status' => 'active',
            'subscription_intent' => 'paid',
            'max_seats' => 5,
        ], $attributes));
    }

    private function seats(): SeatGuard
    {
        return app(SeatGuard::class);
    }

    /** @return array<int, User> */
    private function addUsers(Organization $organization, int $count): array
    {
        $created = [];

        for ($i = 0; $i < $count; $i++) {
            $created[] = User::create([
                'name' => "User {$i}",
                'email' => 'user'.$i.'-'.uniqid().'@example.test',
                'password' => 'password',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);
        }

        return $created;
    }

    /**
     * What `ExitService::revokeAccess` writes. `deactivated_at` is not
     * fillable — it is stamped, never posted — so the exit path force-fills it
     * and so does this.
     */
    private function revokeAccess(User $user): void
    {
        $user->forceFill([
            'deactivated_at' => now(),
            'deactivation_reason' => 'exit',
        ])->save();
    }

    public function test_a_deactivated_leaver_does_not_consume_a_seat(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 5]);
        [$leaver] = $this->addUsers($organization, 3);

        $this->assertSame(3, $this->seats()->usedSeats($organization));

        $this->revokeAccess($leaver);

        $this->assertSame(2, $this->seats()->usedSeats($organization));
    }

    public function test_somebody_still_holding_access_does_consume_a_seat(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 5]);
        $this->addUsers($organization, 4);

        // Nobody has left, so nothing about the old behaviour changes: the
        // release is `deactivated_at`, not the passage of time or an exit row.
        $this->assertSame(4, $this->seats()->usedSeats($organization));
    }

    public function test_the_leaver_row_survives_so_the_payroll_record_survives_with_it(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 5]);
        [$leaver] = $this->addUsers($organization, 2);

        $this->revokeAccess($leaver);

        // Freeing the seat must never mean deleting the person. Their payslips,
        // attendance and leave ledger all hang off this id.
        $this->assertNotNull(User::query()->find($leaver->id));
        $this->assertSame(2, $organization->users()->count());
        // ...and the surviving row costs nothing: the seat, and the charge for
        // it, both went with the deactivation.
        $this->assertSame(1, $this->seats()->usedSeats($organization));
    }

    public function test_a_workspace_at_its_cap_admits_a_new_hire_once_somebody_is_deactivated(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 3]);
        [$leaver] = $this->addUsers($organization, 3);

        $this->assertFalse($this->seats()->canAdd($organization));

        $this->revokeAccess($leaver);

        $this->assertTrue($this->seats()->canAdd($organization));
        $this->seats()->assertCanAdd($organization);
    }

    public function test_assert_can_add_still_refuses_when_the_workspace_is_genuinely_full(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 3]);
        [$leaver] = $this->addUsers($organization, 3);
        $this->revokeAccess($leaver);

        // One seat came free and one person took it. The next is refused again,
        // and the message carries the shortfall so the UI can offer to buy one.
        $this->addUsers($organization, 1);

        $this->assertFalse($this->seats()->canAdd($organization));

        try {
            $this->seats()->assertCanAdd($organization);
            $this->fail('A full workspace must refuse the next person.');
        } catch (HttpException $refusal) {
            $this->assertSame(422, $refusal->getStatusCode());
            $this->assertStringContainsString('3 of 3 seats in use', $refusal->getMessage());
        }
    }

    public function test_the_seat_floor_for_reducing_a_cap_drops_when_a_leaver_is_deactivated(): void
    {
        // Above the plan's own 10-seat floor, or the floor would hide the change.
        $organization = $this->makeOrganization(['max_seats' => 30]);
        $people = $this->addUsers($organization, 20);

        $this->assertSame(20, $this->seats()->minimumAllowedSeats($organization));

        foreach (array_slice($people, 0, 6) as $leaver) {
            $this->revokeAccess($leaver);
        }

        // You stop paying for people who left: the cap may now be reduced to 14.
        // This is a recurring-revenue reduction, and it is the intended effect.
        $this->assertSame(14, $this->seats()->minimumAllowedSeats($organization));
    }

    public function test_the_billing_summary_reports_the_same_active_only_number(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 10]);
        $people = $this->addUsers($organization, 8);
        $this->revokeAccess($people[0]);
        $this->revokeAccess($people[1]);

        $summary = $this->seats()->summary($organization);

        $this->assertSame(6, $summary['used']);
        $this->assertSame(10, $summary['max']);
        $this->assertSame(4, $summary['remaining']);
        $this->assertFalse($summary['is_over_cap']);
        $this->assertSame(0, $summary['over_by']);

        // One number, not two. The summary used to carry a second, higher
        // `billable` figure that every price was quoted on; a customer reading
        // "6" and being charged for 8 has no way to check their own invoice.
        $this->assertArrayNotHasKey('billable', $summary);
    }

    public function test_an_over_cap_workspace_comes_back_under_when_leavers_are_deactivated(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 5]);
        $people = $this->addUsers($organization, 8);

        $this->assertTrue($this->seats()->summary($organization)['is_over_cap']);

        foreach (array_slice($people, 0, 3) as $leaver) {
            $this->revokeAccess($leaver);
        }

        $summary = $this->seats()->summary($organization);

        $this->assertSame(5, $summary['used']);
        $this->assertFalse($summary['is_over_cap']);
        $this->assertSame(0, $summary['over_by']);
    }

    public function test_there_is_no_second_headcount_a_price_could_be_quoted_on(): void
    {
        // `billableHeadcount()` counted every row ever and every price read it.
        // The method is deleted rather than left unwired: a helper that exists
        // is a helper somebody wires up, and the only thing it could do is
        // charge for people who have left.
        $this->assertFalse(
            method_exists(SeatGuard::class, 'billableHeadcount'),
            'Seats are priced on people who still hold access. Nothing may count leavers again.'
        );
    }

    public function test_the_conversion_seat_box_is_floored_on_active_people_only(): void
    {
        $organization = $this->makeOrganization([
            'max_seats' => 20,
            'subscription_status' => 'trial',
        ]);
        $people = $this->addUsers($organization, 12);

        foreach (array_slice($people, 0, 5) as $leaver) {
            $this->revokeAccess($leaver);
        }

        $snapshot = app(WorkspaceBillingService::class)->snapshot($organization->fresh());

        // `suggested_seats` prefills the seat box on the checkout page and is
        // posted straight back to be priced, so it has to be a number the
        // customer can also see. It used to be 12 — the five leavers included —
        // while the meter beside it read 7.
        $this->assertSame(7, $snapshot['company_profile']['suggested_seats']);
        $this->assertSame(7, $snapshot['seats']['used']);
    }

    public function test_a_seat_freed_by_an_exit_reduces_what_the_upgrade_quote_charges(): void
    {
        $organization = $this->makeOrganization([
            'max_seats' => 20,
            'subscription_status' => 'trial',
            'subscription_intent' => 'trial',
        ]);
        $people = $this->addUsers($organization, 12);

        $admin = $people[11];
        $admin->forceFill(['role' => 'admin'])->save();

        $before = $this->quoteUpgrade($admin);

        foreach (array_slice($people, 0, 5) as $leaver) {
            $this->revokeAccess($leaver);
        }

        $after = $this->quoteUpgrade($admin);

        // This quote used to be byte-identical, on the reasoning that releasing
        // a seat relaxes a cap without touching a price. That reasoning charges
        // for five people who cannot sign in, so it is reversed deliberately:
        // the workspace is quoted on the seven who are left, and the recurring
        // revenue drops with them. That is what "you stop paying for leavers"
        // costs, and it is the decision.
        $this->assertLessThan($before, $after);
        $this->assertSame(intdiv($before, 12) * 7, $after);
        $this->assertSame(7, (int) $organization->fresh()->pending_seats);
    }

    private function quoteUpgrade(User $actor): int
    {
        $response = $this->actingAs($actor)
            ->postJson('/api/billing/upgrade', [
                'target_plan_code' => 'basic_payroll',
                'billing_cycle' => 'monthly',
            ]);

        $response->assertOk();

        return (int) $response->json('amount');
    }
}
