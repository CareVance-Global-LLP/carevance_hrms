<?php

namespace Tests\Feature;

use App\Models\EmployeeExit;
use App\Models\EmployeeWorkInfo;
use App\Models\Organization;
use App\Models\User;
use App\Services\Billing\SeatGuard;
use App\Services\Lifecycle\ExitService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * Bringing a former employee back.
 *
 * Two facts make this more than flipping a flag back.
 *
 * The first is the clock. Gratuity under the Payment of Gratuity Act needs five
 * years of CONTINUOUS service, and a break in service restarts it — three years
 * served, a gap, and two more is not five. Leave accrual, probation and joining
 * month proration all read the same column, and all of them must describe the
 * CURRENT employment period, so `employee_work_infos.joining_date` is re-based
 * on rejoin. (That column: `users.joining_date` does not exist.) The earlier
 * period would then be gone entirely, which is why it is snapshotted onto the
 * exit first — `previous_joining_date` plus `last_working_date` is the whole of
 * it, and the only surviving record that the person was ever here before.
 *
 * The second is the seat. A leaver releases theirs the moment access is revoked,
 * so coming back claims one exactly as hiring does — otherwise rejoin is the
 * documented way round a cap that hiring, invitations and SCIM all respect.
 */
class RejoinFormerEmployeeTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $manager;
    private User $employee;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create([
            'name' => 'Org',
            'slug' => 'org-rejoin',
            'max_seats' => 20,
        ]);

        $this->admin = $this->member('admin', 'rejoin-admin@example.com');
        $this->manager = $this->member('manager', 'rejoin-manager@example.com');
        $this->employee = $this->member('employee', 'rejoin-employee@example.com');
    }

    private function member(string $role, string $email, ?Organization $organization = null): User
    {
        return User::create([
            'name' => ucfirst($role),
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => ($organization ?? $this->organization)->id,
            'email_verified_at' => now(),
        ]);
    }

    private function exits(): ExitService
    {
        return app(ExitService::class);
    }

    /**
     * The whole departure, as it really runs: a work info with a service start,
     * an exit, access revoked on the last working day, the exit closed.
     */
    private function makeLeaver(User $subject, string $joinedOn = '2019-04-01', ?User $initiator = null): EmployeeExit
    {
        EmployeeWorkInfo::create([
            'organization_id' => $subject->organization_id,
            'user_id' => $subject->id,
            'joining_date' => $joinedOn,
        ]);

        $exit = $this->exits()->open(
            user: $subject->fresh(),
            lastWorkingDate: now()->subDays(5),
            initiator: $initiator ?? $this->admin,
        );

        $this->exits()->revokeAccess($exit);

        return $this->exits()->advance($exit->fresh(['checklistItems']), EmployeeExit::STAGE_CLOSED)->fresh();
    }

    private function rejoinRequest(EmployeeExit $exit, ?User $actor = null, ?string $joiningDate = null)
    {
        return $this->postJson(
            "/api/exits/{$exit->id}/rejoin",
            ['joining_date' => $joiningDate ?? now()->toDateString()],
            $this->apiHeadersFor($actor ?? $this->admin)
        );
    }

    /* ── the happy path ────────────────────────────────────────── */

    public function test_rejoining_clears_the_deactivation_and_its_reason(): void
    {
        $exit = $this->makeLeaver($this->employee);

        $this->assertNotNull($this->employee->fresh()->deactivated_at);

        $this->rejoinRequest($exit)->assertOk();

        $back = $this->employee->fresh();
        $this->assertNull($back->deactivated_at);
        // The reason described the departure. Leaving it behind on a live
        // account reads as somebody who is deactivated and somehow is not.
        $this->assertNull($back->deactivation_reason);
        $this->assertTrue($back->is_active);
    }

    public function test_the_previous_service_start_is_snapshotted_before_the_work_info_is_re_based(): void
    {
        $exit = $this->makeLeaver($this->employee, joinedOn: '2019-04-01');

        $this->rejoinRequest($exit, joiningDate: '2026-09-01')->assertOk();

        $fresh = $exit->fresh();

        // Snapshot first, overwrite second. The other order loses the earlier
        // service start with nothing to recover it from.
        $this->assertSame('2019-04-01', $fresh->previous_joining_date->toDateString());
        $this->assertSame(
            '2026-09-01',
            $this->employee->fresh()->employeeWorkInfo->joining_date->toDateString()
        );
    }

    public function test_the_joining_date_moves_so_the_continuous_service_clock_restarts(): void
    {
        // Six years served — past the five-year gratuity floor on the old
        // reading. After a break in service that clock starts again at zero,
        // and every reader of `joining_date` must see the current period.
        $exit = $this->makeLeaver($this->employee, joinedOn: '2020-01-15');

        $this->rejoinRequest($exit, joiningDate: '2026-08-26')->assertOk();

        $workInfo = $this->employee->fresh()->employeeWorkInfo;

        $this->assertSame('2026-08-26', $workInfo->joining_date->toDateString());
        $this->assertTrue($workInfo->joining_date->greaterThan($exit->fresh()->last_working_date));
    }

    public function test_rejoining_clears_the_exit_date_on_the_work_info(): void
    {
        $exit = $this->makeLeaver($this->employee);

        $this->assertNotNull($this->employee->fresh()->employeeWorkInfo->exit_date);

        $this->rejoinRequest($exit)->assertOk();

        // The directory and payroll read this column and know nothing about
        // exits; left set, they keep showing somebody who is back as gone.
        $this->assertNull($this->employee->fresh()->employeeWorkInfo->exit_date);
    }

    public function test_the_closed_exit_row_survives_and_is_stamped_rather_than_reopened(): void
    {
        $exit = $this->makeLeaver($this->employee);
        $revokedAt = $exit->access_revoked_at;

        $this->rejoinRequest($exit)->assertOk();

        $fresh = EmployeeExit::find($exit->id);

        $this->assertNotNull($fresh, 'The exit is the record of an employment period that ended.');
        $this->assertSame(EmployeeExit::STAGE_CLOSED, $fresh->stage);
        $this->assertNotNull($fresh->rejoined_at);
        $this->assertNotNull($fresh->closed_at);
        // Access genuinely was revoked on that date. Coming back later does not
        // make that untrue, so the stamp stays.
        $this->assertSame($revokedAt->toDateTimeString(), $fresh->access_revoked_at->toDateTimeString());
    }

    public function test_the_earlier_employment_period_is_still_readable_from_the_exit_row(): void
    {
        $exit = $this->makeLeaver($this->employee, joinedOn: '2019-04-01');
        $lastWorkingDate = $exit->last_working_date->toDateString();

        $this->rejoinRequest($exit, joiningDate: '2026-09-01')->assertOk();

        $fresh = $exit->fresh();

        // Start and end of the first period, both still answerable — which is
        // the only reason re-basing the work info is safe.
        $this->assertSame('2019-04-01', $fresh->previous_joining_date->toDateString());
        $this->assertSame($lastWorkingDate, $fresh->last_working_date->toDateString());
        $this->assertSame($this->employee->id, $fresh->user_id);
    }

    public function test_rejoining_is_allowed_when_the_rehire_decision_is_still_undecided(): void
    {
        $exit = $this->makeLeaver($this->employee);

        $this->assertSame(EmployeeExit::REHIRE_UNDECIDED, $exit->rehire_eligibility);

        // `undecided` is the default on every exit. Refusing it would make an
        // opinion nobody recorded behave like a refusal, and block the feature
        // for everyone who has not been through the eligibility screen.
        $this->rejoinRequest($exit)->assertOk();

        $this->assertNull($this->employee->fresh()->deactivated_at);
    }

    public function test_rejoining_an_exit_marked_eligible_is_allowed(): void
    {
        $exit = $this->makeLeaver($this->employee);
        $this->exits()->recordRehireDecision($exit, EmployeeExit::REHIRE_ELIGIBLE, null, $this->admin);

        $this->rejoinRequest($exit->fresh())->assertOk();

        $this->assertNull($this->employee->fresh()->deactivated_at);
    }

    /* ── refusals ──────────────────────────────────────────────── */

    public function test_rejoining_is_refused_when_the_exit_records_not_eligible(): void
    {
        $exit = $this->makeLeaver($this->employee);
        $this->exits()->recordRehireDecision(
            $exit,
            EmployeeExit::REHIRE_NOT_ELIGIBLE,
            'Dismissed for cause.',
            $this->admin
        );

        $this->rejoinRequest($exit->fresh())
            ->assertStatus(422)
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'not eligible for rehire'));

        // Nothing moved: still out, and the exit is not marked consumed.
        $this->assertNotNull($this->employee->fresh()->deactivated_at);
        $this->assertNull($exit->fresh()->rejoined_at);
    }

    public function test_a_superseded_exit_cannot_be_used_to_route_around_a_later_refusal(): void
    {
        $first = $this->makeLeaver($this->employee, joinedOn: '2019-04-01');
        $this->exits()->recordRehireDecision($first, EmployeeExit::REHIRE_ELIGIBLE, null, $this->admin);
        $this->rejoinRequest($first->fresh(), joiningDate: '2026-01-05')->assertOk();

        // They leave a second time, and this time the organisation says no.
        $second = $this->exits()->open(
            user: $this->employee->fresh(),
            lastWorkingDate: now()->subDay(),
            initiator: $this->admin,
        );
        $this->exits()->revokeAccess($second);
        $this->exits()->recordRehireDecision(
            $second->fresh(),
            EmployeeExit::REHIRE_NOT_ELIGIBLE,
            'Second time was not a success.',
            $this->admin
        );

        // Naming the older, friendlier exit must not get past the newer answer.
        $this->rejoinRequest($first->fresh())
            ->assertStatus(422)
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'most recent exit'));

        $this->assertNotNull($this->employee->fresh()->deactivated_at);
    }

    public function test_an_exit_already_used_to_bring_somebody_back_is_refused_a_second_time(): void
    {
        $exit = $this->makeLeaver($this->employee, joinedOn: '2019-04-01');
        $this->rejoinRequest($exit, joiningDate: '2026-09-01')->assertOk();

        // Deactivate again by hand, so the "already has access" guard is not the
        // one doing the work here — this is about the exit being spent.
        $this->employee->forceFill(['deactivated_at' => now()])->save();

        $this->rejoinRequest($exit->fresh(), joiningDate: '2026-10-01')->assertStatus(422);

        // The snapshot is the thing being protected: a second run would
        // overwrite the 2019 start with the 2026 one and lose the first period.
        $this->assertSame('2019-04-01', $exit->fresh()->previous_joining_date->toDateString());
    }

    public function test_rejoining_somebody_who_already_has_access_is_refused(): void
    {
        EmployeeWorkInfo::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'joining_date' => '2019-04-01',
        ]);

        // An exit opened but access never revoked — they are still working here.
        $exit = $this->exits()->open(
            user: $this->employee->fresh(),
            lastWorkingDate: now()->addDays(30),
            initiator: $this->admin,
        );

        $this->rejoinRequest($exit)
            ->assertStatus(422)
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'already has access'));

        // Papering over it would re-base a continuous-service clock that never
        // broke — silently shortening this person's gratuity entitlement.
        $this->assertNull($exit->fresh()->previous_joining_date);
        $this->assertSame(
            '2019-04-01',
            $this->employee->fresh()->employeeWorkInfo->joining_date->toDateString()
        );
    }

    public function test_a_line_manager_cannot_bring_somebody_back(): void
    {
        $exit = $this->makeLeaver($this->employee);

        // Tighter than the rehire decision (HR may record that): this one
        // spends a paid seat and restores access to the whole product.
        $this->rejoinRequest($exit, actor: $this->manager)->assertStatus(403);

        $this->assertNotNull($this->employee->fresh()->deactivated_at);
    }

    public function test_another_organizations_former_employee_cannot_be_rejoined(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'org-rejoin-other', 'max_seats' => 20]);
        $theirAdmin = $this->member('admin', 'other-rejoin-admin@example.com', $other);
        $theirLeaver = $this->member('employee', 'other-rejoin-employee@example.com', $other);

        $theirExit = $this->makeLeaver($theirLeaver, initiator: $theirAdmin);

        // 404, not 403: BelongsToOrganization scopes the row away entirely, so
        // this tenant is never told it exists.
        $this->rejoinRequest($theirExit)->assertStatus(404);

        $this->assertNotNull($theirLeaver->fresh()->deactivated_at);
        $this->assertNull($theirExit->fresh()->rejoined_at);
    }

    /* ── seats ─────────────────────────────────────────────────── */

    public function test_rejoining_is_refused_with_the_same_actionable_422_a_new_hire_gets(): void
    {
        $exit = $this->makeLeaver($this->employee);

        // Admin and manager still hold access; the leaver released theirs. Cap
        // the workspace at exactly the people in it.
        $this->assertSame(2, app(SeatGuard::class)->usedSeats($this->organization->fresh()));
        $this->organization->forceFill(['max_seats' => 2])->save();

        $this->rejoinRequest($exit)
            ->assertStatus(422)
            ->assertJsonPath(
                'message',
                fn (string $message) => str_contains($message, '2 of 2 seats in use')
                    && str_contains($message, 'Add at least 1 more seat')
            );

        // Refused before anything was written — the guard runs outside the
        // transaction so there is nothing to roll back.
        $this->assertNotNull($this->employee->fresh()->deactivated_at);
        $this->assertNull($exit->fresh()->rejoined_at);
        $this->assertNull($exit->fresh()->previous_joining_date);
    }

    public function test_coming_back_consumes_a_seat(): void
    {
        $exit = $this->makeLeaver($this->employee);
        $seats = app(SeatGuard::class);

        $this->assertSame(2, $seats->usedSeats($this->organization->fresh()));

        $this->rejoinRequest($exit)->assertOk();

        $this->assertSame(3, $seats->usedSeats($this->organization->fresh()));
        // The row never left, but it stopped being charged for on the day
        // access was revoked and starts again the day it is restored — there is
        // only the one number, and it is the one the billing page shows.
        $this->assertSame(3, $seats->summary($this->organization->fresh())['used']);
    }

    /* ── access ────────────────────────────────────────────────── */

    public function test_the_rejoined_user_can_authenticate_again_but_their_old_tokens_stay_revoked(): void
    {
        $staleBearer = $this->issueApiToken($this->employee, 'before-they-left');

        $exit = $this->makeLeaver($this->employee);

        // Revocation deletes every bearer, so the old one is already gone.
        $this->assertSame(0, DB::table('personal_access_tokens')
            ->where('tokenable_type', User::class)
            ->where('tokenable_id', $this->employee->id)
            ->count());

        // And a freshly minted one is refused too, which is what makes the
        // rejoin below a real change rather than a cosmetic one.
        $this->getJson('/api/auth/me', $this->apiHeadersFor($this->employee))
            ->assertStatus(403)
            ->assertJsonPath('error_code', 'ACCOUNT_DEACTIVATED');

        $this->rejoinRequest($exit)->assertOk();

        // Signing in afresh works.
        $login = $this->postJson('/api/auth/login', [
            'email' => $this->employee->email,
            'password' => 'password123',
        ])->assertOk();

        $this->getJson('/api/auth/me', [
            'Authorization' => 'Bearer '.$login->json('token'),
            'Accept' => 'application/json',
        ])->assertOk();

        // The bearer they were holding on their last day is still dead. Coming
        // back is a new session, not the resumption of the old one.
        $this->getJson('/api/auth/me', [
            'Authorization' => 'Bearer '.$staleBearer,
            'Accept' => 'application/json',
        ])->assertStatus(401);
    }

    /* ── history ───────────────────────────────────────────────── */

    public function test_a_second_exit_can_be_opened_for_a_rehired_employee(): void
    {
        $first = $this->makeLeaver($this->employee, joinedOn: '2019-04-01');
        $this->rejoinRequest($first, joiningDate: '2026-01-05')->assertOk();

        $second = $this->exits()->open(
            user: $this->employee->fresh(),
            lastWorkingDate: now()->addDays(30),
            initiator: $this->admin,
        );

        // Nothing on `employee_exits` is unique on `user_id`, deliberately: a
        // person can leave twice, and each departure is its own record.
        $this->assertNotSame($first->id, $second->id);
        $this->assertSame(2, EmployeeExit::where('user_id', $this->employee->id)->count());

        $firstFresh = $first->fresh();
        $this->assertSame(EmployeeExit::STAGE_CLOSED, $firstFresh->stage);
        $this->assertNotNull($firstFresh->rejoined_at);
        $this->assertSame('2019-04-01', $firstFresh->previous_joining_date->toDateString());
        $this->assertNull($second->rejoined_at);
    }

    /* ── audit and atomicity ───────────────────────────────────── */

    public function test_rejoining_writes_an_audit_row_naming_the_admin_who_did_it(): void
    {
        $exit = $this->makeLeaver($this->employee, joinedOn: '2019-04-01');

        $this->rejoinRequest($exit, joiningDate: '2026-09-01')->assertOk();

        // `User` has no Auditable trait, so clearing `deactivated_at` writes
        // nothing by itself — without this row, an account coming back to life
        // has no author.
        $this->assertDatabaseHas('audit_logs', [
            'action' => 'user.rejoined',
            'target_type' => 'User',
            'target_id' => $this->employee->id,
            'actor_user_id' => $this->admin->id,
            'organization_id' => $this->organization->id,
        ]);

        $metadata = DB::table('audit_logs')->where('action', 'user.rejoined')->value('metadata');
        $decoded = json_decode((string) $metadata, true);

        $this->assertSame($exit->id, $decoded['employee_exit_id']);
        $this->assertSame('2019-04-01', $decoded['previous_joining_date']);
        $this->assertSame('2026-09-01', $decoded['joining_date']);
    }

    public function test_a_failure_part_way_through_leaves_nothing_half_done(): void
    {
        $exit = $this->makeLeaver($this->employee, joinedOn: '2019-04-01');

        // Stamping the exit is the last write in the transaction, so failing it
        // is what proves the work info and the reactivation before it roll back
        // together. A half-applied rejoin is an active account whose service
        // clock still says they left.
        Event::listen('eloquent.saving: '.EmployeeExit::class, function () {
            throw new RuntimeException('storage went away');
        });

        try {
            $this->exits()->rejoin($exit, now(), $this->admin);
            $this->fail('The rejoin should have failed.');
        } catch (RuntimeException $expected) {
            $this->assertSame('storage went away', $expected->getMessage());
        }

        $this->assertNotNull($this->employee->fresh()->deactivated_at);
        $this->assertSame(
            '2019-04-01',
            $this->employee->fresh()->employeeWorkInfo->joining_date->toDateString()
        );
        $this->assertNotNull($this->employee->fresh()->employeeWorkInfo->exit_date);
        $this->assertNull($exit->fresh()->rejoined_at);
        $this->assertNull($exit->fresh()->previous_joining_date);
    }
}
