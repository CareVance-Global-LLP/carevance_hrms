<?php

namespace App\Services;

use App\Models\AppNotification;
use App\Models\User;
use Illuminate\Support\Collection;

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
        ?array $meta = null
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

        $rows = $users
            ->filter(fn (User $user) => $this->shouldStoreNotification($user, $type))
            ->map(function (User $user) use ($organizationId, $senderId, $type, $title, $message, $meta) {
                $resolvedMeta = $this->resolveMeta($type, $meta);

                return [
                    'organization_id' => $organizationId,
                    'user_id' => (int) $user->id,
                    'sender_id' => $senderId,
                    'type' => $type,
                    'title' => $title,
                    'message' => $message,
                    // insert() bypasses Eloquent casts, so JSON must be encoded explicitly.
                    'meta' => $resolvedMeta ? json_encode($resolvedMeta) : null,
                    'is_read' => false,
                    'created_at' => now(),
                    'updated_at' => now(),
                ];
            })
            ->values()
            ->all();

        if (!empty($rows)) {
            AppNotification::insert($rows);
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
