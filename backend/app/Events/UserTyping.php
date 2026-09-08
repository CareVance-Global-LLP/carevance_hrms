<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Signals that a user is typing in a chat conversation.
 *
 * Broadcast to the other participant(s) in the conversation. The event
 * carries just enough data to render a "User is typing..." indicator —
 * no message content.
 */
class UserTyping implements ShouldBroadcastNow
{
    use Dispatchable;
    use SerializesModels;

    /**
     * @param array<int, int> $recipientUserIds
     */
    public function __construct(
        public readonly array $recipientUserIds,
        public readonly int $typingUserId,
        public readonly string $typingUserName,
        public readonly string $threadType,
        public readonly int $threadId,
        public readonly bool $isTyping,
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
        return 'user.typing';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return [
            'user_id' => $this->typingUserId,
            'user_name' => $this->typingUserName,
            'thread_type' => $this->threadType,
            'thread_id' => $this->threadId,
            'is_typing' => $this->isTyping,
        ];
    }
}
