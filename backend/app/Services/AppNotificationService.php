<?php

namespace App\Services;

use App\Events\NotificationCreated;
use App\Models\AppNotification;
use App\Models\User;
use App\Services\ExpoPushService;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

class AppNotificationService
{
    /**
     * @param Collection<int, int> $userIds
     */
    public function sendToUsers(
        int $organizationId,
        Collection $userIds,
        ?int $senderId,
        string $type,
        string $title,
        string $message,
        ?array $meta = null,
        ?int $pollId = null,
        // Ties every row written by one publish together, so the sender can be
        // told how many of them have been read.
        ?string $broadcastId = null
    ): void {
        $normalizedUserIds = $userIds
            ->unique()
            ->filter(fn ($id) => (int) $id > 0)
            ->values();

        if ($normalizedUserIds->isEmpty()) {
            return;
        }

        $users = User::query()
            ->where('organization_id', $organizationId)
            ->whereIn('id', $normalizedUserIds)
            ->get(['id', 'settings']);

        // One resolve for the whole publish: the same payload goes into every
        // row and into the push, and it does not vary by recipient. Doing it
        // here also fixes where it can throw — before anything is written and
        // before the push guard below, so a bug in composing it stays loud.
        $resolvedMeta = $this->resolveMeta($type, $meta);
        $encodedMeta = $resolvedMeta ? json_encode($resolvedMeta) : null;

        // Every publish gets one, not just the ones that arrive with it.
        //
        // It was previously set only by the /notifications/publish endpoint, so
        // chat and every service-originated notification stored null. Real-time
        // delivery needs a key that is IDENTICAL across all recipients of one
        // publish — the row ids are not, they differ per recipient — because
        // that is what lets the event be published to every recipient channel
        // in one batched call, and what lets the mobile app match a socket
        // delivery against the Expo push for the same event and show one
        // banner rather than two.
        //
        // deliveryStats() looks up a specific broadcast_id, so populating it
        // more widely gives it more to work with rather than less.
        $broadcastId ??= (string) Str::uuid();

        $recipientUserIds = [];

        $rows = $users
            ->filter(fn (User $user) => $this->shouldStoreNotification($user, $type))
            ->map(function (User $user) use ($organizationId, $senderId, $type, $title, $message, $encodedMeta, $pollId, $broadcastId, &$recipientUserIds) {
                $recipientUserIds[] = (int) $user->id;

                return [
                    'organization_id' => $organizationId,
                    'user_id' => (int) $user->id,
                    'sender_id' => $senderId,
                    'broadcast_id' => $broadcastId,
                    'poll_id' => $pollId,
                    'type' => $type,
                    'title' => $title,
                    'message' => $message,
                    // insert() bypasses Eloquent casts, so JSON must be encoded explicitly.
                    'meta' => $encodedMeta,
                    'is_read' => false,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            })
            ->values()
            ->all();

        if (empty($rows)) {
            return;
        }

        // The in-app row IS the notification. A failure here is a real data
        // problem and must surface as a 500 rather than a log line.
        AppNotification::insert($rows);

        // Real-time delivery, to the same recipients the rows were written for
        // and no others. $recipientUserIds is the post-filter list, so somebody
        // who muted this notification type gets neither a row nor a broadcast —
        // asserted by NotificationBroadcastTest, because a broadcast that
        // ignores the preference filter is the easiest way to get this wrong.
        //
        // Guarded for the same reason push is: the rows are already committed.
        // A broadcasting misconfiguration — no Reverb running, bad credentials,
        // a driver that throws — must not turn a completed write into a 500 at
        // every caller. The client's catch-up poll covers a dropped broadcast;
        // nothing covers a 500 on a notification that was already stored.
        $this->dispatchBroadcastSafely($recipientUserIds, $broadcastId, $type);

        // Resolving the service here rather than inside dispatchPushSafely()
        // keeps container failures — a genuine wiring bug — outside the guard.
        $pushService = app(ExpoPushService::class);

        $this->dispatchPushSafely(
            $pushService,
            $recipientUserIds,
            $type,
            $title,
            $message,
            // The push and the socket event must agree on one key or the mobile
            // app cannot tell they are the same notification, and shows two.
            array_merge($resolvedMeta ?? [], ['broadcast_id' => $broadcastId])
        );
    }

    /**
     * Hand the notification to Expo without letting push decide the response.
     *
     * The rows are already committed by the time this runs, so a throw here
     * used to turn a completed write into a 500 at every one of the callers —
     * chat, leave approval, task assignment, time-edit requests, payslip
     * delivery and the task console commands. The one that reached production
     * was a missing device_tokens table, which throws before ExpoPushService
     * reaches its own try/catch around the HTTP call. Push is a side effect of
     * the notification, not part of it.
     *
     * @param array<int, int> $recipientUserIds
     * @param array<string, mixed> $pushData
     */
    private function dispatchPushSafely(
        ExpoPushService $pushService,
        array $recipientUserIds,
        string $type,
        string $title,
        string $message,
        array $pushData
    ): void {
        try {
            $pushService->sendToUsers(
                users: $recipientUserIds,
                title: $title,
                body: $message,
                data: $pushData
            );
        } catch (\Throwable $exception) {
            Log::warning('Push notification dispatch failed.', [
                'type' => $type,
                'recipient_user_ids' => $recipientUserIds,
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);
        }
    }

    /**
     * Broadcast without letting the transport decide the response.
     *
     * Same contract as dispatchPushSafely() above and for the same reason: by
     * the time this runs the notification rows are committed, so a throw here
     * would turn a completed write into a 500 at every caller — chat, leave
     * approval, task assignment, payslip delivery, the console commands.
     *
     * The failure modes are real and mostly operational: no Reverb process
     * running (the normal case in local dev), wrong REVERB_APP_* credentials,
     * or a
     * driver misconfiguration after a deploy. All of them are survivable
     * because the client falls back to its catch-up poll and still sees the
     * notification — just not instantly. A 500 is not survivable.
     *
     * @param array<int, int> $recipientUserIds
     */
    private function dispatchBroadcastSafely(array $recipientUserIds, string $broadcastId, string $type): void
    {
        if ($recipientUserIds === []) {
            return;
        }

        try {
            NotificationCreated::dispatch($recipientUserIds, $broadcastId, $type);
        } catch (\Throwable $exception) {
            Log::warning('Notification broadcast failed; clients will fall back to catch-up polling.', [
                'type' => $type,
                'broadcast_id' => $broadcastId,
                'recipient_count' => count($recipientUserIds),
                'exception' => $exception::class,
                'message' => $exception->getMessage(),
            ]);
        }
    }

    private function shouldStoreNotification(User $user, string $type): bool
    {
        $settings = is_array($user->settings) ? $user->settings : [];
        $notificationSettings = is_array($settings['notifications'] ?? null)
            ? $settings['notifications']
            : [];

        $inAppEnabled = (bool) ($notificationSettings['in_app'] ?? true);
        if (! $inAppEnabled) {
            return false;
        }

        return match ($type) {
            'chat_direct_message', 'chat_group_message' => (bool) ($notificationSettings['chat_messages'] ?? true),
            'news' => (bool) ($notificationSettings['weekly_summary'] ?? true),
            'poll' => (bool) ($notificationSettings['project_updates'] ?? true),
            'announcement' => (bool) ($notificationSettings['project_updates'] ?? true),
            'task_assigned' => true,
            default => true,
        };
    }

    private function resolveMeta(string $type, ?array $meta): ?array
    {
        $resolvedMeta = is_array($meta) ? $meta : [];

        if (! isset($resolvedMeta['route'])) {
            $resolvedMeta['route'] = match ($type) {
                'chat_direct_message' => ! empty($resolvedMeta['conversation_id'])
                    ? sprintf('/chat?threadType=direct&threadId=%d', (int) $resolvedMeta['conversation_id'])
                    : '/chat',
                'chat_group_message' => ! empty($resolvedMeta['group_id'])
                    ? sprintf('/chat?threadType=group&threadId=%d', (int) $resolvedMeta['group_id'])
                    : '/chat',
                'browser_tracking_disconnected' => '/monitoring/website-usage',
                'salary_credited' => '/payroll',
                'poll' => '/notifications',
                'task_assigned' => ! empty($resolvedMeta['route'])
                    ? (string) $resolvedMeta['route']
                    : '/tasks',
                'task_completed' => ! empty($resolvedMeta['route'])
                    ? (string) $resolvedMeta['route']
                    : '/tasks',
                'task_overdue' => ! empty($resolvedMeta['route'])
                    ? (string) $resolvedMeta['route']
                    : '/tasks',
                default => '/notifications',
            };
        }

        return $resolvedMeta === [] ? null : $resolvedMeta;
    }
}
