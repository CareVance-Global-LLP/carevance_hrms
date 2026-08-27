<?php

namespace App\Services\Lifecycle;

use App\Events\SessionRevoked;
use App\Models\ChecklistTemplate;
use App\Models\EmployeeExit;
use App\Models\Resignation;
use App\Models\User;
use App\Services\Audit\AuditLogService;
use App\Services\Billing\SeatGuard;
use Carbon\Carbon;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use RuntimeException;

/**
 * Opens and advances an employee exit.
 *
 * Approving a resignation used to write three columns and stop. Everything the
 * organisation actually needs at that moment — clearance, asset recovery,
 * notice arithmetic, revoking access on the right day — starts here instead.
 */
class ExitService
{
    public function __construct(
        private readonly ChecklistService $checklists,
        private readonly NoticePeriodService $notice,
        private readonly DefaultChecklistProvisioner $templates,
        private readonly SeatGuard $seats,
        private readonly AuditLogService $audit,
    ) {
    }

    /**
     * Open the exit for an approved resignation.
     *
     * Idempotent: approving twice, or a retry after a partial failure, returns
     * the existing exit rather than opening a second one.
     */
    public function openFromResignation(Resignation $resignation, ?User $initiator = null): EmployeeExit
    {
        $existing = EmployeeExit::where('resignation_id', $resignation->id)->first();
        if ($existing) {
            return $existing;
        }

        return $this->open(
            user: $resignation->user,
            lastWorkingDate: Carbon::parse($resignation->last_working_date),
            exitType: 'resignation',
            reason: $resignation->reason,
            initiator: $initiator,
            resignation: $resignation,
            noticeStart: $resignation->created_at ? Carbon::parse($resignation->created_at) : null,
        );
    }

    /**
     * Open an exit with no resignation behind it — termination, retirement,
     * redundancy. These are four of the five exit types the settlement table
     * already recognises and previously had no route into the system at all.
     */
    public function open(
        User $user,
        CarbonInterface $lastWorkingDate,
        string $exitType = 'resignation',
        ?string $reason = null,
        ?User $initiator = null,
        ?Resignation $resignation = null,
        ?CarbonInterface $noticeStart = null,
    ): EmployeeExit {
        if (! in_array($exitType, EmployeeExit::TYPES, true)) {
            throw new RuntimeException("Unknown exit type [{$exitType}].");
        }

        $open = EmployeeExit::open()->where('user_id', $user->id)->first();
        if ($open) {
            return $open;
        }

        $start = $noticeStart ? Carbon::parse($noticeStart) : Carbon::now();
        $evaluation = $this->notice->evaluate($user, $lastWorkingDate, $start);

        return DB::transaction(function () use (
            $user, $lastWorkingDate, $exitType, $reason, $initiator, $resignation, $start, $evaluation
        ) {
            $exit = EmployeeExit::create([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'resignation_id' => $resignation?->id,
                'exit_type' => $exitType,
                'exit_reason' => $reason,
                'notice_start_date' => $start->toDateString(),
                'last_working_date' => Carbon::parse($lastWorkingDate)->toDateString(),
                'notice_period_days' => $evaluation['required'],
                'served_days' => $evaluation['served'],
                'shortfall_days' => $evaluation['shortfall'],
                'stage' => EmployeeExit::STAGE_NOTICE,
                'initiated_by' => $initiator?->id,
            ]);

            $template = $this->templates->ensure(
                $user->organization_id,
                ChecklistTemplate::KIND_OFFBOARDING
            );

            $this->checklists->materialise(
                $exit,
                $template,
                Carbon::parse($exit->last_working_date),
                $this->checklists->ownersForExit($exit->load('user.employeeWorkInfo'))
            );

            // Custody is per-person and only knowable now. This is the link that
            // makes "did they give the laptop back?" part of the exit at all.
            $this->checklists->addAssetReturnItems($exit);

            // Mirror onto the work info so the rest of the product (payroll,
            // directory) can see the exit date without knowing about exits.
            $user->employeeWorkInfo?->update([
                'exit_date' => Carbon::parse($lastWorkingDate)->toDateString(),
            ]);

            return $exit->fresh(['checklistItems']);
        });
    }

