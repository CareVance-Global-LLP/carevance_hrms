<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The workspace setup checklist.
 *
 * Two things are worth holding still: steps derive their own completion from
 * real data (a checklist that only moves when somebody remembers to tick a box
 * reads as permanently unfinished), and the payroll steps appear only on a plan
 * that grants payroll — a Tracker trial seeing six payroll steps it can never
 * finish would be worse than no checklist at all.
 */
class WorkspaceOnboardingTest extends TestCase
{
    use RefreshDatabase;

    private function owner(array $organizationAttributes = [], string $role = 'admin'): array
    {
        $organization = Organization::factory()->create(array_merge([
            'plan_code' => 'basic_tracking',
            'subscription_status' => 'trial',
        ], $organizationAttributes));

        $user = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => $role,
        ]);

        return [$organization, $user];
    }

    public function test_a_fresh_workspace_reports_nothing_done(): void
    {
        [, $owner] = $this->owner();

        $response = $this->actingAs($owner)->getJson('/api/workspace/onboarding-status')->assertOk();

        $this->assertSame(0, $response->json('completed_count'));
        $this->assertFalse($response->json('onboarded'));
        $this->assertFalse($response->json('steps.invite_team'));
        $this->assertFalse($response->json('steps.working_hours'));
        $this->assertSame('complete_profile', $response->json('next_action'));
    }

    public function test_steps_complete_themselves_from_the_underlying_data(): void
    {
        [$organization, $owner] = $this->owner();

        // A second person in the workspace *is* an invited team, whether or not
        // anybody ticked the box.
        User::factory()->create(['organization_id' => $organization->id, 'role' => 'employee']);

        $organization->update([
            'settings' => [
                'attendance' => ['office_start_time' => '09:30:00'],
                'leave_policy' => ['categories' => [['code' => 'paid', 'name' => 'Paid', 'annual_quota' => 21]]],
            ],
        ]);

        $response = $this->actingAs($owner)->getJson('/api/workspace/onboarding-status')->assertOk();

        $this->assertTrue($response->json('steps.invite_team'));
        $this->assertTrue($response->json('steps.working_hours'));
        $this->assertTrue($response->json('steps.leave_policy'));
    }

    public function test_payroll_steps_appear_only_on_a_plan_that_grants_payroll(): void
    {
        [, $trackerOwner] = $this->owner(['plan_code' => 'basic_tracking']);

        $tracker = $this->actingAs($trackerOwner)->getJson('/api/workspace/onboarding-status')->assertOk();
        $this->assertFalse($tracker->json('includes_payroll'));
        $this->assertArrayNotHasKey('payroll_bank', $tracker->json('steps'));

        [, $payrollOwner] = $this->owner(['plan_code' => 'basic_payroll']);

        $payroll = $this->actingAs($payrollOwner)->getJson('/api/workspace/onboarding-status')->assertOk();
        $this->assertTrue($payroll->json('includes_payroll'));
        $this->assertArrayHasKey('payroll_bank', $payroll->json('steps'));
        // Each payroll step deep-links into the setup wizard, which nothing in
        // the app linked to before this checklist existed.
        $this->assertSame('/payroll/setup/pay-schedule', $payroll->json('step_routes.payroll_pay_schedule'));
    }

    public function test_dismissing_and_reopening_the_checklist(): void
    {
        [, $owner] = $this->owner();

        $this->actingAs($owner)->postJson('/api/workspace/onboarding/dismiss')->assertOk();
        $this->assertNotNull(
            $this->actingAs($owner)->getJson('/api/workspace/onboarding-status')->json('dismissed_at')
        );

        $this->actingAs($owner)->postJson('/api/workspace/onboarding/reopen')->assertOk();
        $this->assertNull(
            $this->actingAs($owner)->getJson('/api/workspace/onboarding-status')->json('dismissed_at')
        );
    }

    public function test_the_tour_is_recorded_as_seen_once(): void
    {
        [, $owner] = $this->owner();

        $this->assertNull(
            $this->actingAs($owner)->getJson('/api/workspace/onboarding-status')->json('tour_seen_at')
        );

        $this->actingAs($owner)->postJson('/api/workspace/onboarding/tour-seen')->assertOk();

        $this->assertNotNull(
            $this->actingAs($owner)->getJson('/api/workspace/onboarding-status')->json('tour_seen_at')
        );
    }

    /** Status is readable by any member; every write is an admin decision. */
    public function test_writes_are_admin_only_while_status_is_readable_by_members(): void
    {
        [$organization] = $this->owner();

        $employee = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'employee',
        ]);

        $this->actingAs($employee)->getJson('/api/workspace/onboarding-status')->assertOk();
        $this->actingAs($employee)->postJson('/api/workspace/onboarding/dismiss')->assertForbidden();
        $this->actingAs($employee)->postJson('/api/workspace/onboarding/mark-step', ['step' => 'invite_team'])
            ->assertForbidden();
    }

    public function test_marking_an_unknown_step_is_rejected(): void
    {
        [, $owner] = $this->owner();

        $this->actingAs($owner)
            ->postJson('/api/workspace/onboarding/mark-step', ['step' => 'not_a_step'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['step']);
    }
}
