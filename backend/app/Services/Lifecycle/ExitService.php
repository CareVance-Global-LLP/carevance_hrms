<?php

namespace App\Services\Lifecycle;

use App\Events\SessionRevoked;
use App\Models\ChecklistTemplate;
use App\Models\EmployeeExit;
use App\Models\Resignation;
use App\Models\User;
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
