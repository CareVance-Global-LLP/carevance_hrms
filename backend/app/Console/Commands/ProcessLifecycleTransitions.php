<?php

namespace App\Console\Commands;

use App\Models\EmployeeExit;
use App\Services\Lifecycle\ExitService;
use App\Services\Lifecycle\OnboardingService;
use Illuminate\Console\Command;

/**
 * The daily sweep that makes dates mean something.
 *
 * Two things here cannot be left to somebody remembering: cutting off access
 * once the last working day has passed, and moving an onboarding journey out of
 * "preboarding" after the person has actually started.
 */
class ProcessLifecycleTransitions extends Command
{
    protected $signature = 'lifecycle:process
                            {--dry-run : Report what would change without writing}';

    protected $description = 'Revoke access for exits past their last working day and advance onboarding stages';

    public function handle(ExitService $exits, OnboardingService $onboarding): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $revoked = 0;
        foreach ($exits->dueForRevocation() as $exit) {
            /** @var EmployeeExit $exit */
            $this->line(sprintf(
                '%s exit #%d — %s, last working day %s',
                $dryRun ? 'Would revoke' : 'Revoking',
                $exit->id,
                $exit->user?->name ?? 'unknown user',
                $exit->last_working_date->toDateString()
            ));

            if (! $dryRun) {
                $exits->revokeAccess($exit, 'last_working_day');
            }

            $revoked++;
        }

        $advanced = $dryRun ? 0 : $onboarding->sweep();

        $this->info(sprintf(
            '%s %d access revocation(s), %d onboarding stage change(s).',
            $dryRun ? 'Would apply' : 'Applied',
            $revoked,
            $advanced
        ));

        return self::SUCCESS;
    }
}
