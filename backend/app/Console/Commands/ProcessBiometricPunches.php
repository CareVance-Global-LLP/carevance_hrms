<?php

namespace App\Console\Commands;

use App\Services\Attendance\BiometricPunchProcessor;
use Illuminate\Console\Command;

/**
 * Folds device readings into attendance.
 *
 * Runs on a short interval rather than daily: a punch that has not become
 * attendance is invisible to the person who made it, and somebody standing at
 * a terminal watching nothing happen will punch again.
 *
 * Safe to run concurrently with itself in the sense that matters - each punch
 * is claimed by stamping processed_at, so a second run picks up only what the
 * first has not reached.
 */
class ProcessBiometricPunches extends Command
{
    protected $signature = 'biometric:process {--limit=5000 : Maximum punches per run}';

    protected $description = 'Turn biometric punches into attendance';

    public function handle(BiometricPunchProcessor $processor): int
    {
        $result = $processor->processPending((int) $this->option('limit'));

        $this->info(sprintf(
            '%d processed · %d skipped · %d waiting on a device-id mapping',
            $result['processed'],
            $result['skipped'],
            $result['unmapped'],
        ));

        /*
         * Unmapped punches are NOT a failure exit. They are a normal state - a
         * new joiner enrolled on the device before an admin claimed their id -
         * and failing the command would make the scheduler cry wolf every
         * minute until somebody happened to fix it.
         */
        return self::SUCCESS;
    }
}
