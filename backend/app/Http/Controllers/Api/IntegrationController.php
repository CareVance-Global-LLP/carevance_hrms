<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ApiClient;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Services\Integrations\ApiClientService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;

/**
 * A customer administering their own integrations: API keys and webhooks.
 */
class IntegrationController extends Controller
{
    public function __construct(private readonly ApiClientService $apiClients)
    {
    }

    // ------------------------------------------------------------- api keys

    public function listKeys(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => [
                'available_scopes' => ApiClient::SCOPES,
                'keys' => ApiClient::query()
                    ->orderByDesc('id')
                    ->get()
                    ->map(fn (ApiClient $client) => [
                        'id' => $client->id,
                        'name' => $client->name,
                        // The prefix, never the key.
                        'key_prefix' => $client->key_prefix,
                        'scopes' => $client->scopes,
                        'is_usable' => $client->isUsable(),
                        'expires_at' => $client->expires_at?->toIso8601String(),
                        'last_used_at' => $client->last_used_at?->toIso8601String(),
                        'revoked_at' => $client->revoked_at?->toIso8601String(),
                    ])
                    ->all(),
            ],
        ]);
    }

    public function createKey(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            'scopes' => ['required', 'array', 'min:1'],
            'scopes.*' => ['string', 'in:'.implode(',', ApiClient::SCOPES)],
            'expires_at' => ['nullable', 'date', 'after:now'],
        ]);

        try {
            $issued = $this->apiClients->issue(
                $request->user()->organization,
                $validated['name'],
                $validated['scopes'],
                isset($validated['expires_at']) ? new \DateTimeImmutable($validated['expires_at']) : null,
                $request->user(),
            );
        } catch (\InvalidArgumentException $e) {
            return response()->json([
                'success' => false,
                'message' => $e->getMessage(),
                'error_code' => 'INVALID_SCOPES',
            ], 422);
        }

        return response()->json([
            'success' => true,
            'message' => 'Copy this key now — it is not shown again and cannot be recovered.',
            'data' => [
                'id' => $issued['client']->id,
                'name' => $issued['client']->name,
                'key' => $issued['key'],
                'scopes' => $issued['client']->scopes,
            ],
        ], 201);
    }

    public function revokeKey(Request $request, int $id): JsonResponse
    {
        $client = ApiClient::query()->find($id);

        if (! $client) {
            return $this->notFound('API key not found.');
        }

        $this->apiClients->revoke($client);

        return response()->json([
            'success' => true,
            'message' => 'Key revoked. Any system using it will stop working immediately.',
        ]);
    }

    // ------------------------------------------------------------- webhooks

    public function listWebhooks(Request $request): JsonResponse
    {
        return response()->json([
            'success' => true,
            'data' => [
                'available_events' => WebhookEndpoint::EVENTS,
                'endpoints' => WebhookEndpoint::query()
                    ->orderByDesc('id')
                    ->get()
                    ->map(fn (WebhookEndpoint $endpoint) => [
                        'id' => $endpoint->id,
                        'name' => $endpoint->name,
                        'url' => $endpoint->url,
                        'events' => $endpoint->events,
                        'is_active' => $endpoint->is_active,
                        'consecutive_failures' => $endpoint->consecutive_failures,
                        'disabled_at' => $endpoint->disabled_at?->toIso8601String(),
                        'disabled_reason' => $endpoint->disabled_reason,
                    ])
                    ->all(),
            ],
        ]);
    }

    public function createWebhook(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'name' => ['required', 'string', 'max:120'],
            // https only: the payload carries employee and payroll data, and a
            // signature does not make plaintext transport acceptable.
            'url' => ['required', 'url', 'starts_with:https://', 'max:2048'],
            'events' => ['required', 'array', 'min:1'],
            'events.*' => ['string', 'in:'.implode(',', WebhookEndpoint::EVENTS)],
        ]);

        $secret = 'whsec_'.Str::random(48);

        $endpoint = new WebhookEndpoint([
            'organization_id' => $request->user()->organization_id,
            'name' => $validated['name'],
            'url' => $validated['url'],
            'secret' => $secret,
            'events' => $validated['events'],
            'is_active' => true,
        ]);

        $endpoint->organization_id = (int) $request->user()->organization_id;
        $endpoint->save();

        return response()->json([
            'success' => true,
            'message' => 'Copy this signing secret now — it is not shown again.',
            'data' => [
                'id' => $endpoint->id,
                'signing_secret' => $secret,
                'signature_scheme' => 'HMAC-SHA256 over "{X-CareVance-Timestamp}.{raw body}", sent as X-CareVance-Signature.',
            ],
        ], 201);
    }

    /**
     * Re-enable an endpoint that was switched off after repeated failures.
     */
    public function enableWebhook(Request $request, int $id): JsonResponse
    {
        $endpoint = WebhookEndpoint::query()->find($id);

        if (! $endpoint) {
            return $this->notFound('Webhook endpoint not found.');
        }

        $endpoint->forceFill([
            'is_active' => true,
            'disabled_at' => null,
            'disabled_reason' => null,
            'consecutive_failures' => 0,
        ])->save();

        return response()->json(['success' => true, 'message' => 'Endpoint re-enabled.']);
    }

    public function deleteWebhook(Request $request, int $id): JsonResponse
    {
        $endpoint = WebhookEndpoint::query()->find($id);

        if (! $endpoint) {
            return $this->notFound('Webhook endpoint not found.');
        }

        $endpoint->delete();

        return response()->json(['success' => true, 'message' => 'Endpoint deleted.']);
    }

    /**
     * The dead-letter list.
     *
     * A queue nobody can see is the same as dropping the message.
     */
    public function deliveries(Request $request): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['nullable', 'string', 'in:pending,delivered,failed'],
        ]);

        return response()->json([
            'success' => true,
            'data' => WebhookDelivery::query()
                ->when($validated['status'] ?? null, fn ($q, $status) => $q->where('status', $status))
                ->orderByDesc('id')
                ->limit(200)
                ->get()
                ->map(fn (WebhookDelivery $delivery) => [
                    'id' => $delivery->id,
                    'endpoint_id' => $delivery->webhook_endpoint_id,
                    'event' => $delivery->event,
                    'status' => $delivery->status,
                    'attempts' => $delivery->attempts,
                    'response_status' => $delivery->response_status,
                    'error' => $delivery->error,
                    'delivered_at' => $delivery->delivered_at?->toIso8601String(),
                    'next_attempt_at' => $delivery->next_attempt_at?->toIso8601String(),
                    'created_at' => $delivery->created_at?->toIso8601String(),
                ])
                ->all(),
        ]);
    }

    private function notFound(string $message): JsonResponse
    {
        return response()->json([
            'success' => false,
            'message' => $message,
            'error_code' => 'NOT_FOUND',
        ], 404);
    }
}
