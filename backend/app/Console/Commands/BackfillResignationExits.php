<?php

namespace App\Console\Commands;

use App\Models\EmployeeExit;
use App\Models\Resignation;
use App\Models\User;
use App\Services\Lifecycle\ExitService;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Opens the exits that approval should have opened.
 *
 * Approval opens the exit — but only since ExitService existed, and only when
 * it did not throw. ResignationController::approve deliberately swallows a
 * failure (the approval is a decision already made; a checklist that would not
 * build must not undo it), so a resignation can be approved with no exit behind
 * it and nothing says so. This is the sweep-up.
 *
 * Deliberately a command and not a migration: it materialises checklists, reads
 * templates and touches employee_work_infos. A migration that does that cannot
 * be re-run, cannot be previewed, and runs on every deployment.
 *
 * Deliberately not scheduled either — see routes/console.php, which it is
 * absent from. It is one-off remediation; approval is the ongoing path, and a
 * scheduled backfill would hide the failures this exists to surface.
 */
class BackfillResignationExits extends Command
{
    protected $signature = 'lifecycle:backfill-resignation-exits
                            {--dry-run : Report what would change without writing}
                            {--organization= : Restrict to one organization id}';

    protected $description = 'Open exits for approved resignations that never got one';

    public function handle(ExitService $exits): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $organizationId = $this->option('organization') !== null
            ? (int) $this->option('organization')
            : null;

        $opened = 0;
        $conflicts = 0;
        $failed = 0;
        $willRevoke = 0;

        /** @var array<int, int> user id => the resignation this run opens for them */
        $plannedForUser = [];

        foreach ($this->pending($organizationId)->cursor() as $resignation) {
            /** @var Resignation $resignation */
            if ($resignation->user === null) {
                $this->error(sprintf(
                    'FAILED resignation #%d: no account behind it to open an exit for.',
                    $resignation->id
                ));
                $failed++;

                continue;
            }

            // `employee_exits.last_working_date` is NOT NULL, and so is the
            // resignation's — this guards the drift, not today's schema.
            if ($resignation->last_working_date === null) {
                $this->error(sprintf(
                    'FAILED resignation #%d (%s): no last working date to open an exit against.',
                    $resignation->id,
                    $resignation->user->name
                ));
                $failed++;

                continue;
            }

            $actor = $this->actorFor($resignation);

            /*
             * Pin the tenant for the per-row work.
             *
             * BelongsToOrganization resolves the organization from Auth::user(),
             * and with no user the scope is a deliberate no-op so console
             * commands are not filtered to nothing. Inside this loop that
             * default is exactly wrong: ExitService::open() runs the checklist
             * provisioner, materialises items and looks for an existing open
             * exit, all against scoped models — unauthenticated they would read
             * across every tenant. Same trap as a queued job, same remedy.
             */
            Auth::setUser($actor);

            try {
                /*
                 * ExitService::open() returns an existing OPEN exit rather than
                 * creating a second, and does NOT link the resignation to it.
                 * Somebody with two approved resignations therefore looks like
                 * two openings, produces one, and comes back on every future
                 * run. Report the collision instead of hiding it.
                 */
                $openForUser = EmployeeExit::open()
                    ->where('user_id', $resignation->user_id)
                    ->first();

                if ($openForUser) {
                    $this->warn(sprintf(
                        'CONFLICT resignation #%d (%s) — exit #%d is already open for this person, '
                        .'last working day %s. Left unlinked; decide by hand whether this '
                        .'resignation is a duplicate.',
                        $resignation->id,
                        $resignation->user->name,
                        $openForUser->id,
                        $openForUser->last_working_date->toDateString()
                    ));
                    $conflicts++;

                    continue;
                }

                /*
                 * The same collision, one row earlier in this run.
                 *
                 * A dry run writes nothing, so the query above cannot see the
                 * exit a previous row of this run would have opened. Without
                 * this the preview reports five openings for somebody who
                 * resigned five times and the real run opens one — an operator
                 * plans from the preview, so a preview that cannot be true is
                 * worse than no preview.
                 */
                if (isset($plannedForUser[$resignation->user_id])) {
                    $this->warn(sprintf(
                        'CONFLICT resignation #%d (%s) — resignation #%d earlier in this run already '
                        .'opens an exit for this person. Left unlinked; decide by hand whether this '
                        .'resignation is a duplicate.',
                        $resignation->id,
                        $resignation->user->name,
                        $plannedForUser[$resignation->user_id]
                    ));
                    $conflicts++;

                    continue;
                }

                $this->line(sprintf(
                    '%s exit for resignation #%d — %s, last working day %s',
                    $dryRun ? 'Would open' : 'Opening',
                    $resignation->id,
                    $resignation->user->name,
                    $resignation->last_working_date->toDateString()
                ));

                // `< today`, matching ExitService::dueForRevocation exactly.
                // A last working day of TODAY is not revoked until tomorrow,
                // and warning about it would be a false alarm.
                if (Carbon::parse($resignation->last_working_date)->lt(now()->startOfDay())) {
                    $this->warn('  -> last working day has already passed: the next lifecycle:process '
                        .'run will revoke this account\'s access and sign it out.');
                    $willRevoke++;
                }

                if ($dryRun) {
                    $plannedForUser[$resignation->user_id] = $resignation->id;
                    $opened++;

                    continue;
                }

                try {
                    $exits->openFromResignation($resignation, $actor);
                    $plannedForUser[$resignation->user_id] = $resignation->id;
                    $opened++;
                } catch (Throwable $error) {
                    // Never a bare catch: a resignation the sweep could not
                    // handle must be nameable, and one bad row must not end the
                    // batch — the whole point of running this by hand.
                    $this->error("  -> FAILED resignation #{$resignation->id}: {$error->getMessage()}");
                    Log::error('Backfill could not open exit', [
                        'resignation_id' => $resignation->id,
                        'organization_id' => $resignation->organization_id,
                        'error' => $error->getMessage(),
                    ]);
                    $failed++;
                }
            } finally {
                // Unpin before the row is done with, including on a throw. A
                // stale actor makes this tenant the ambient organization for
                // everything after it — the next row's lazy eager load, another
                // command called in the same process, the rest of a test run.
                Auth::forgetUser();
            }
        }

