<?php

namespace App\Events;

use Illuminate\Broadcasting\PrivateChannel;
use Illuminate\Contracts\Broadcasting\ShouldBroadcastNow;
use Illuminate\Foundation\Events\Dispatchable;
use Illuminate\Queue\SerializesModels;

/**
 * Tear this user's socket down and clear their credentials.
 *
 * Channel authorization happens ONCE, at subscribe time. Without this event an
 * already-open socket outlives the token that opened it: a leaver whose access
 * was revoked keeps receiving notifications for as long as their tab stays
 * open.
 *
 * That is exactly the failure SCIM is bought to prevent — "a flag alone leaves
 * a leaver's existing token reading payroll on Monday". Adding a transport
 * that quietly reopens it would be a regression against a documented product
 * commitment, so the teardown ships with the transport rather than after it.
 *
 * The reason travels with the event because the client shows different copy
 * for an account that was deactivated versus a session that was signed out
 * elsewhere, and landing on a bare login screen with no explanation reads as a
 * bug.
 */
class SessionRevoked implements ShouldBroadcastNow
{
    use Dispatchable;
    use SerializesModels;

    public const REASON_DEACTIVATED = 'account_deactivated';
    public const REASON_TOKENS_REVOKED = 'tokens_revoked';

    public function __construct(
        public readonly int $userId,
        public readonly string $reason = self::REASON_TOKENS_REVOKED,
    ) {
    }

    /**
     * @return array<int, PrivateChannel>
     */
    public function broadcastOn(): array
    {
        return [new PrivateChannel("user.{$this->userId}")];
    }

    public function broadcastAs(): string
    {
        return 'session.revoked';
    }

    /**
     * @return array<string, mixed>
     */
    public function broadcastWith(): array
    {
        return ['reason' => $this->reason];
    }
}
