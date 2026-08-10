<?php

namespace App\Services\Monitoring;

use App\Models\Screenshot;
use App\Models\TimeEntry;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Deleting a screenshot also gives back the time it covered.
 *
 * Letting someone remove a capture but keep the minutes it was evidence for
 * would turn "delete my screenshot" into "delete the proof and keep the pay",
 * and no manager would ever agree to enable it. Coupling the two is what makes
 * the control safe to hand to employees: you can always withdraw an image, and
 * the cost is always the time it represented.
 *
 * The deducted span is the interval the capture stood for — from the previous
 * capture on the same entry (or the entry's start, for the first one) up to
 * this capture. It is capped at the organization's capture interval plus a
 * tolerance, because a longer gap does not mean a longer work period: privacy
 * mode skips captures over password managers, the machine may have slept, and
 * a failed upload leaves a hole. Without the cap, deleting the first capture
 * after a two-hour gap would erase two hours.
 */
class ScreenshotDeletionService
{
    /**
     * How much longer than one capture interval a single screenshot may ever
     * account for. One extra interval absorbs jitter (captures are scheduled
     * with +/-10% spread) without letting a gap become billable-looking time.
     */
    private const GAP_TOLERANCE_MULTIPLIER = 2;

    public function __construct(
        private readonly TrackerPolicyResolver $trackerPolicy,
    ) {
    }

    /**
     * Seconds this screenshot accounts for on its time entry.
     *
     * Returns 0 when the span cannot be established, which is the safe
     * direction: failing to deduct leaves the timesheet as it was, whereas an
     * over-deduction silently removes work somebody actually did.
     */
    public function attributableSeconds(Screenshot $screenshot): int
    {
        $timeEntry = $screenshot->timeEntry;
        if (! $timeEntry) {
            return 0;
        }

        $capturedAt = $this->capturedAt($screenshot);
        if (! $capturedAt) {
            return 0;
        }

        $previous = Screenshot::query()
            ->where('time_entry_id', $timeEntry->id)
            ->whereKeyNot($screenshot->getKey())
            ->whereRaw('COALESCE(captured_at, created_at) < ?', [$capturedAt])
            ->orderByRaw('COALESCE(captured_at, created_at) DESC')
            ->first();

        $previousAt = $previous
            ? $this->capturedAt($previous)
            : ($timeEntry->start_time ? Carbon::parse($timeEntry->start_time) : null);

        if (! $previousAt || $previousAt->greaterThanOrEqualTo($capturedAt)) {
            return 0;
        }

        $span = (int) $previousAt->diffInSeconds($capturedAt);

        $intervalMinutes = (int) ($this->trackerPolicy->resolveForUser($timeEntry->user)['capture_interval_minutes'] ?? 10);
        $cap = max(60, $intervalMinutes * 60 * self::GAP_TOLERANCE_MULTIPLIER);

        return max(0, min($span, $cap));
    }

    /**
     * Remove the screenshot's minutes from its time entry.
     *
     * Only closed entries have their duration adjusted. A running timer's
     * duration is derived from start_time on read, so writing to the column
     * would be overwritten on the next tick — the deduction for a live entry
     * has to wait until it is closed, and is deliberately not attempted here.
     *
     * @return int Seconds actually removed.
     */
    public function deductFromTimeEntry(Screenshot $screenshot): int
    {
        $timeEntry = $screenshot->timeEntry;
        if (! $timeEntry || ! $timeEntry->end_time) {
            return 0;
        }

        $seconds = $this->attributableSeconds($screenshot);
        if ($seconds <= 0) {
            return 0;
        }

        return (int) DB::transaction(function () use ($timeEntry, $seconds) {
            /** @var TimeEntry $locked */
            $locked = TimeEntry::query()->lockForUpdate()->find($timeEntry->getKey());
            if (! $locked) {
                return 0;
            }

            $current = (int) $locked->duration;
            // Never below zero: repeated deletions on a short entry would
            // otherwise drive the stored duration negative, and payroll reads
            // this column.
            $applied = min($current, $seconds);
            if ($applied <= 0) {
                return 0;
            }

            $locked->timestamps = false;
            $locked->update([
                'duration' => $current - $applied,
                'duration_reconciled_at' => now(),
            ]);

            return $applied;
        });
    }

    private function capturedAt(Screenshot $screenshot): ?Carbon
    {
        $raw = $screenshot->captured_at ?? $screenshot->created_at;

        return $raw ? Carbon::parse($raw) : null;
    }
}
