<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * "Something new arrived" — a signal, not the notification itself.
 *
 * The event deliberately does NOT carry the notification row. Two reasons, and
 * both are load-bearing:
 *
 * 1. The row id differs per recipient while the content is identical. Putting
 *    a user_id => notification_id map in the payload would hand every
 *    recipient the other recipients' ids over their own private channel. A
 *    small leak, but this is an HR product and there is no reason to take it.
 *
 * 2. Because the payload is identical for everybody, Laravel can publish to
 *    all recipient channels in one call (batched 100 at a time) instead of one
 *    call per person. A 200-person announcement is two HTTP calls to Reverb,
 *    not 200.
 *
 * On receipt the client runs its since_id catch-up, which returns the real
 * rows with real ids. That costs one round trip (~50ms against a 30 SECOND
 * poll) and buys a large simplification: the client renders notifications from
 * rows through the code path it already has, so there is no second rendering
 * path to keep in step, and mark-read works because real ids are present.
 *
 * broadcast_id is the dedupe key rather than the row id, for the same reason
 * it is the payload: it is stable across every recipient of one publish. It is
 * what lets the mobile app suppress an Expo push banner for something the
 * socket has already delivered while the app is foregrounded.
 *
 * ShouldBroadcastNow, not ShouldBroadcast: the queued variant would make
 * delivery inherit queue-worker latency, which defeats the entire point on any
 * deployment where the worker is busy or briefly down. Publishing inline to
 * Reverb over the local network costs single-digit milliseconds.
 */
class NotificationCreated implements ShouldBroadcastNow
{
    use Dispatchable;
    use SerializesModels;

    /**
     * @param array<int, int> $recipientUserIds
     */
    public function __construct(
        public readonly array $recipientUserIds,
        public readonly string $broadcastId,
        public readonly string $type,
    ) {
    }

    /**
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return array_map(
            static fn (int $userId): PrivateChannel => new PrivateChannel("user.{$userId}"),
            array_values(array_unique(array_map('intval', $this->recipientUserIds)))
        );
    }

    public function broadcastAs(): string
    {
        return 'notification.created';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'broadcast_id' => $this->broadcastId,
            'type' => $this->type,
        ];
    }
}
