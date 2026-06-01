<?php

namespace App\Services\Monitoring;

use App\Models\BrowserTrackingConnection;
use App\Models\User;
use App\Support\ExternalTimestamp;
use App\Services\AppNotificationService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

class BrowserTrackingConnectionService
{
    public function __construct(
        private readonly AppNotificationService $notificationService,
    ) {
    }

    /**
     * @return Collection<int, BrowserTrackingConnection>
     */
    public function syncForUser(User $user, array $payload): Collection
    {
        $deviceId = trim((string) ($payload['device_id'] ?? ''));
        $deviceLabel = trim((string) ($payload['device_label'] ?? ''));
        $ready = (bool) ($payload['ready'] ?? false);
        $disconnectReason = trim((string) ($payload['last_error'] ?? ''));
        $now = now();
        $connections = collect((array) ($payload['connections'] ?? []))
            ->map(function (array $connection) use ($payload, $now) {
                $fallbackLastSeenAt = $payload['last_event_at'] ?? null;

                return [
                    'browser_name' => trim(strtolower((string) ($connection['browser_name'] ?? ''))),
                    'browser_profile_key' => trim((string) ($connection['profile_key'] ?? '')),
                    'extension_version' => trim((string) ($connection['extension_version'] ?? '')) ?: null,
                    'connected_at' => $this->parseOptionalDate($connection['paired_at'] ?? null, $now),
                    'last_seen_at' => $this->parseOptionalDate($connection['last_seen_at'] ?? $fallbackLastSeenAt, $now),
                    'meta' => [
                        'extension_origin' => trim((string) ($connection['extension_origin'] ?? '')) ?: null,
                    ],
                ];
            })
            ->filter(fn (array $connection) => $connection['browser_name'] !== '' && $connection['browser_profile_key'] !== '')
            ->values();

        $existingConnections = BrowserTrackingConnection::query()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('device_id', $deviceId)
            ->get()
            ->keyBy(fn (BrowserTrackingConnection $connection) => $this->buildConnectionKey(
                (string) $connection->browser_name,
                (string) $connection->browser_profile_key,
            ));

        $reportedKeys = [];

        foreach ($connections as $connection) {
            $connectionKey = $this->buildConnectionKey(
                $connection['browser_name'],
                $connection['browser_profile_key'],
            );
            $reportedKeys[] = $connectionKey;

            $model = $existingConnections->get($connectionKey) ?? new BrowserTrackingConnection([
                'organization_id' => $user->organization_id,
                'user_id' => $user->id,
                'device_id' => $deviceId,
                'browser_name' => $connection['browser_name'],
                'browser_profile_key' => $connection['browser_profile_key'],
            ]);

            $model->fill([
                'device_label' => $deviceLabel !== '' ? $deviceLabel : null,
                'extension_version' => $connection['extension_version'],
                'status' => 'connected',
                'connected_at' => $model->connected_at ?? $connection['connected_at'],
                'last_seen_at' => $connection['last_seen_at'],
                'last_sync_at' => $now,
                'disconnected_at' => null,
                'disconnect_reason' => null,
                'meta' => $connection['meta'],
            ]);
            $model->save();
        }

        $nextDisconnectedStatus = $ready ? 'disconnected' : 'disabled';
        $nextDisconnectReason = $ready
            ? 'extension_missing'
            : ($disconnectReason !== '' ? $disconnectReason : 'bridge_unavailable');

        foreach ($existingConnections as $connectionKey => $existingConnection) {
            if (in_array($connectionKey, $reportedKeys, true)) {
                continue;
            }

            $previousStatus = (string) $existingConnection->status;
            $existingConnection->fill([
                'device_label' => $deviceLabel !== '' ? $deviceLabel : $existingConnection->device_label,
                'status' => $nextDisconnectedStatus,
                'last_sync_at' => $now,
                'disconnected_at' => $existingConnection->disconnected_at ?? $now,
                'disconnect_reason' => $nextDisconnectReason,
            ]);
            $existingConnection->save();

            if ($previousStatus === 'connected') {
                $this->sendDisconnectAlert($user, $existingConnection);
            }
        }

        return BrowserTrackingConnection::query()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $user->id)
            ->where('device_id', $deviceId)
            ->orderBy('browser_name')
            ->orderBy('browser_profile_key')
            ->get();
    }

    private function sendDisconnectAlert(User $user, BrowserTrackingConnection $connection): void
    {
        if (! $user->organization_id) {
            return;
        }

        $adminIds = User::query()
            ->where('organization_id', $user->organization_id)
            ->where(function ($q) {
                $q->whereHas('customRole', fn ($cr) => $cr->where('hierarchy_level', '<=', 10))
                    ->orWhere('role', 'admin');
            })
            ->pluck('id');

        $deviceLabel = trim((string) ($connection->device_label ?? '')) ?: 'the desktop app';
        $browserName = trim((string) ($connection->browser_name ?? '')) ?: 'browser tracking';

        $this->notificationService->sendToUsers(
            organizationId: (int) $user->organization_id,
            userIds: $adminIds,
            senderId: (int) $user->id,
            type: 'browser_tracking_disconnected',
            title: 'Browser Tracking Disconnected',
            message: sprintf(
                '%s browser tracking disconnected for %s on %s.',
                ucfirst($browserName),
                $user->name,
                $deviceLabel,
            ),
            meta: [
                'route' => '/monitoring/website-usage',
                'employee_id' => (int) $user->id,
                'device_id' => (string) $connection->device_id,
                'browser_name' => (string) $connection->browser_name,
            ],
        );
    }

    private function parseOptionalDate(mixed $value, Carbon $fallback): Carbon
    {
        $rawValue = trim((string) ($value ?? ''));
        if ($rawValue === '') {
            return $fallback->copy();
        }

        return ExternalTimestamp::parseToAppTimezone($rawValue);
    }

    private function buildConnectionKey(string $browserName, string $profileKey): string
    {
        return trim(strtolower($browserName)).'|'.trim($profileKey);
    }
}
