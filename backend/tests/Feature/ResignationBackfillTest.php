<?php

namespace Tests\Feature;

use App\Models\EmployeeExit;
use App\Models\Organization;
use App\Models\Resignation;
use App\Models\User;
use App\Services\Lifecycle\ExitService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\Hash;
use RuntimeException;
use Tests\TestCase;

/**
 * `lifecycle:backfill-resignation-exits`.
 *
 * Approval opens the exit, but ResignationController::approve swallows a
 * failure on purpose — the approval is a decision already made. So a
 * resignation can be approved with nothing behind it, and this is the sweep-up.
 *
 * The two rules worth breaking a build over: it must be safe to run twice, and
 * an exit must land in the resigning person's own tenant. Nothing pins the
 * organization for a console command — BelongsToOrganization is deliberately a
 * no-op with no authenticated user — so the second one is only true because the
 * command sets the actor per row.
 */
class ResignationBackfillTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::create(['name' => 'Org', 'slug' => 'org-backfill']);
        $this->admin = $this->member($this->organization, 'admin', 'backfill-admin@example.com');
    }

    private function member(Organization $organization, string $role, string $email): User
    {
        return User::create([
            'name' => ucfirst($role).' '.$organization->id,
            'email' => $email,
            'password' => Hash::make('password123'),
            'role' => $role,
            'organization_id' => $organization->id,
        ]);
    }

    private function approvedResignation(User $user, ?string $lastWorkingDate = null): Resignation
    {
        return Resignation::create([
            'user_id' => $user->id,
            'organization_id' => $user->organization_id,
            'last_working_date' => $lastWorkingDate ?? now()->addDays(30)->toDateString(),
            'status' => 'approved',
            'approved_by' => $this->admin->id,
            'approved_at' => now(),
        ]);
    }

    /** No auth user in a console test, so the org scope is already a no-op — this says so. */
    private function exitsFor(Resignation $resignation): int
    {
        return EmployeeExit::withoutOrganizationScope()
            ->where('resignation_id', $resignation->id)
            ->count();
    }

    public function test_it_opens_an_exit_for_an_approved_resignation_that_has_none(): void
    {
        $employee = $this->member($this->organization, 'employee', 'leaver@example.com');
        $resignation = $this->approvedResignation($employee);

        $this->artisan('lifecycle:backfill-resignation-exits')->assertExitCode(0);

        $exit = EmployeeExit::withoutOrganizationScope()
            ->where('resignation_id', $resignation->id)
            ->first();

        $this->assertNotNull($exit, 'The backfill must open the missing exit');
        $this->assertSame(EmployeeExit::STAGE_NOTICE, $exit->stage);
        $this->assertSame($this->organization->id, $exit->organization_id);
        $this->assertSame(
            $resignation->last_working_date->toDateString(),
            $exit->last_working_date->toDateString()
        );

        // Through ExitService, never by writing the row: a hand-written exit has
        // no clearance behind it, which is the whole reason the exit exists.
        $this->assertGreaterThan(0, $exit->checklistItems()->count());
    }

    public function test_a_resignation_that_already_has_an_exit_is_left_alone(): void
    {
        $employee = $this->member($this->organization, 'employee', 'already@example.com');
        $resignation = $this->approvedResignation($employee);

        app(ExitService::class)->openFromResignation($resignation, $this->admin);
        $existing = EmployeeExit::withoutOrganizationScope()
            ->where('resignation_id', $resignation->id)
            ->firstOrFail();

        $this->artisan('lifecycle:backfill-resignation-exits')
            ->expectsOutputToContain('Opened 0')
            ->assertExitCode(0);

        $this->assertSame(1, $this->exitsFor($resignation));
        $this->assertSame($existing->id, EmployeeExit::withoutOrganizationScope()
            ->where('resignation_id', $resignation->id)
            ->value('id'));
    }

    public function test_a_dry_run_writes_nothing(): void
    {
        $employee = $this->member($this->organization, 'employee', 'dry@example.com');
        $resignation = $this->approvedResignation($employee);

        $this->artisan('lifecycle:backfill-resignation-exits', ['--dry-run' => true])
            ->expectsOutputToContain('Would open')
            ->assertExitCode(0);

        $this->assertSame(0, EmployeeExit::withoutOrganizationScope()->count());
        $this->assertSame(0, $this->exitsFor($resignation));
    }

    public function test_running_it_twice_opens_nothing_the_second_time(): void
    {
        $employee = $this->member($this->organization, 'employee', 'twice@example.com');
        $resignation = $this->approvedResignation($employee);

        $this->artisan('lifecycle:backfill-resignation-exits')->assertExitCode(0);
        $first = EmployeeExit::withoutOrganizationScope()->where('resignation_id', $resignation->id)->firstOrFail();

        // `resignation_id` is what drops the row out of the selection, so the
        // second run must not even reach it — not open a second exit and not
        // report it as a conflict.
        $this->artisan('lifecycle:backfill-resignation-exits')
            ->expectsOutputToContain('Opened 0, 0 conflict(s), 0 failure(s).')
            ->assertExitCode(0);

        $this->assertSame(1, EmployeeExit::withoutOrganizationScope()->count());
        $this->assertSame($first->id, EmployeeExit::withoutOrganizationScope()->value('id'));
    }

    public function test_one_failing_resignation_does_not_end_the_batch(): void
    {
        $first = $this->approvedResignation($this->member($this->organization, 'employee', 'one@example.com'));
        $second = $this->approvedResignation($this->member($this->organization, 'employee', 'two@example.com'));
        $third = $this->approvedResignation($this->member($this->organization, 'employee', 'three@example.com'));

        $this->app->bind(ExitService::class, function ($app) use ($second) {
            $service = $app->make(BackfillExitServiceThatThrows::class);
            $service->throwFor = [$second->id];

            return $service;
        });

        $this->artisan('lifecycle:backfill-resignation-exits')
            ->expectsOutputToContain('Opened 2, 0 conflict(s), 1 failure(s).')
            // A row that threw must be nameable, or the operator cannot chase it.
            ->expectsOutputToContain("FAILED resignation #{$second->id}")
            // A failure is a fault, unlike a conflict — CI has to notice.
            ->assertExitCode(1);

        $this->assertSame(1, $this->exitsFor($first));
        $this->assertSame(0, $this->exitsFor($second));
        $this->assertSame(1, $this->exitsFor($third));
    }

    public function test_it_skips_pending_and_cancelled_resignations(): void
    {
        $employee = $this->member($this->organization, 'employee', 'pending@example.com');

        foreach (['pending', 'rejected', 'cancelled'] as $status) {
            Resignation::create([
                'user_id' => $employee->id,
                'organization_id' => $this->organization->id,
                'last_working_date' => now()->addDays(30)->toDateString(),
                'status' => $status,
            ]);
        }

        $this->artisan('lifecycle:backfill-resignation-exits')
            ->expectsOutputToContain('Opened 0, 0 conflict(s), 0 failure(s).')
            ->assertExitCode(0);

        $this->assertSame(0, EmployeeExit::withoutOrganizationScope()->count());
    }

    public function test_a_second_approved_resignation_for_the_same_person_is_reported_as_a_conflict_not_opened(): void
    {
        $employee = $this->member($this->organization, 'employee', 'duplicate@example.com');
        $first = $this->approvedResignation($employee);
        $second = $this->approvedResignation($employee);

        // ExitService::open() hands back the existing OPEN exit rather than
        // creating a second, and does not link the resignation to it. Reported
        // as opened, the same row would come back on every future run.
        $this->artisan('lifecycle:backfill-resignation-exits')
            ->expectsOutputToContain('Opened 1, 1 conflict(s), 0 failure(s).')
            ->expectsOutputToContain("CONFLICT resignation #{$second->id}")
            ->assertExitCode(0);

        $this->assertSame(1, EmployeeExit::withoutOrganizationScope()->count());
        $this->assertSame(1, $this->exitsFor($first));
        $this->assertSame(0, $this->exitsFor($second));
    }

    public function test_a_dry_run_reports_the_same_duplicate_as_a_conflict_rather_than_an_opening(): void
    {
        $employee = $this->member($this->organization, 'employee', 'dry-duplicate@example.com');
        $first = $this->approvedResignation($employee);
        $second = $this->approvedResignation($employee);

        // A dry run writes nothing, so it cannot see the exit its own earlier
        // row would have opened. Reported naively it promises two openings and
        // the real run makes one — and the operator plans from the preview.
        $this->artisan('lifecycle:backfill-resignation-exits', ['--dry-run' => true])
            ->expectsOutputToContain('Would open 1, 1 conflict(s), 0 failure(s).')
            ->expectsOutputToContain("CONFLICT resignation #{$second->id}")
            ->assertExitCode(0);

        $this->assertSame(0, EmployeeExit::withoutOrganizationScope()->count());

        // And the real run agrees with what the preview said it would do.
        $this->artisan('lifecycle:backfill-resignation-exits')
            ->expectsOutputToContain('Opened 1, 1 conflict(s), 0 failure(s).')
            ->assertExitCode(0);

        $this->assertSame(1, $this->exitsFor($first));
        $this->assertSame(0, $this->exitsFor($second));
    }

    public function test_each_exit_is_created_in_the_resigning_persons_own_organization(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'org-backfill-other']);
        $this->member($other, 'admin', 'other-admin@example.com');

        $mine = $this->approvedResignation($this->member($this->organization, 'employee', 'mine@example.com'));
        $theirs = $this->approvedResignation($this->member($other, 'employee', 'theirs@example.com'));

        $this->artisan('lifecycle:backfill-resignation-exits')
            ->expectsOutputToContain('Opened 2')
            ->assertExitCode(0);

        $this->assertSame(
            $this->organization->id,
            EmployeeExit::withoutOrganizationScope()->where('resignation_id', $mine->id)->value('organization_id')
        );
        $this->assertSame(
            $other->id,
            EmployeeExit::withoutOrganizationScope()->where('resignation_id', $theirs->id)->value('organization_id')
        );
    }

    public function test_it_leaves_nobody_authenticated_when_it_finishes(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'org-backfill-leak']);
        $this->member($other, 'admin', 'leak-admin@example.com');
        $this->approvedResignation($this->member($other, 'employee', 'leak@example.com'));

        $this->artisan('lifecycle:backfill-resignation-exits')->assertExitCode(0);

        // The command pins Auth per row so BelongsToOrganization resolves the
        // right tenant. Left set, the ambient organization for everything after
        // it — another command called in the same process, the rest of a test —
        // silently becomes whichever tenant happened to be last in the loop.
        $this->assertFalse(Auth::hasUser(), 'The sweep must not leave its last actor signed in');
    }

    public function test_the_organization_option_restricts_the_sweep_to_one_tenant(): void
    {
        $other = Organization::create(['name' => 'Other', 'slug' => 'org-backfill-scoped']);
        $this->member($other, 'admin', 'scoped-admin@example.com');

        $mine = $this->approvedResignation($this->member($this->organization, 'employee', 'scoped-mine@example.com'));
        $theirs = $this->approvedResignation($this->member($other, 'employee', 'scoped-theirs@example.com'));

        $this->artisan('lifecycle:backfill-resignation-exits', ['--organization' => $other->id])
            ->expectsOutputToContain('Opened 1')
            ->assertExitCode(0);

        $this->assertSame(0, $this->exitsFor($mine));
        $this->assertSame(1, $this->exitsFor($theirs));
    }

    public function test_it_warns_when_a_backfilled_exit_will_revoke_access_on_the_next_sweep(): void
    {
        $employee = $this->member($this->organization, 'employee', 'past@example.com');
        $this->approvedResignation($employee, now()->subDays(20)->toDateString());

        // Backfilling a past last working day signs somebody out overnight. The
        // command has to say so before it writes, not after somebody notices.
        $this->artisan('lifecycle:backfill-resignation-exits', ['--dry-run' => true])
            ->expectsOutputToContain('last working day has already passed')
            ->expectsOutputToContain('1 account(s) will be deactivated by the next lifecycle:process run.')
            ->assertExitCode(0);
    }
}

/**
 * Makes one named resignation throw, so the batch's tolerance can be asserted
 * without breaking a real dependency. Autowired, so it inherits ExitService's
 * constructor and every other row goes through the genuine path.
 */
class BackfillExitServiceThatThrows extends ExitService
{
    /** @var array<int, int> */
    public array $throwFor = [];

    public function openFromResignation(Resignation $resignation, ?User $initiator = null): EmployeeExit
    {
        if (in_array($resignation->id, $this->throwFor, true)) {
            throw new RuntimeException('Checklist template could not be built.');
        }

        return parent::openFromResignation($resignation, $initiator);
    }
}
