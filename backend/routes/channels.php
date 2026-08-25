<?php

use App\Models\User;
use Illuminate\Support\Facades\Broadcast;

/*
 * One channel per user, and deliberately nothing else.
 *
 * Every app_notifications row is already per-user, so this maps 1:1 — which
 * means there is no org-level channel and therefore no broadcast surface that
 * could ever span tenants. In a codebase where 97 models carry
 * BelongsToOrganization precisely so tenancy is structural rather than
 * remembered, not introducing a shared channel is worth more than any
 * convenience one would buy.
 *
 * Chat rides this same channel rather than getting private-chat.{id}.
 * ChatService already resolves the recipient list before writing notification
 * rows; broadcasting to each recipient's own channel reuses that decision
 * exactly and adds no second membership check for a tenancy mistake to live in.
 */
Broadcast::channel('user.{userId}', function (User $user, int $userId): bool {
    return (int) $user->id === (int) $userId;
});
