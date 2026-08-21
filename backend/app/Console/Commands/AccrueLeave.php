<?php

namespace App\Console\Commands;

use App\Models\User;
use App\Services\Leave\LeaveAccrualService;
use App\Services\Leave\LeaveConsumptionSync;
use Carbon\Carbon;
use Illuminate\Console\Command;
use Throwable;

/**
 * Brings every active employee's leave ledger up to date.
 *
 * Two halves, and both must run or the balance is wrong in one direction:
 * accrual credits what has been earned, consumption debits what has been taken.
 * Accrual alone gives a balance that only ever rises.
 *
 * Safe to run repeatedly, which is the point — it is scheduled daily, and it
 * will also be run by hand after a policy change or a failure. Accrual is unique
 * on (user, type, period) at the database level and consumption is keyed on the
 * leave request, so a second run writes nothing new rather than doubling anyone.
 *
 * Daily rather than monthly on purpose. A monthly job that fails on the 1st is a
 * month of missing entitlement nobody notices until somebody is refused leave
 * they had earned; a daily job that fails simply catches up tomorrow.
 */
class AccrueLeave extends Command
{
    protected $signature = 'leave:accrue
        {--user= : Only this user id, for investigating one person}
        {--as-of= : Treat this date as today (YYYY-MM-DD), for backfilling}
        {--dry-run : Report what would be written without writing it}';

    protected $description = 'Accrue leave and mirror approved leave into the ledger';

    public function handle(LeaveAccrualService $accrual, LeaveConsumptionSync $consumption): int
    {
        $asOf = $this->option('as-of') ? Carbon::parse($this->option('as-of')) : now();
        $dryRun = (bool) $this->option('dry-run');

        $users = User::query()
            ->whereNotNull('organization_id')
            // Somebody who has left keeps their history but earns nothing more.
            ->whereNull('deactivated_at')
            ->when($this->option('user'), fn ($query) => $query->where('id', (int) $this->option('user')))
            ->orderBy('id')
            ->get();

        if ($users->isEmpty()) {
            $this->info('No active employees to process.');

            return self::SUCCESS;
        }

        $accrued = 0;
        $consumed = 0;
        $failed = 0;

        foreach ($users as $user) {
            try {
                if ($dryRun) {
                    // Rolled back rather than skipped, so a dry run exercises the
                    // real code path — a dry run that takes a different branch
                    // tells you nothing about what the real one will do.
                    \DB::transaction(function () use ($accrual, $consumption, $user, $asOf, &$accrued, &$consumed) {
                        $accrued += $accrual->accrueForUser($user, $asOf);
                        $consumed += $consumption->syncForUser($user);
                        throw new DryRunRollback();
                    });
                } else {
                    $accrued += $accrual->accrueForUser($user, $asOf);
                    $consumed += $consumption->syncForUser($user);
                }
            } catch (DryRunRollback) {
                // Expected.
            } catch (Throwable $exception) {
                /*
                 * One person's bad data must not stop the run. A single missing
                 * joining date should cost that person their accrual for a day,
                 * not the whole organization theirs.
                 */
                $failed++;
                $this->error(sprintf('user %d: %s', $user->id, $exception->getMessage()));
                report($exception);
            }
        }

        $this->info(sprintf(
            '%s%d employees · %d accrual rows · %d consumption rows%s',
            $dryRun ? '[dry run] ' : '',
            $users->count(),
            $accrued,
            $consumed,
            $failed ? sprintf(' · %d failed', $failed) : '',
        ));

        // A partial run is not a success: the scheduler should surface it.
        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }
}

/** Internal signal used to roll a dry run back. */
class DryRunRollback extends \RuntimeException
{
}
