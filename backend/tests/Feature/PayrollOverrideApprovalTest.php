<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\PayrollOverride;
use App\Models\PayrollOverrideAudit;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Who may release an override, and what stopping one does to history.
 *
 * Maker-checker is the point of the status column. Without it the module is a
 * more honest version of what it replaced — annual_ctc and custom_deductions[]
 * were already overridable by one person with no reason, no approver and no
 * record. Adding a workflow that the same person can walk both sides of would
 * be theatre.
 *
 * The cancel rule is the subtler half. An approved open-ended override is
 * CLOSED at today rather than marked cancelled, because cancelling drops it out
 * of scopeInForceFor() for every month — including months already processed and
 * disbursed under it. A recomputed March would then pay a figure March never
 * paid.
 */
class PayrollOverrideApprovalTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $maker;
    private User $checker;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();

        $this->maker = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->checker = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
    }

    private function override(array $attributes = []): PayrollOverride
    {
        return PayrollOverride::create(array_merge([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'scope' => 'component',
            'target' => 'basic',
            'mode' => 'fixed',
            'value' => 45000,
            'balance_mode' => 'preserve_ctc',
            'effective_from' => '2026-06-01',
            'reason' => 'Correcting an understated basic agreed at offer.',
            'status' => PayrollOverride::STATUS_PENDING,
            'created_by' => $this->maker->id,
        ], $attributes));
    }

    private function auditsFor(PayrollOverride $override, string $action): int
    {
        return PayrollOverrideAudit::where('payroll_override_id', $override->id)
            ->where('action', $action)
            ->count();
    }

    #[Test]
    public function another_approver_can_release_a_pending_override(): void
    {
        $override = $this->override();

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(200)
            ->assertJsonPath('data.status', PayrollOverride::STATUS_APPROVED);

        $override->refresh();

        $this->assertSame($this->checker->id, $override->approved_by);
        $this->assertNotNull($override->approved_at);
        $this->assertSame(1, $this->auditsFor($override, PayrollOverrideAudit::ACTION_APPROVED));
    }

    /**
     * The precedent is LoanController: the route is already role-gated, and
     * that still left one person able to raise an exception to pay and release
     * it in the next request.
     */
    #[Test]
    public function the_author_of_an_override_cannot_approve_it(): void
    {
        $override = $this->override();

        $this->actingAs($this->maker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(422)
            ->assertJsonPath('success', false);

        $this->assertSame(PayrollOverride::STATUS_PENDING, $override->fresh()->status);
        $this->assertSame(0, $this->auditsFor($override, PayrollOverrideAudit::ACTION_APPROVED));
    }

    #[Test]
    public function the_author_of_an_override_cannot_reject_it_either(): void
    {
        $override = $this->override();

        $this->actingAs($this->maker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/reject", [
                'note' => 'Withdrawing my own request.',
            ])
            ->assertStatus(422);

        $this->assertSame(PayrollOverride::STATUS_PENDING, $override->fresh()->status);
    }

    #[Test]
    public function an_already_approved_override_cannot_be_approved_again(): void
    {
        $override = $this->override(['status' => PayrollOverride::STATUS_APPROVED]);

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(422);
    }

    /**
     * A rejection without a reason tells the person who raised it nothing they
     * can act on, and leaves the register with a decision no one can explain.
     */
    #[Test]
    public function a_rejection_requires_a_note(): void
    {
        $override = $this->override();

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/reject")
            ->assertStatus(422)
            ->assertJsonValidationErrors('note');

        $this->assertSame(PayrollOverride::STATUS_PENDING, $override->fresh()->status);
    }

    #[Test]
    public function the_rejection_note_lands_on_the_audit_row(): void
    {
        $override = $this->override();

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/reject", [
                'note' => 'The revision letter says 42,000, not 45,000.',
            ])
            ->assertStatus(200)
            ->assertJsonPath('data.status', PayrollOverride::STATUS_REJECTED);

        $audit = PayrollOverrideAudit::where('payroll_override_id', $override->id)
            ->where('action', PayrollOverrideAudit::ACTION_REJECTED)
            ->firstOrFail();

        $this->assertSame('The revision letter says 42,000, not 45,000.', $audit->note);
        $this->assertSame(PayrollOverride::STATUS_PENDING, $audit->before_json['status']);
        $this->assertSame(PayrollOverride::STATUS_REJECTED, $audit->after_json['status']);
    }

    /**
     * The rule that protects already-paid months. Cancelling outright would
     * remove the override from every month's inForceFor(), including ones that
     * have already been processed and disbursed under it.
     *
     * The close lands on the last day of the last CLOSED month, not today.
     * Closing at today would leave the override in force for the remainder of
     * the current month — the month still being processed — so a cancellation
     * would silently still reach the next payslip.
     */
    #[Test]
    public function cancelling_an_approved_open_ended_override_closes_it_at_the_last_closed_month(): void
    {
        Carbon::setTestNow('2026-08-17');

        \App\Models\PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => '2026-07',
            'status' => 'disbursed',
            'created_by' => $this->maker->id,
        ]);

        $override = $this->override([
            'status' => PayrollOverride::STATUS_APPROVED,
            'effective_to' => null,
        ]);

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/cancel")
            ->assertStatus(200);

        $override->refresh();

        $this->assertSame(PayrollOverride::STATUS_APPROVED, $override->status, 'History is not rewritten.');
        $this->assertSame('2026-07-31', $override->effective_to?->toDateString());

        // June was processed under it and still resolves; August onwards does not.
        $this->assertTrue(PayrollOverride::inForceFor('2026-06')->where('id', $override->id)->exists());
        $this->assertFalse(PayrollOverride::inForceFor('2026-08')->where('id', $override->id)->exists());

        Carbon::setTestNow();
    }

    /** With nothing ever closed there is no paid month to protect. */
    #[Test]
    public function cancelling_with_no_closed_run_ends_the_override_yesterday(): void
    {
        Carbon::setTestNow('2026-08-17');

        $override = $this->override(['status' => PayrollOverride::STATUS_APPROVED, 'effective_to' => null]);

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/cancel")
            ->assertStatus(200);

        $this->assertSame('2026-08-16', $override->fresh()->effective_to?->toDateString());

        Carbon::setTestNow();
    }

    /**
     * Self-dealing is about the TARGET and has no exception.
     *
     * Note this is just as much a hole in a large organisation: A raises an
     * override on A's own salary and B rubber-stamps it. Counting approvers
     * does nothing about that; refusing on the target does.
     */
    #[Test]
    public function nobody_may_approve_a_change_to_their_own_pay(): void
    {
        $override = $this->override(['user_id' => $this->checker->id]);

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(422)
            ->assertJsonPath('message', 'You cannot approve a change to your own pay.');

        $this->assertSame(PayrollOverride::STATUS_PENDING, $override->fresh()->status);
    }

    /**
     * The audited exception. An absolute maker-checker in a one-admin
     * organisation does not produce control — it produces a dead feature, and
     * the admin routes the change through annual_ctc instead, where nothing is
     * recorded at all.
     */
    #[Test]
    public function the_sole_payroll_admin_may_approve_their_own_request_and_it_says_so(): void
    {
        // Everyone else demoted, so the maker is the only strict admin left.
        User::where('id', '!=', $this->maker->id)->update(['role' => 'employee']);

        $override = $this->override();

        $this->actingAs($this->maker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(200);

        $this->assertSame(PayrollOverride::STATUS_APPROVED, $override->fresh()->status);

        $audit = PayrollOverrideAudit::where('action', PayrollOverrideAudit::ACTION_APPROVED)->firstOrFail();
        $this->assertSame('self-approved: sole payroll admin', $audit->note);
    }

    /** The exception covers the author rule only — never the target rule. */
    #[Test]
    public function even_a_sole_admin_cannot_approve_their_own_pay(): void
    {
        User::where('id', '!=', $this->maker->id)->update(['role' => 'employee']);

        $override = $this->override(['user_id' => $this->maker->id]);

        $this->actingAs($this->maker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(422);

        $this->assertSame(PayrollOverride::STATUS_PENDING, $override->fresh()->status);
    }

    /**
     * The register's buttons are the server's answer, not the client's guess.
     *
     * The client used to derive this from created_by alone. That was right
     * until the sole-admin exception was added server-side, after which the
     * only payroll admin in an organisation could approve through the API and
     * was shown no button to do it with — a rule with two implementations, one
     * of which was not updated.
     */
    #[Test]
    public function the_sole_admin_is_told_they_may_approve_their_own_request(): void
    {
        User::where('id', '!=', $this->maker->id)->update(['role' => 'employee']);

        $this->override();

        $row = $this->actingAs($this->maker)
            ->getJson('/api/payroll/operations/overrides')
            ->assertStatus(200)
            ->json('data.0');

        $this->assertTrue($row['can_approve']);
        $this->assertStringContainsString('self-approval', $row['decision_blocked_reason']);
    }

    #[Test]
    public function an_author_with_another_admin_present_is_told_to_ask_them(): void
    {
        $this->override();

        $row = $this->actingAs($this->maker)
            ->getJson('/api/payroll/operations/overrides')
            ->assertStatus(200)
            ->json('data.0');

        $this->assertFalse($row['can_approve']);
        $this->assertStringContainsString('Another admin', $row['decision_blocked_reason']);
    }

    /** The target rule shows through to the UI too, with no exception. */
    #[Test]
    public function nobody_is_offered_a_decision_on_their_own_pay(): void
    {
        User::where('id', '!=', $this->maker->id)->update(['role' => 'employee']);

        $this->override(['user_id' => $this->maker->id]);

        $row = $this->actingAs($this->maker)
            ->getJson('/api/payroll/operations/overrides')
            ->assertStatus(200)
            ->json('data.0');

        $this->assertFalse($row['can_approve']);
        $this->assertFalse($row['can_reject']);
        $this->assertStringContainsString('your own pay', $row['decision_blocked_reason']);
    }

    /**
     * The button the register shows and the answer the endpoint gives must be
     * the same answer. This is the test that would have caught the drift.
     */
    #[Test]
    public function every_row_offering_approval_can_actually_be_approved(): void
    {
        User::where('id', '!=', $this->maker->id)->update(['role' => 'employee']);

        $override = $this->override();

        $row = $this->actingAs($this->maker)
            ->getJson('/api/payroll/operations/overrides')
            ->json('data.0');

        $expected = $row['can_approve'] ? 200 : 422;

        $this->actingAs($this->maker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus($expected);
    }

    /** A decided override conflicts with the request; it is not merely invalid. */
    #[Test]
    public function approving_a_rejected_override_is_a_conflict(): void
    {
        $override = $this->override(['status' => PayrollOverride::STATUS_REJECTED]);

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(409);
    }

    #[Test]
    public function approving_a_cancelled_override_is_a_conflict(): void
    {
        $override = $this->override(['status' => PayrollOverride::STATUS_CANCELLED]);

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(409);
    }

    /**
     * The second press must not undo what the first one protected. Closing an
     * open-ended override sets effective_to; cancelling it again would mark it
     * cancelled and drop it out of inForceFor() for the months the close was
     * there to preserve.
     */
    #[Test]
    public function an_override_already_closed_cannot_then_be_cancelled_retroactively(): void
    {
        Carbon::setTestNow('2026-08-17');

        $override = $this->override(['status' => PayrollOverride::STATUS_APPROVED, 'effective_to' => null]);

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/cancel")
            ->assertStatus(200);

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/cancel")
            ->assertStatus(422);

        $override->refresh();

        $this->assertSame(PayrollOverride::STATUS_APPROVED, $override->status);
        $this->assertTrue(PayrollOverride::inForceFor('2026-06')->where('id', $override->id)->exists());

        Carbon::setTestNow();
    }

    #[Test]
    public function cancelling_a_pending_override_marks_it_cancelled(): void
    {
        $override = $this->override();

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/cancel")
            ->assertStatus(200)
            ->assertJsonPath('data.status', PayrollOverride::STATUS_CANCELLED);

        $this->assertNull($override->fresh()->effective_to, 'A pending override has paid nothing to protect.');
    }

    /** Unlike approve and reject, stopping your own request is not a conflict. */
    #[Test]
    public function the_author_may_cancel_their_own_override(): void
    {
        $override = $this->override();

        $this->actingAs($this->maker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/cancel")
            ->assertStatus(200);

        $this->assertSame(PayrollOverride::STATUS_CANCELLED, $override->fresh()->status);
    }

    #[Test]
    public function a_rejected_override_cannot_be_cancelled(): void
    {
        $override = $this->override(['status' => PayrollOverride::STATUS_REJECTED]);

        $this->actingAs($this->checker)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/cancel")
            ->assertStatus(422);
    }

    /**
     * The trail is evidence only if nothing ever rewrites it. Three decisions
     * leave three rows, and the earlier ones still say what they said.
     */
    #[Test]
    public function every_transition_appends_rather_than_replacing(): void
    {
        $override = $this->override();

        $this->actingAs($this->checker)->postJson("/api/payroll/operations/overrides/{$override->id}/approve");
        $this->actingAs($this->checker)->postJson("/api/payroll/operations/overrides/{$override->id}/cancel");

        $actions = PayrollOverrideAudit::where('payroll_override_id', $override->id)
            ->orderBy('id')
            ->pluck('action')
            ->all();

        $this->assertSame([
            PayrollOverrideAudit::ACTION_APPROVED,
            PayrollOverrideAudit::ACTION_CANCELLED,
        ], $actions);

        // The approval row still records the state it approved, not the latest.
        $approval = PayrollOverrideAudit::where('action', PayrollOverrideAudit::ACTION_APPROVED)->firstOrFail();
        $this->assertSame(PayrollOverride::STATUS_PENDING, $approval->before_json['status']);
    }

    /** There is no updated_at to write, which is what keeps the table append-only. */
    #[Test]
    public function the_audit_table_carries_no_updated_at(): void
    {
        $this->assertFalse(
            \Illuminate\Support\Facades\Schema::hasColumn('payroll_override_audits', 'updated_at'),
            'An append-only table must not carry a column that invites an update.',
        );
    }

    #[Test]
    public function an_override_in_another_organisation_is_not_found(): void
    {
        $otherOrg = Organization::factory()->create();
        $stranger = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'admin']);
        $override = $this->override();

        $this->actingAs($stranger)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(404);

        $this->assertSame(PayrollOverride::STATUS_PENDING, $override->fresh()->status);
    }

    #[Test]
    public function an_employee_cannot_approve_an_override(): void
    {
        $override = $this->override();

        $this->actingAs($this->employee)
            ->postJson("/api/payroll/operations/overrides/{$override->id}/approve")
            ->assertStatus(403);
    }
}
