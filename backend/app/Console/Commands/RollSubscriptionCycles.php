<?php

namespace App\Console\Commands;

use App\Mail\SubscriptionRenewalReminderMail;
use App\Models\Organization;
use App\Services\Billing\SeatGuard;
use App\Services\Billing\SubscriptionCycleService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Moves every subscription to the state its dates say it is in, and sends the
 * renewal reminders due today.
 *
 * This is the job that did not exist. `subscription_expires_at` was written by
 * the payment paths and then never looked at again, so a paid plan past its
 * date kept full access indefinitely.
 *
 * Safe to run repeatedly: transitions are idempotent because they are derived
 * rather than incremented, and each reminder stage is recorded against the
 * renewal date it was sent for.
 */
class RollSubscriptionCycles extends Command
{
    protected $signature = 'billing:roll-cycle
                            {--dry-run : Report what would change without writing anything}
                            {--skip-reminders : Apply state transitions but send no email}';

    protected $description = 'Advance subscription states and send renewal reminders';

    public function __construct(
        private readonly SubscriptionCycleService $cycles,
        private readonly SeatGuard $seats,
    ) {
        parent::__construct();
    }

    public function handle(): int
    {
        $isDryRun = (bool) $this->option('dry-run');
        $skipReminders = (bool) $this->option('skip-reminders');

        $transitioned = 0;
        $reminded = 0;
        $scanned = 0;

        Organization::query()
            ->whereNotNull('subscription_status')
            ->chunkById(100, function ($organizations) use (&$transitioned, &$reminded, &$scanned, $isDryRun, $skipReminders) {
                foreach ($organizations as $organization) {
                    $scanned++;

                    $before = $organization->subscription_status;
                    $after = $this->cycles->resolveState($organization);

                    if ($before !== $after) {
                        $this->line(sprintf(
                            '  %-40s %s → %s',
                            \Illuminate\Support\Str::limit($organization->name, 38),
                            $before,
                            $after
                        ));

                        if (!$isDryRun) {
                            $this->cycles->reconcile($organization);
                            Log::info('billing.subscription_state_changed', [
                                'organization_id' => $organization->id,
                                'from' => $before,
                                'to' => $after,
                                'period_end' => $this->cycles->periodEndsAt($organization)?->toDateString(),
                            ]);
                        }

                        $transitioned++;
                    } elseif (!$isDryRun) {
                        // Keeps grace_ends_at truthful even when the state itself
                        // did not move.
                        $this->cycles->reconcile($organization);
                    }

                    if ($skipReminders) {
                        continue;
                    }

                    $stage = $this->cycles->dueReminderStage($organization);
                    if ($stage === null) {
                        continue;
                    }

                    if (!$isDryRun && $this->sendReminder($organization, $stage)) {
                        $this->cycles->markReminderSent($organization, $stage);
                        $reminded++;
                    } elseif ($isDryRun) {
                        $this->line(sprintf('  %-40s reminder T-%d', \Illuminate\Support\Str::limit($organization->name, 38), $stage));
                        $reminded++;
                    }
                }
            });

        $this->info(sprintf(
            '%s%d scanned · %d state change(s) · %d reminder(s)',
            $isDryRun ? '[dry run] ' : '',
            $scanned,
            $transitioned,
            $reminded
        ));

        return self::SUCCESS;
    }

    /**
     * Emails every admin of the workspace. Returns false when there is nobody to
     * tell, so the stage is not marked sent and the next run tries again.
     */
    private function sendReminder(Organization $organization, int $stage): bool
    {
        $recipients = $organization->users()
            ->where('role', 'admin')
            ->stillHoldingAccess()
            ->pluck('email')
            ->filter()
            ->unique()
            ->values();

        if ($recipients->isEmpty()) {
            Log::warning('billing.renewal_reminder_no_recipients', [
                'organization_id' => $organization->id,
                'stage' => $stage,
            ]);

            return false;
        }

        $mailable = new SubscriptionRenewalReminderMail(
            organization: $organization,
            daysRemaining: (int) ($this->cycles->daysRemaining($organization) ?? $stage),
            renewalDate: (string) $this->cycles->periodEndsAt($organization)?->format('j F Y'),
            seats: $this->seats->maxSeats($organization),
            autoRenew: (bool) $organization->auto_renew,
        );

        try {
            foreach ($recipients as $email) {
                Mail::to($email)->send($mailable);
            }
        } catch (\Throwable $e) {
            // A mail transport failure must not stop the rest of the run, and
            // must not mark the stage sent — the next run retries it.
            Log::error('billing.renewal_reminder_failed', [
                'organization_id' => $organization->id,
                'stage' => $stage,
                'message' => $e->getMessage(),
            ]);

            return false;
        }

        return true;
    }
}