    /**
     * Move the exit forward. Stages are ordered, and settlement is gated —
     * a blocking clearance item that is still outstanding refuses the move
     * rather than letting a final payment through behind it.
     */
    public function advance(EmployeeExit $exit, string $stage): EmployeeExit
    {
        $order = [
            EmployeeExit::STAGE_NOTICE,
            EmployeeExit::STAGE_CLEARANCE,
            EmployeeExit::STAGE_SETTLEMENT,
            EmployeeExit::STAGE_CLOSED,
        ];

        if (! in_array($stage, $order, true)) {
            throw new RuntimeException("Unknown exit stage [{$stage}].");
        }

        if ($stage === EmployeeExit::STAGE_SETTLEMENT && ! $exit->canEnterSettlement()) {
            throw new RuntimeException(
                'Clearance is not complete — '.$exit->clearance_progress['blocking_outstanding']
                .' blocking item(s) outstanding.'
            );
        }

        $changes = ['stage' => $stage];

        if ($stage === EmployeeExit::STAGE_SETTLEMENT && $exit->clearance_completed_at === null) {
            $changes['clearance_completed_at'] = now();
        }
        if ($stage === EmployeeExit::STAGE_CLOSED) {
            $changes['closed_at'] = now();
        }

        $exit->update($changes);

        return $exit->fresh(['checklistItems']);
    }

    /**
     * Record the employer's view on taking this person back.
     *
     * Deliberately NOT `exit_interviews.would_rejoin`. That answer belongs to
     * the person leaving — it is their opinion, collected in confidence, about
     * whether they would come back. This one is the organisation's, and it is
     * the only one that gates a rehire. Collapsing them would let a survey
     * answer decide a hiring policy, in both directions: somebody dismissed for
     * cause can still tick "yes, I'd return", and somebody the organisation
     * would take back tomorrow may leave angry and tick "no".
     *
     * Recordable at any stage: HR forms this view during clearance, not after
     * closure. Re-recording overwrites and re-stamps, and `employee_exit.updated`
     * keeps the trail of every version.
     */
    public function recordRehireDecision(
        EmployeeExit $exit,
        string $decision,
        ?string $note = null,
        ?User $decidedBy = null,
    ): EmployeeExit {
        if (! in_array($decision, EmployeeExit::REHIRE_DECISIONS, true)) {
            throw new RuntimeException("Unknown rehire decision [{$decision}].");
        }

        $exit->update([
            'rehire_eligibility' => $decision,
            'rehire_note' => $note,
            'rehire_decided_by' => $decidedBy?->id,
            'rehire_decided_at' => now(),
        ]);

        return $exit->fresh();
    }

    /**
     * Bring somebody back.
     *
     * The exit row is left CLOSED, and is never deleted or reopened: it is the
     * record of a period of employment that genuinely ended, and the notice
     * arithmetic, clearance and settlement hanging off it all describe that
     * period. `rejoined_at` marks it consumed; the next departure opens a new
     * row, which is why nothing on `employee_exits` is unique on `user_id`.
     *
     * WHY THE JOINING DATE MOVES. Gratuity under the Payment of Gratuity Act
     * s.4(1) is payable on five years of CONTINUOUS service, and a break in
     * service restarts that clock — somebody who served three years, left, and
     * came back is not four-fifths of the way to a gratuity payment. The same
     * is true of everything else measured from the start of employment: leave
     * accrual pro-rates mid-year joiners against the joining date, probation
     * runs from it, and salary proration reads it for the joining month. All of
     * those must describe the CURRENT employment period, so
     * `employee_work_infos.joining_date` is re-based to the rejoin date. (That
     * column, not `users.joining_date`, which does not exist.)
     *
     * The earlier period is not thrown away — it is snapshotted onto
     * `previous_joining_date` on this exit, which together with
     * `last_working_date` is the whole of the first employment period and the
     * only place it survives. Overwriting the work info without the snapshot
     * would erase the fact that the person was ever here before.
     */
    public function rejoin(
        EmployeeExit $exit,
        CarbonInterface $joiningDate,
        ?User $actor = null,
    ): EmployeeExit {
        $user = $exit->user;

        if (! $user) {
            throw new RuntimeException('This exit has no account behind it to reactivate.');
        }

        // The gate is the organisation's LATEST word on this person, not
        // whichever exit row the caller happened to name. Somebody rehired once
        // and later dismissed for cause has two exits, and reading the older
        // one would route straight around the refusal recorded on the newer.
        // Checked before the consumed guard below so a superseded exit says so,
        // rather than reporting the older departure that is not the problem.
        $latest = EmployeeExit::where('user_id', $user->id)
            ->orderByDesc('last_working_date')
            ->orderByDesc('id')
            ->first();

        if ($latest && $latest->id !== $exit->id) {
            throw new RuntimeException(
                'This is not '.$user->name."'s most recent exit — rejoin through that one instead."
            );
        }

        // An exit is spent the moment it brings somebody back. Re-running it
        // would re-stamp `rejoined_at` and, worse, re-snapshot a joining date
        // that is now the CURRENT period's — losing the earlier one entirely.
        if ($exit->rejoined_at !== null) {
            throw new RuntimeException(
                $user->name.' has already been brought back through this exit.'
            );
        }

        // Only an explicit `not_eligible` refuses. `undecided` is the default on
        // every exit, so treating it as a refusal would make an opinion nobody
        // recorded block every rejoin in the product.
        if ($exit->rehire_eligibility === EmployeeExit::REHIRE_NOT_ELIGIBLE) {
            throw new RuntimeException(
                $user->name.' is marked not eligible for rehire on this exit. '
                .'Change the rehire decision first if that is wrong.'
            );
        }

        // Not an error to paper over: an active account means the person never
        // actually lost access, so re-basing their joining date here would
        // restart a continuous-service clock that never broke.
        if ($user->deactivated_at === null) {
            throw new RuntimeException(
                $user->name.' already has access — there is nothing to reactivate.'
            );
        }

        // Coming back consumes a seat exactly as hiring does. Releasing a seat
        // on deactivation is what makes this necessary: without it, rejoin
        // would be the way round a cap that hiring and invitations respect.
        // Left uncaught so the guard's own wording — which carries the
        // shortfall — reaches the client instead of a reworded dead end.
        if ($organization = $user->organization) {
            $this->seats->assertCanAdd($organization, 1);
        }

        $workInfo = $user->employeeWorkInfo;
        $newJoiningDate = Carbon::parse($joiningDate)->toDateString();

        DB::transaction(function () use ($exit, $user, $workInfo, $newJoiningDate) {
            // Snapshot BEFORE the overwrite, and only into an empty column: the
            // earlier service start exists nowhere else once the work info is
            // re-based.
            if ($exit->previous_joining_date === null && $workInfo?->joining_date) {
                $exit->previous_joining_date = Carbon::parse($workInfo->joining_date)->toDateString();
            }

            $workInfo?->update([
                'joining_date' => $newJoiningDate,
                // Cleared, or the directory and payroll keep reading them as
                // somebody who has left.
                'exit_date' => null,
            ]);

            $user->forceFill([
                'deactivated_at' => null,
                'deactivation_reason' => null,
            ])->save();

            // `stage` and `access_revoked_at` are untouched. The exit stays
            // closed and access genuinely was revoked on that date; both remain
            // true after the person comes back.
            $exit->forceFill(['rejoined_at' => now()])->save();
        });

        // `User` does not use Auditable, so clearing `deactivated_at` writes no
        // audit row of its own. Without this, an account coming back to life —
        // and the admin who did it — is invisible.
        $this->audit->log(
            action: 'user.rejoined',
            actor: $actor,
            target: $user,
            metadata: [
                'employee_exit_id' => $exit->id,
                'previous_joining_date' => $exit->previous_joining_date?->toDateString(),
                'joining_date' => $newJoiningDate,
                'rehire_eligibility' => $exit->rehire_eligibility,
            ],
            organizationId: $user->organization_id,
        );

        return $exit->fresh(['user']);
    }

