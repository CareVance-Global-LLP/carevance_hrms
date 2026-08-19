<?php

namespace App\Jobs;

use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Services\Integrations\WebhookDispatcher;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\SerializesModels;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

/**
 * One HTTP attempt at one webhook delivery.
 *
 * `tries = 1` and the retry is re-dispatched by hand rather than left to the
 * queue's own retry. That is deliberate: the delivery row is the record a
 * customer looks at when they ask "did you send it", and letting the queue
 * retry invisibly would leave that row saying "1 attempt" after five.
 */
class DeliverWebhook implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 1;

    public int $timeout = 30;

    /** Give up after this many attempts and leave it in the dead-letter list. */
    public const MAX_ATTEMPTS = 5;

    public function __construct(public int $deliveryId)
    {
    }

    public function handle(): void
    {
        $delivery = WebhookDelivery::withoutOrganizationScope()->find($this->deliveryId);

        if (! $delivery || $delivery->status === 'delivered') {
            return;
        }

        $endpoint = WebhookEndpoint::withoutOrganizationScope()->find($delivery->webhook_endpoint_id);

        if (! $endpoint) {
            $delivery->update([
                'status' => 'failed',
                'error' => 'The endpoint was deleted before this could be delivered.',
                'next_attempt_at' => null,
            ]);

            return;
        }

        $attempt = $delivery->attempts + 1;
        $timestamp = now()->timestamp;

        $body = json_encode([
            'event' => $delivery->event,
            'delivery_id' => $delivery->id,
            'occurred_at' => $delivery->created_at?->toIso8601String(),
            'data' => $delivery->payload,
        ], JSON_UNESCAPED_SLASHES);

        try {
            $response = Http::timeout(15)
                ->withHeaders([
                    'Content-Type' => 'application/json',
                    'User-Agent' => 'CareVance-Webhook/1',
                    'X-CareVance-Event' => $delivery->event,
                    'X-CareVance-Delivery' => (string) $delivery->id,
                    'X-CareVance-Timestamp' => (string) $timestamp,
                    'X-CareVance-Signature' => WebhookDispatcher::signature(
                        (string) $endpoint->secret,
                        $timestamp,
                        $body
                    ),
                ])
                ->withBody($body, 'application/json')
                ->post($endpoint->url);

            if ($response->successful()) {
                $delivery->update([
                    'status' => 'delivered',
                    'attempts' => $attempt,
                    'response_status' => $response->status(),
                    'delivered_at' => now(),
                    'next_attempt_at' => null,
                    'error' => null,
                ]);

                // A success clears the failure streak — an endpoint that
                // recovers should not be disabled by history.
                if ($endpoint->consecutive_failures > 0) {
                    $endpoint->update(['consecutive_failures' => 0]);
                }

                return;
            }

            $this->recordFailure($delivery, $endpoint, $attempt, "HTTP {$response->status()}", $response->status());
        } catch (\Throwable $e) {
            $this->recordFailure($delivery, $endpoint, $attempt, $e->getMessage(), null);
        }
    }

    private function recordFailure(
        WebhookDelivery $delivery,
        WebhookEndpoint $endpoint,
        int $attempt,
        string $error,
        ?int $status,
    ): void {
        $exhausted = $attempt >= self::MAX_ATTEMPTS;

        $delivery->update([
            'status' => $exhausted ? 'failed' : 'pending',
            'attempts' => $attempt,
            'response_status' => $status,
            'error' => mb_substr($error, 0, 1000),
            'next_attempt_at' => $exhausted
                ? null
                : now()->addSeconds(WebhookDispatcher::backoffSeconds($attempt)),
        ]);

        if (! $exhausted) {
            self::dispatch($delivery->id)
                ->delay(now()->addSeconds(WebhookDispatcher::backoffSeconds($attempt)));

            return;
        }

        $failures = $endpoint->consecutive_failures + 1;

        $endpoint->update(['consecutive_failures' => $failures]);

        /*
         * Switch off an endpoint that has failed repeatedly.
         *
         * Not a courtesy to us — retrying a dead URL forever turns one
         * customer's broken integration into everyone's queue backlog, and
         * the queue is the same one payroll runs through.
         */
        if ($failures >= WebhookEndpoint::FAILURE_LIMIT) {
            $endpoint->update([
                'disabled_at' => now(),
                'disabled_reason' => 'Disabled automatically after '
                    .WebhookEndpoint::FAILURE_LIMIT.' consecutive failed deliveries. '
                    .'Fix the endpoint and re-enable it.',
            ]);

            Log::warning('Webhook endpoint disabled after repeated failures', [
                'endpoint_id' => $endpoint->id,
                'organization_id' => $endpoint->organization_id,
            ]);
        }
    }
}
