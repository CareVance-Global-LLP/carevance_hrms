<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Broadcasts the full serialized message to the open thread in real-time.
 *
 * Unlike ThreadUpdated (which only signals the sidebar to refresh), this event
 * carries the message payload so the recipient's open thread appends it
 * immediately without waiting for the next poll tick.
 */
class NewMessage implements ShouldBroadcastNow
{
    use Dispatchable;
    use SerializesModels;

    /**
     * @param array<int, int> $recipientUserIds
     * @param array<string, mixed> $message  Serialized message with sender loaded
     */
    public function __construct(
        public readonly array $recipientUserIds,
        public readonly string $threadType,
        public readonly int $threadId,
        public readonly array $message,
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
        return 'message.new';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'thread_type' => $this->threadType,
            'thread_id' => $this->threadId,
            'message' => $this->message,
        ];
    }
}