    /**
     * Cut off access. Called by the scheduled command on the last working day,
     * and available manually for an immediate exit.
     *
     * `User::$is_active` was a hardcoded `true` before this — there was nothing
     * to write to, so accounts simply stayed live for ever.
     */
    public function revokeAccess(EmployeeExit $exit, string $reason = 'exit'): EmployeeExit
    {
        if ($exit->access_revoked_at !== null) {
            return $exit;
        }

        DB::transaction(function () use ($exit, $reason) {
            $exit->user?->forceFill([
                'deactivated_at' => now(),
                'deactivation_reason' => $reason,
            ])->save();

            // Kill every bearer the person is still holding, otherwise a live
            // session outlives the account it belongs to. Tokens are plain rows
            // read by AuthenticateApiToken, not a Sanctum relation.
            if ($exit->user_id) {
                DB::table('personal_access_tokens')
                    ->where('tokenable_type', User::class)
                    ->where('tokenable_id', $exit->user_id)
                    ->delete();
            }

            $exit->update(['access_revoked_at' => now()]);
        });

        // Deleting the bearer stops the next request; it does not close a
        // socket that is already open, because channel authorization runs once
        // at subscribe time. Without this a leaver with a tab still open keeps
        // receiving live notifications after their last working day — exactly
        // what the token deletion above exists to prevent.
        //
        // After the transaction, never inside it: signalling from within would
        // sign somebody out on a write that then rolled back.
        if ($exit->user_id) {
            SessionRevoked::dispatch((int) $exit->user_id, SessionRevoked::REASON_DEACTIVATED);
        }

        Log::info('Exit access revoked', [
            'employee_exit_id' => $exit->id,
            'user_id' => $exit->user_id,
        ]);

        return $exit->fresh();
    }

    /** Exits whose last working day has passed and who still have access. */
    public function dueForRevocation(): iterable
    {
        return EmployeeExit::query()
            ->whereNull('access_revoked_at')
            ->where('stage', '!=', EmployeeExit::STAGE_CLOSED)
            ->whereDate('last_working_date', '<', now()->toDateString())
            ->with('user')
            ->cursor();
    }
}
