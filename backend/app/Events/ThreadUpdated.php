<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Signals that a chat thread has changed and the thread list should refresh.
 *
 * Like NotificationCreated, this carries no row data — the client re-fetches
 * the thread list via its existing polling endpoint, which returns fresh data
 * with real ids. The event is just the "something happened" signal.
 */
class ThreadUpdated implements ShouldBroadcastNow
{
    use Dispatchable;
    use SerializesModels;

    /**
     * @param array<int, int> $recipientUserIds
     */
    public function __construct(
        public readonly array $recipientUserIds,
        public readonly string $threadType,
        public readonly int $threadId,
        public readonly string $eventType,
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
        return 'thread.updated';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'thread_type' => $this->threadType,
            'thread_id' => $this->threadId,
            'event_type' => $this->eventType,
        ];
    }
}