        $this->info(sprintf(
            '%s %d, %d conflict(s), %d failure(s).%s',
            $dryRun ? 'Would open' : 'Opened',
            $opened,
            $conflicts,
            $failed,
            $willRevoke > 0
                ? sprintf(
                    ' %d account(s) will be deactivated by the next lifecycle:process run.',
                    $willRevoke
                )
                : ''
        ));

        // Conflicts are a finding, not a fault — somebody has to decide whether
        // the duplicate resignation is real. A throw is a fault, so CI or an
        // operator notices it.
        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    /**
     * Approved resignations with no exit linked to them.
     *
     * `withoutOrganizationScope()` is the explicit, greppable cross-tenant read
     * the house rule requires — a backfill spans tenants by definition.
     *
     * The whereNotExists is what makes a second run a no-op:
     * ExitService::openFromResignation stamps `resignation_id`, so every row it
     * handled drops out of this selection.
     */
    private function pending(?int $organizationId): Builder
    {
        return Resignation::withoutOrganizationScope()
            ->where('status', 'approved')
            ->whereNotExists(function ($sub) {
                $sub->select(DB::raw(1))
                    ->from('employee_exits')
                    ->whereColumn('employee_exits.resignation_id', 'resignations.id');
            })
            ->when($organizationId !== null, fn ($query) => $query->where('organization_id', $organizationId))
            ->with('user.employeeWorkInfo')
            ->orderBy('organization_id')
            ->orderBy('id');
    }

    /**
     * Somebody in the RIGHT tenant, so the global scope resolves there — and
     * somebody plausible as `initiated_by`, since a backfilled exit should not
     * claim a human opened it. Prefer the organisation's most senior admin;
     * fall back to the person resigning, who is by definition in the tenant.
     *
     * `organization_id` is hand-written here because User is one of the four
     * models deliberately outside BelongsToOrganization — there is no scope to
     * lean on, and this is the tenant the resignation names.
     */
    private function actorFor(Resignation $resignation): User
    {
        return User::query()
            ->where('organization_id', $resignation->organization_id)
            ->whereNull('deactivated_at')
            ->whereIn('role', ['super_admin', 'admin', 'hr'])
            ->orderByRaw("CASE role WHEN 'super_admin' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END")
            ->orderBy('id')
            ->first()
            ?? $resignation->user;
    }
}
