<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use App\Services\Billing\SeatGuard;
use App\Services\Billing\SubscriptionCycleService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

/**
 * The renewal cycle and the seat cap.
 *
 * Both were unenforced before this: a paid plan past its date kept full access
 * because only trials were ever expired, and `max_seats` was never consulted
 * before creating a user.
 */
class SubscriptionCycleTest extends TestCase
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

    private function cycles(): SubscriptionCycleService
    {
        return app(SubscriptionCycleService::class);
    }

    private function seats(): SeatGuard
    {
        return app(SeatGuard::class);
    }

    public function test_active_plan_before_renewal_stays_active(): void
    {
        Carbon::setTestNow('2026-08-10');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);

        $this->assertSame('active', $this->cycles()->resolveState($organization));
        $this->assertSame(9, $this->cycles()->daysRemaining($organization));
        $this->assertFalse($this->cycles()->isReadOnly($organization));
    }

    public function test_paid_plan_past_renewal_becomes_past_due_not_expired(): void
    {
        Carbon::setTestNow('2026-08-22');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);

        $this->assertSame('past_due', $this->cycles()->resolveState($organization));
        // Grace keeps access unchanged; that is the point of it.
        $this->assertFalse($this->cycles()->isReadOnly($organization));
    }

    public function test_paid_plan_past_grace_expires(): void
    {
        Carbon::setTestNow('2026-08-27');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);

        $this->assertSame('expired', $this->cycles()->resolveState($organization));
        $this->assertTrue($this->cycles()->isReadOnly($organization));
    }

    public function test_reconcile_writes_the_resolved_state_and_grace_date(): void
    {
        Carbon::setTestNow('2026-08-22');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);

        $this->assertTrue($this->cycles()->reconcile($organization));

        $organization->refresh();
        $this->assertSame('past_due', $organization->subscription_status);
        $this->assertSame('2026-08-26', $organization->grace_ends_at?->toDateString());

        // Idempotent: a second run changes nothing.
        $this->assertFalse($this->cycles()->reconcile($organization));
    }

    public function test_cancelled_workspace_is_not_resurrected_by_a_future_date(): void
    {
        Carbon::setTestNow('2026-08-10');
        $organization = $this->makeOrganization([
            'subscription_status' => 'cancelled',
            'subscription_expires_at' => '2026-12-31',
        ]);

        $this->assertSame('cancelled', $this->cycles()->resolveState($organization));
    }

    public function test_renewal_measures_from_the_previous_end_not_from_today(): void
    {
        // Paying three days late must not cost three days.
        Carbon::setTestNow('2026-08-22');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);

        $this->cycles()->markRenewed($organization);
        $organization->refresh();

        $this->assertSame('2026-09-19', $organization->subscription_expires_at?->toDateString());
        $this->assertSame('active', $organization->subscription_status);
        $this->assertNull($organization->grace_ends_at);
    }

    public function test_renewal_after_a_long_lapse_anchors_to_today(): void
    {
        // Months of unpaid time cannot be handed back as credit.
        Carbon::setTestNow('2026-08-22');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-01-19']);

        $this->cycles()->markRenewed($organization);
        $organization->refresh();

        $this->assertSame('2026-09-22', $organization->subscription_expires_at?->toDateString());
    }

    public function test_reminder_stages_fire_once_each_per_cycle(): void
    {
        Carbon::setTestNow('2026-08-12');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);

        $this->assertSame(7, $this->cycles()->dueReminderStage($organization));

        $this->cycles()->markReminderSent($organization, 7);
        $organization->refresh();
        $this->assertNull($this->cycles()->dueReminderStage($organization));

        Carbon::setTestNow('2026-08-16');
        $this->assertSame(3, $this->cycles()->dueReminderStage($organization));

        $this->cycles()->markReminderSent($organization, 3);
        $organization->refresh();

        Carbon::setTestNow('2026-08-18');
        $this->assertSame(1, $this->cycles()->dueReminderStage($organization));
    }

    public function test_no_reminder_once_the_date_has_passed(): void
    {
        Carbon::setTestNow('2026-08-20');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);

        $this->assertNull($this->cycles()->dueReminderStage($organization));
    }

    public function test_renewal_clears_reminder_state_so_the_next_cycle_warns_again(): void
    {
        Carbon::setTestNow('2026-08-12');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);
        $this->cycles()->markReminderSent($organization, 7);

        $this->cycles()->markRenewed($organization);
        $organization->refresh();

        $this->assertNull($organization->renewal_reminder_stage);
        $this->assertNull($organization->renewal_reminder_for);

        Carbon::setTestNow('2026-09-13');
        $this->assertSame(7, $this->cycles()->dueReminderStage($organization));
    }

    public function test_roll_cycle_command_transitions_every_organization(): void
    {
        Carbon::setTestNow('2026-08-27');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);

        $this->artisan('billing:roll-cycle', ['--skip-reminders' => true])->assertSuccessful();

        $organization->refresh();
        $this->assertSame('expired', $organization->subscription_status);
    }

    public function test_dry_run_changes_nothing(): void
    {
        Carbon::setTestNow('2026-08-27');
        $organization = $this->makeOrganization(['subscription_expires_at' => '2026-08-19']);

        $this->artisan('billing:roll-cycle', ['--dry-run' => true, '--skip-reminders' => true])->assertSuccessful();

        $organization->refresh();
        $this->assertSame('active', $organization->subscription_status);
    }

    // ---- seats --------------------------------------------------------------

    private function addUsers(Organization $organization, int $count): void
    {
        for ($i = 0; $i < $count; $i++) {
            User::create([
                'name' => "User {$i}",
                'email' => "user{$i}-".uniqid()."@example.test",
                'password' => 'password',
                'role' => 'employee',
                'organization_id' => $organization->id,
            ]);
        }
    }

    public function test_seat_guard_allows_up_to_the_cap(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 3]);
        $this->addUsers($organization, 2);

        $this->assertTrue($this->seats()->canAdd($organization));
        $this->seats()->assertCanAdd($organization);

        $this->addUsers($organization, 1);
        $this->assertFalse($this->seats()->canAdd($organization));
    }

    public function test_seat_guard_refuses_past_the_cap(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 2]);
        $this->addUsers($organization, 2);

        $this->expectException(HttpException::class);
        $this->seats()->assertCanAdd($organization);
    }

    public function test_an_unset_cap_does_not_lock_anybody_out(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 0]);
        $this->addUsers($organization, 4);

        $this->assertTrue($this->seats()->canAdd($organization));
    }

    public function test_seat_summary_reports_being_over_cap(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 5]);
        $this->addUsers($organization, 8);

        $summary = $this->seats()->summary($organization);

        $this->assertSame(8, $summary['used']);
        $this->assertSame(5, $summary['max']);
        $this->assertTrue($summary['is_over_cap']);
        $this->assertSame(3, $summary['over_by']);
        // The floor can never sit below the people already in the workspace.
        $this->assertGreaterThanOrEqual(8, $summary['min_allowed']);
    }

    public function test_minimum_allowed_seats_never_drops_below_usage(): void
    {
        $organization = $this->makeOrganization(['max_seats' => 100]);
        $this->addUsers($organization, 42);

        $this->assertSame(42, $this->seats()->minimumAllowedSeats($organization));
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }
}
