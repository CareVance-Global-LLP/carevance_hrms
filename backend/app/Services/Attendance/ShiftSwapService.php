<?php

namespace App\Services\Attendance;

use App\Models\RosterDay;
use App\Models\ShiftSwapRequest;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * Two people trading rostered days.
 *
 * THREE PARTIES, NOT TWO. The other person has to agree, and a manager has to
 * approve. One person cannot give away their shift; and two people cannot
 * rewrite the site's cover between them, which is exactly what a
 * two-party-only swap allows on a rota that exists to guarantee cover.
 *
 * THE SWAP HAPPENS AT APPROVAL, NOT AT REQUEST. Nothing moves on the roster
 * until the manager says yes, so a pending request never changes what anybody
 * is expected to work. A product that swapped optimistically and rolled back on
 * refusal would be telling people to come in and then telling them not to.
 *
 * BOTH DAYS ARE NAMED. A swap is a concrete exchange rather than a request to
 * "cover Tuesday" that somebody has to interpret, which is what makes it
 * possible to check that both days are still what they were when the request
 * was made.
 */
class ShiftSwapService
{
    /**
     * Ask somebody to swap.
     *
     * Both days must be published: swapping into a draft is trading something
     * neither person has been told about yet.
     */
    public function request(
        User $requester,
        RosterDay $ownDay,
        RosterDay $theirDay,
        ?string $reason = null,
    ): ShiftSwapRequest {
        if ((int) $ownDay->user_id !== (int) $requester->id) {
            throw new RuntimeException('You can only offer your own rostered day.');
        }

        if ((int) $theirDay->user_id === (int) $requester->id) {
            throw new RuntimeException('Trading a day with yourself is not a swap.');
        }

        if ((int) $ownDay->organization_id !== (int) $theirDay->organization_id) {
            throw new RuntimeException('Those days are in different workspaces.');
        }

        foreach ([$ownDay, $theirDay] as $day) {
            if (! $day->isPublished()) {
                throw new RuntimeException('Both days have to be published before they can be swapped.');
            }

            if ($day->roster_date->startOfDay()->isBefore(now()->startOfDay())) {
                // Swapping a day already worked changes the record of what
                // somebody was told to do, after they did it.
                throw new RuntimeException('That day has already passed.');
            }
        }

        if ($this->openRequestFor($ownDay) || $this->openRequestFor($theirDay)) {
            // Two live requests on one day race to swap it, and whichever is
            // approved second is approving against a roster that has moved.
            throw new RuntimeException('One of those days already has a swap in progress.');
        }

        return ShiftSwapRequest::query()->create([
            'organization_id' => $ownDay->organization_id,
            'requested_by' => $requester->id,
            'requested_with' => $theirDay->user_id,
            'requester_roster_day_id' => $ownDay->id,
            'counterparty_roster_day_id' => $theirDay->id,
            'status' => 'pending_counterparty',
            'reason' => $reason,
        ]);
    }

    /** The other person agrees. It still needs approving. */
    public function accept(ShiftSwapRequest $request, User $counterparty): ShiftSwapRequest
    {
        if ($request->status !== 'pending_counterparty') {
            throw new RuntimeException('That request is not waiting on you.');
        }

        if ((int) $request->requested_with !== (int) $counterparty->id) {
            throw new RuntimeException('That request was not sent to you.');
        }

        $request->forceFill([
            'status' => 'pending_approval',
            'accepted_at' => now(),
        ])->save();

        return $request->fresh();
    }

    /**
     * A manager approves, and the days actually move.
     *
     * The shifts are re-read here rather than trusted from when the request was
     * made: a roster can change between asking and approving, and swapping a
     * shift somebody no longer has is how a rota ends up with a hole nobody
     * notices until the morning.
     */
    public function approve(ShiftSwapRequest $request, User $approver): ShiftSwapRequest
    {
        if ($request->status !== 'pending_approval') {
            throw new RuntimeException('That request is not waiting for approval.');
        }

        return DB::transaction(function () use ($request, $approver) {
            $mine = RosterDay::query()->lockForUpdate()->find($request->requester_roster_day_id);
            $theirs = RosterDay::query()->lockForUpdate()->find($request->counterparty_roster_day_id);

            if (! $mine || ! $theirs) {
                throw new RuntimeException('One of those rostered days no longer exists.');
            }

            $mineShift = $mine->shift_id;
            $theirsShift = $theirs->shift_id;

            /*
             * Marked `swap` rather than `manual`: both are protected from
             * regeneration, but a roster somebody is reading later should say
             * which of the two happened.
             */
            $mine->forceFill([
                'shift_id' => $theirsShift,
                'source' => 'swap',
                'note' => 'Swapped with '.($theirs->user?->name ?? 'a colleague'),
            ])->save();

            $theirs->forceFill([
                'shift_id' => $mineShift,
                'source' => 'swap',
                'note' => 'Swapped with '.($mine->user?->name ?? 'a colleague'),
            ])->save();

            $request->forceFill([
                'status' => 'approved',
                'approved_by' => $approver->id,
                'decided_at' => now(),
            ])->save();

            return $request->fresh();
        });
    }

    /**
     * Refuse, with a reason.
     *
     * Either the counterparty or a manager may decline, and both need to say
     * why - a swap that simply never happens leaves somebody planning their
     * week around an answer they never got.
     */
    public function decline(ShiftSwapRequest $request, User $actor, string $reason): ShiftSwapRequest
    {
        if (! $request->isOpen()) {
            throw new RuntimeException('That request has already been decided.');
        }

        if (trim($reason) === '') {
            throw new RuntimeException('A refusal needs a reason.');
        }

        $request->forceFill([
            'status' => 'declined',
            'decline_reason' => trim($reason),
            'approved_by' => $actor->id,
            'decided_at' => now(),
        ])->save();

        return $request->fresh();
    }

    /** The requester changes their mind. Only they may, and only while it is open. */
    public function cancel(ShiftSwapRequest $request, User $requester): ShiftSwapRequest
    {
        if ((int) $request->requested_by !== (int) $requester->id) {
            throw new RuntimeException('Only the person who asked can withdraw it.');
        }

        if (! $request->isOpen()) {
            throw new RuntimeException('That request has already been decided.');
        }

        $request->forceFill(['status' => 'cancelled', 'decided_at' => now()])->save();

        return $request->fresh();
    }

    private function openRequestFor(RosterDay $day): bool
    {
        return ShiftSwapRequest::query()
            ->whereIn('status', ['pending_counterparty', 'pending_approval'])
            ->where(function ($query) use ($day) {
                $query->where('requester_roster_day_id', $day->id)
                    ->orWhere('counterparty_roster_day_id', $day->id);
            })
            ->exists();
    }
}
