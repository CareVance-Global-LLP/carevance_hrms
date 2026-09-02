<?php

namespace App\Services\Monitoring;

use App\Models\TimeEntry;
use App\Models\User;
use App\Services\AppNotificationService;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

/**
 * Says out loud that the server stopped somebody's timer.
 *
 * Both sweeps used to close a timer, write a `Log::info` and stop there. On
 * production that made 59 of 214 stops in 30 days completely silent, and the
 * people it happened to could only describe it as "the tracker just stops".
 *
 * Shared between the two commands so they cannot drift into telling the same
 * story two different ways — the client already learned that lesson, which is
 * why `notifyIdleAutoStop` is one function rather than one per stop path.
 */
class TimerAutoStopNotifier
{
    public const TYPE = 'timer_auto_stopped';

    public function __construct(private readonly AppNotificationService $notifications)
    {
    }

    public function announce(
        User $user,
        TimeEntry $entry,
        int $silentSeconds,
        string $stopReason,
        Carbon $endedAt
    ): void {
        $organizationId = (int) $user->organization_id;

        if ($organizationId <= 0) {
            return;
        }

        try {
            $this->notifications->sendToUsers(
                $organizationId,
                new Collection([(int) $user->id]),
                // No sender. Nobody did this to them; the system did.
                null,
                self::TYPE,
                'Timer stopped automatically',
                $this->message($silentSeconds, $endedAt),
                [
                    'time_entry_id' => (int) $entry->id,
                    'stop_reason' => $stopReason,
                    'silent_seconds' => $silentSeconds,
                    'ended_at' => $endedAt->toIso8601String(),
                    'route' => '/dashboard',
                ]
            );
        } catch (\Throwable $e) {
            /*
             * A failed notification must never abandon the rest of the sweep.
             *
             * AppNotificationService deliberately lets a write failure surface,
             * because in a request that is a real data problem worth a 500.
             * Here it would leave every later timer in the batch still running,
             * which is a strictly worse outcome than one missing notification —
             * so this one is caught, and loudly.
             */
            Log::error('Could not announce an automatic timer stop', [
                'time_entry_id' => (int) $entry->id,
                'user_id' => (int) $user->id,
                'stop_reason' => $stopReason,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Quantify the silence.
     *
     * "Your timer was stopped" on its own invites the only question that
     * matters next. The number is what lets somebody recognise the gap as their
     * lunch and move on — or notice that it was not, and come and ask.
     */
    private function message(int $silentSeconds, Carbon $endedAt): string
    {
        return sprintf(
            'Your timer was stopped after %s with no activity. Time up to %s was recorded.',
            $this->durationLabel($silentSeconds),
            $endedAt->format('g:i a')
        );
    }

    private function durationLabel(int $seconds): string
    {
        $minutes = max(1, (int) round($seconds / 60));

        if ($minutes < 60) {
            return $minutes . ' ' . ($minutes === 1 ? 'minute' : 'minutes');
        }

        $hours = intdiv($minutes, 60);
        $remainder = $minutes % 60;
        $label = $hours . ' ' . ($hours === 1 ? 'hour' : 'hours');

        if ($remainder > 0) {
            $label .= ' ' . $remainder . ' ' . ($remainder === 1 ? 'minute' : 'minutes');
        }

        return $label;
    }
}
