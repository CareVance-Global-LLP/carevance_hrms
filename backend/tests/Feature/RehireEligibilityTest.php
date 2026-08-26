<?php

namespace Tests\Feature;

use App\Models\EmployeeExit;
use App\Models\ExitInterview;
use App\Models\Organization;
use App\Models\User;
use App\Services\Lifecycle\ExitService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * Whether the organisation would take somebody back.
 *
 * The load-bearing rule these cover is that this is the EMPLOYER's decision and
 * `exit_interviews.would_rejoin` is the departing person's, and the two are
 * never allowed to write each other. They are easy to mistake for one column
 * because they read almost the same on screen, but they answer different
 * questions asked of different people, and one of them is collected in
 * confidence on the way out. Wiring them together would let a survey answer
 * decide a hiring policy — in both directions: somebody dismissed for cause can
 * still tick "yes, I'd come back", and somebody the organisation would rehire
 * tomorrow may leave angry and tick "no".
 */
class RehireEligibilityTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $hr;
    private User $manager;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'Org', 'slug' => 'org-rehire']);
        $this->admin = $this->member('admin', 'rehire-admin@example.com');
        $this->hr = $this->member('hr', 'rehire-hr@example.com');
        $this->manager = $this->member('manager', 'rehire-manager@example.com');
        $this->employee = $this->member('employee', 'rehire-employee@example.com');
    }

    private function member(string $role, string $email, ?Organization $organization = null): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => ($organization ?? $this->organization)->id,
        ]);
    }

    private function exits(): ExitService
    {
        return app(ExitService::class);
    }

    private function openExitFor(User $subject, ?User $initiator = null): EmployeeExit
    {
        return $this->exits()->open(
            user: $subject,
            lastWorkingDate: now()->addDays(30),
            initiator: $initiator ?? $this->admin,
        );
    }

    public function test_a_new_exit_starts_undecided_rather_than_eligible_or_not(): void
    {
        $exit = $this->openExitFor($this->employee);

        // Neither "yes" nor "no" is safe as a default: one rehires people
        // nobody agreed to rehire, the other blacklists everybody who leaves.
        $this->assertSame(EmployeeExit::REHIRE_UNDECIDED, $exit->rehire_eligibility);
        $this->assertNull($exit->rehire_decided_by);
        $this->assertNull($exit->rehire_decided_at);
    }

    public function test_hr_can_record_that_somebody_is_eligible_for_rehire(): void
    {
        $exit = $this->openExitFor($this->employee);

        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'eligible', 'note' => 'Strong performer, left for a masters.'],
            $this->apiHeadersFor($this->hr)
        )
            ->assertOk()
            ->assertJsonPath('data.rehire_eligibility', EmployeeExit::REHIRE_ELIGIBLE);

        $fresh = $exit->fresh();
        $this->assertSame(EmployeeExit::REHIRE_ELIGIBLE, $fresh->rehire_eligibility);
        $this->assertSame('Strong performer, left for a masters.', $fresh->rehire_note);
    }

    public function test_hr_can_record_that_somebody_is_not_eligible_for_rehire(): void
    {
        $exit = $this->openExitFor($this->employee);

        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'not_eligible', 'note' => 'Dismissed for cause.'],
            $this->apiHeadersFor($this->hr)
        )->assertOk();

        $this->assertSame(EmployeeExit::REHIRE_NOT_ELIGIBLE, $exit->fresh()->rehire_eligibility);
    }

    public function test_the_decision_records_who_took_it_and_when(): void
    {
        $exit = $this->openExitFor($this->employee);

        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'not_eligible'],
            $this->apiHeadersFor($this->hr)
        )->assertOk();

        $fresh = $exit->fresh();

        // "Not eligible for rehire" is a statement about a person that follows
        // them; an unattributed one is not answerable years later.
        $this->assertSame($this->hr->id, $fresh->rehire_decided_by);
        $this->assertNotNull($fresh->rehire_decided_at);
        $this->assertTrue($fresh->rehire_decided_at->isToday());
    }

    public function test_an_unknown_rehire_decision_is_refused(): void
    {
        $exit = $this->openExitFor($this->employee);

        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'blacklisted'],
            $this->apiHeadersFor($this->hr)
        )
            ->assertStatus(422)
            ->assertJsonValidationErrors('rehire_eligibility');

        $this->assertSame(EmployeeExit::REHIRE_UNDECIDED, $exit->fresh()->rehire_eligibility);
    }

    public function test_a_line_manager_cannot_record_a_rehire_decision(): void
    {
        $exit = $this->openExitFor($this->employee);

        // Whether the organisation would take somebody back is not the call of
        // the manager they were leaving.
        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'not_eligible'],
            $this->apiHeadersFor($this->manager)
        )->assertStatus(403);

        $this->assertSame(EmployeeExit::REHIRE_UNDECIDED, $exit->fresh()->rehire_eligibility);
    }

    public function test_an_employee_cannot_record_their_own_rehire_decision(): void
    {
        $exit = $this->openExitFor($this->employee);

        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'eligible'],
            $this->apiHeadersFor($this->employee)
        )->assertStatus(403);

        $this->assertSame(EmployeeExit::REHIRE_UNDECIDED, $exit->fresh()->rehire_eligibility);
    }

    public function test_another_tenants_exit_is_not_reachable(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'org-rehire-other']);
        $theirEmployee = $this->member('employee', 'other-employee@example.com', $other);
        $theirAdmin = $this->member('admin', 'other-admin@example.com', $other);

        $theirExit = $this->openExitFor($theirEmployee, $theirAdmin);

        // 404, not 403: BelongsToOrganization scopes the lookup away entirely,
        // so this tenant is never told the row exists.
        $this->postJson(
            "/api/exits/{$theirExit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'not_eligible'],
            $this->apiHeadersFor($this->hr)
        )->assertStatus(404);

        $this->assertSame(EmployeeExit::REHIRE_UNDECIDED, $theirExit->fresh()->rehire_eligibility);
    }

    public function test_the_leavers_own_would_rejoin_answer_does_not_set_the_employers_decision(): void
    {
        $exit = $this->openExitFor($this->employee);

        // The person leaving fills in their own exit interview and says they
        // would come back.
        $this->postJson(
            "/api/exits/{$exit->id}/interview",
            [
                'primary_reason' => 'higher_studies',
                'would_rejoin' => true,
                'comments' => 'Would love to return after my masters.',
            ],
            $this->apiHeadersFor($this->employee)
        )->assertOk();

        $this->assertTrue(
            (bool) ExitInterview::where('employee_exit_id', $exit->id)->value('would_rejoin')
        );

        // Their answer is theirs. It must not have decided anything for the
        // employer — the rehire gate is still untouched.
        $fresh = $exit->fresh();
        $this->assertSame(EmployeeExit::REHIRE_UNDECIDED, $fresh->rehire_eligibility);
        $this->assertNull($fresh->rehire_decided_by);
        $this->assertNull($fresh->rehire_decided_at);
    }

    public function test_the_two_answers_can_disagree_and_both_survive(): void
    {
        $exit = $this->openExitFor($this->employee);

        $this->postJson(
            "/api/exits/{$exit->id}/interview",
            ['would_rejoin' => true],
            $this->apiHeadersFor($this->employee)
        )->assertOk();

        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'not_eligible', 'note' => 'Dismissed for cause.'],
            $this->apiHeadersFor($this->hr)
        )->assertOk();

        // The common real case: somebody dismissed for cause who still says
        // they would return. Collapsing the two columns loses the refusal.
        $this->assertTrue(
            (bool) ExitInterview::where('employee_exit_id', $exit->id)->value('would_rejoin')
        );
        $this->assertSame(EmployeeExit::REHIRE_NOT_ELIGIBLE, $exit->fresh()->rehire_eligibility);
    }

    public function test_recording_a_rehire_decision_writes_an_employee_exit_updated_audit_row(): void
    {
        $exit = $this->openExitFor($this->employee);

        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'not_eligible'],
            $this->apiHeadersFor($this->hr)
        )->assertOk();

        $this->assertDatabaseHas('audit_logs', [
            'action' => 'employee_exit.updated',
            'target_type' => 'EmployeeExit',
            'target_id' => $exit->id,
            'actor_user_id' => $this->hr->id,
        ]);
    }

    public function test_re_recording_the_decision_overwrites_it_and_re_stamps_the_decider(): void
    {
        $exit = $this->openExitFor($this->employee);

        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'not_eligible', 'note' => 'Attendance.'],
            $this->apiHeadersFor($this->hr)
        )->assertOk();

        $this->postJson(
            "/api/exits/{$exit->id}/rehire-eligibility",
            ['rehire_eligibility' => 'eligible'],
            $this->apiHeadersFor($this->admin)
        )->assertOk();

        $fresh = $exit->fresh();
        $this->assertSame(EmployeeExit::REHIRE_ELIGIBLE, $fresh->rehire_eligibility);
        $this->assertSame($this->admin->id, $fresh->rehire_decided_by);
        // The old note belonged to the old decision; leaving it would read as
        // the reason for the new one.
        $this->assertNull($fresh->rehire_note);
    }
}
