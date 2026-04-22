<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Monitoring\BrowserTrackingConnectionService;
use Illuminate\Http\Request;

class BrowserTrackingConnectionController extends Controller
{
    public function __construct(
        private readonly BrowserTrackingConnectionService $browserTrackingConnectionService,
    ) {
    }

    public function sync(Request $request)
    {
        $currentUser = $request->user();
        if (! $currentUser || ! $currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $validated = $request->validate([
            'device_id' => 'required|string|max:120',
            'device_label' => 'nullable|string|max:255',
            'ready' => 'required|boolean',
            'last_error' => 'nullable|string|max:255',
            'last_event_at' => 'nullable|date',
            'connections' => 'present|array',
            'connections.*.browser_name' => 'required|string|max:40',
            'connections.*.profile_key' => 'required|string|max:120',
            'connections.*.extension_origin' => 'nullable|string|max:255',
            'connections.*.extension_version' => 'nullable|string|max:40',
            'connections.*.paired_at' => 'nullable|date',
            'connections.*.last_seen_at' => 'nullable|date',
        ]);

        $connections = $this->browserTrackingConnectionService
            ->syncForUser($currentUser, $validated)
            ->map(fn ($connection) => [
                'id' => (int) $connection->id,
                'user_id' => (int) $connection->user_id,
                'organization_id' => (int) $connection->organization_id,
                'device_id' => (string) $connection->device_id,
                'device_label' => $connection->device_label,
                'browser_name' => (string) $connection->browser_name,
                'browser_profile_key' => (string) $connection->browser_profile_key,
                'extension_version' => $connection->extension_version,
                'status' => (string) $connection->status,
                'connected_at' => optional($connection->connected_at)?->toIso8601String(),
                'last_seen_at' => optional($connection->last_seen_at)?->toIso8601String(),
                'last_sync_at' => optional($connection->last_sync_at)?->toIso8601String(),
                'disconnected_at' => optional($connection->disconnected_at)?->toIso8601String(),
                'disconnect_reason' => $connection->disconnect_reason,
                'meta' => $connection->meta,
            ])
            ->values();

        return response()->json([
            'data' => $connections,
        ]);
    }
}
