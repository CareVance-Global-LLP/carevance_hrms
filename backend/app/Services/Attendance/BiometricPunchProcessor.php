<?php

namespace App\Services\Attendance;

use App\Models\BiometricPunch;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;

/**
 * Turns device readings into attendance.
 *
 * Deliberately goes through AttendanceService::checkIn/checkOut rather than
 * writing attendance rows itself. Those methods already own late-minute
 * calculation, leave blocking, shift resolution and the punch/record pairing —
 * a second path would mean a biometric punch and an app punch producing subtly
 * different attendance for the same person on the same day, and only one of
 * them being right.
 *
 * `syncContext['punch_at']` is the mechanism the offline desktop queue already
 * uses to file a buffered punch on the day it actually happened. A device is
 * the same problem: it holds readings while the network is down and replays
 * them later.
 *
 * DIRECTION IS DECIDED HERE, from the sequence of readings in a day — not from
 * the device's own status field. That field is set by whichever key the person
 * pressed, and in practice everybody presses the same one, so trusting it makes
 * every punch an IN and nobody ever leaves.
 */
class BiometricPunchProcessor
{
    public function __construct(
        private readonly AttendanceService $attendanceService,
    ) {
    }

    /**
     * Process everything unprocessed, oldest first.
     *
     * Order matters: pairing is positional, so a punch processed out of
     * sequence pairs with the wrong neighbour.
     *
     * @return array{processed:int, skipped:int, unmapped:int}
     */
    public function processPending(int $limit = 5000): array
    {
        $pending = BiometricPunch::withoutOrganizationScope()
            ->whereNull('processed_at')
            ->orderBy('punched_at')
            ->orderBy('id')
            ->limit($limit)
            ->get();

        $processed = 0;
        $skipped = 0;
        $unmapped = 0;

        /*
         * Grouped by person and calendar day. Attendance is a per-day record,
         * and pairing across a day boundary would close yesterday with today's
         * first punch.
         */
        $groups = $pending->groupBy(fn (BiometricPunch $punch) => sprintf(
            '%s|%s',
            $punch->user_id ?? 'unmapped',
            $punch->punched_at->setTimezone(config('app.timezone'))->toDateString(),
        ));

        foreach ($groups as $key => $punches) {
            [$userId] = explode('|', (string) $key);

            if ($userId === 'unmapped') {
                /*
                 * Left unprocessed on purpose. Once an admin claims the device
                 * id, these become attendance on the next run - discarding them
                 * would silently lose somebody's day because a mapping was late.
                 */
                $unmapped += $punches->count();

                continue;
            }

            $user = User::find((int) $userId);
            if (! $user) {
                $skipped += $this->markAll($punches, 'user_missing');

                continue;
            }

            $processed += $this->processDay($user, $punches);
        }

        return ['processed' => $processed, 'skipped' => $skipped, 'unmapped' => $unmapped];
    }

    /**
     * One person, one day.
     *
     * @param  Collection<int, BiometricPunch>  $punches
     */
    private function processDay(User $user, Collection $punches): int
    {
        $ordered = $punches->sortBy(fn (BiometricPunch $punch) => $punch->punched_at->getTimestamp())->values();
        $handled = 0;

        foreach ($ordered as $index => $punch) {
            /*
             * Alternating from the first reading of the day: in, out, in, out.
             *
             * Somebody who taps twice on the way in produces an immediate
             * in/out pair of a few seconds, which is visibly wrong but honest —
             * it is what the hardware recorded. Silently collapsing near-
             * duplicates would be guessing at intent, and the guess is wrong
             * for anyone who genuinely steps out briefly.
             */
            $isCheckIn = $index % 2 === 0;

            try {
                $result = $isCheckIn
                    ? $this->attendanceService->checkIn($user, null, null, $this->syncContext($punch, true))
                    : $this->attendanceService->checkOut($user, null, null, $this->syncContext($punch, false));

                $status = (int) ($result['status'] ?? 500);

                /*
                 * A 422 is a refusal, not a crash - approved leave, or a
                 * check-out with nothing open. Recording why is what lets an
                 * admin see that a device fired on somebody's day off rather
                 * than wondering where the attendance went.
                 */
                $punch->forceFill([
                    'processed_at' => now(),
                    'process_result' => $status >= 200 && $status < 300
                        ? ($isCheckIn ? 'checked_in' : 'checked_out')
                        : 'refused_'.$status,
                ])->save();

                $handled++;
            } catch (\Throwable $exception) {
                // One bad reading must not stop the rest of the batch.
                Log::warning('Biometric punch could not be processed', [
                    'punch_id' => $punch->id,
                    'user_id' => $user->id,
                    'message' => $exception->getMessage(),
                ]);

                $punch->forceFill([
                    'processed_at' => now(),
                    'process_result' => 'error',
                ])->save();
            }
        }

        return $handled;
    }

    /** @return array<string, mixed> */
    private function syncContext(BiometricPunch $punch, bool $isCheckIn): array
    {
        $at = $punch->punched_at->setTimezone(config('app.timezone'))->toDateTimeString();

        return [
            $isCheckIn ? 'punch_at' : 'punch_out_at' => $at,
            // Namespaced so a replayed device batch resolves to the punch it
            // already created rather than opening a second one.
            'local_id' => 'biometric:'.$punch->id,
            'device_id' => 'biometric-device:'.$punch->biometric_device_id,
        ];
    }

    /** @param  Collection<int, BiometricPunch>  $punches */
    private function markAll(Collection $punches, string $result): int
    {
        foreach ($punches as $punch) {
            $punch->forceFill(['processed_at' => now(), 'process_result' => $result])->save();
        }

        return $punches->count();
    }

    /**
     * Punches waiting on somebody to claim a device id.
     *
     * Surfaced rather than counted: "47 punches unmapped" is not actionable,
     * but "device id 42 has 47 punches and nobody has claimed it" is.
     *
     * @return Collection<int, object>
     */
    public function unmappedSummary(int $organizationId): Collection
    {
        return BiometricPunch::query()
            ->where('organization_id', $organizationId)
            ->whereNull('user_id')
            ->selectRaw('device_user_id, count(*) as punch_count, min(punched_at) as first_seen, max(punched_at) as last_seen')
            ->groupBy('device_user_id')
            ->orderByDesc('punch_count')
            ->get();
    }
}
