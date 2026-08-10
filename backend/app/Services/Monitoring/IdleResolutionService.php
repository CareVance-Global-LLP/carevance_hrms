<?php

namespace App\Services\Monitoring;

use App\Models\Activity;
use App\Models\TimeEntry;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Applies a person's answer about an idle stretch.
 *
 * The decision this encodes, drawn from how the category actually behaves:
 * idle is a *signal*, not an automatic deduction. Time Doctor states plainly
 * that idle is never subtracted from worked hours — "many legitimate tasks
 * naturally include high idle periods" — and Hubstaff keeps the minutes in the
 * timesheet at 0% activity rather than removing them. Both put the choice to
 * the person and record the answer.
 *
 * So the default here is DISCARD only because that is what the prompt offers as
 * the safe option; nothing is deducted until somebody actually says so.
 *
 * The asymmetry is worth stating: when a person returns before the auto-stop
 * threshold their timer never stopped, so those minutes are already counted.
 * "Keep" is therefore a no-op on the ledger and only records the answer;
 * "discard" is what has to move time. That is the reverse of the auto-stop
 * path, where the tail was already rewound off the entry.
 */
class IdleResolutionService
{
    public const KEPT = 'kept';
    public const DISCARDED = 'discarded';

    /**
     * @return array{resolution: string, seconds_removed: int}
     */
    public function resolve(Activity $activity, User $actor, string $action): array
    {
        $resolution = $action === self::KEPT ? self::KEPT : self::DISCARDED;

        // Already answered: return what was decided rather than applying it a
        // second time. The desktop retries this call when a response is lost,
        // and a second discard would deduct the same minutes twice.
        if ($activity->idle_resolution !== null) {
            return [
                'resolution' => (string) $activity->idle_resolution,
                'seconds_removed' => 0,
            ];
        }

        $secondsRemoved = $resolution === self::DISCARDED
            ? $this->deduct($activity)
            : 0;

        $activity->forceFill([
            'idle_resolution' => $resolution,
            'idle_resolved_at' => now(),
        ])->save();

        return [
            'resolution' => $resolution,
            'seconds_removed' => $secondsRemoved,
        ];
    }

    /**
     * Take the idle span back off the entry it was counted against.
     *
     * Only closed entries are adjusted. A running timer's duration is derived
     * from start_time on read, so a write here would be overwritten on the next
     * tick — for a live timer the honest move is to record the answer and let
     * the stop path apply it, which it already does by rewinding to the last
     * keypress.
     */
    private function deduct(Activity $activity): int
    {
        $seconds = (int) max(0, (int) $activity->duration);
        if ($seconds <= 0 || ! $activity->time_entry_id) {
            return 0;
        }

        return (int) DB::transaction(function () use ($activity, $seconds) {
            /** @var TimeEntry|null $entry */
            $entry = TimeEntry::query()->lockForUpdate()->find($activity->time_entry_id);
            if (! $entry || ! $entry->end_time) {
                return 0;
            }

            $current = (int) $entry->duration;
            // Never negative: payroll reads this column, and several idle spans
            // on a short entry could otherwise drive it below zero.
            $applied = min($current, $seconds);
            if ($applied <= 0) {
                return 0;
            }

            $entry->timestamps = false;
            $entry->update([
                'duration' => $current - $applied,
                'duration_reconciled_at' => now(),
            ]);

            return $applied;
        });
    }
}
