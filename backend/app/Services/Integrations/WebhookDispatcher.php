<?php

namespace App\Services\Integrations;

use App\Jobs\DeliverWebhook;
use App\Models\Organization;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;

/**
 * Tells a customer's own system that something happened here.
 *
 * The product had no outbound webhooks at all, so every integration a customer
 * wanted was a person exporting a CSV. That erases the labour saving the
 * purchase is justified by.
 *
 * Dispatching queues a delivery row and a job; it never makes an HTTP call
 * inline. A customer's slow endpoint must not be able to hold open a request
 * in our application — that turns their outage into ours.
 */
class WebhookDispatcher
{
    /**
     * Queue this event to every endpoint in the organisation listening for it.
     *
     * Deliberately swallows its own failures. A webhook is a courtesy to a
     * third-party system; it must never be the reason an employee record fails
     * to save or a payroll run fails to approve.
     *
     * @param  array<string, mixed>  $payload
     * @return int  how many deliveries were queued
     */
    public function dispatch(?int $organizationId, string $event, array $payload): int
    {
        if ($organizationId === null || ! in_array($event, WebhookEndpoint::EVENTS, true)) {
            return 0;
        }

        try {
            $endpoints = WebhookEndpoint::forOrganization($organizationId)
                ->where('is_active', true)
                ->whereNull('disabled_at')
                ->get()
                ->filter(fn (WebhookEndpoint $endpoint) => $endpoint->isListeningFor($event));

            $queued = 0;

            foreach ($endpoints as $endpoint) {
                $delivery = new WebhookDelivery([
                    'organization_id' => $organizationId,
                    'webhook_endpoint_id' => $endpoint->id,
                    'event' => $event,
                    'payload' => $payload,
                    'status' => 'pending',
                    'attempts' => 0,
                    'next_attempt_at' => now(),
                ]);

                // Set explicitly: this runs from observers and jobs where the
                // ambient organisation may be absent or, worse, someone else's.
                $delivery->organization_id = $organizationId;
                $delivery->save();

                DeliverWebhook::dispatch($delivery->id);
                $queued++;
            }

            return $queued;
        } catch (\Throwable $e) {
            \Log::warning('Webhook dispatch failed', [
                'event' => $event,
                'organization_id' => $organizationId,
                'error' => $e->getMessage(),
            ]);

            return 0;
        }
    }

    /**
     * The signature a receiver checks.
     *
     * Timestamped and signed over `timestamp.body`, not over the body alone —
     * signing the body by itself makes every delivery replayable forever by
     * anyone who captures one.
     */
    public static function signature(string $secret, int $timestamp, string $body): string
    {
        return hash_hmac('sha256', $timestamp.'.'.$body, $secret);
    }

    /**
     * Backoff for attempt N, in seconds: 1m, 5m, 25m, 2h, 10h.
     *
     * Exponential rather than fixed because the common failure is a customer
     * deploying, and hammering a box that is already restarting helps nobody.
     */
    public static function backoffSeconds(int $attempt): int
    {
        return (int) min(60 * (5 ** max(0, $attempt - 1)), 36000);
    }

    /**
     * Convenience for the observers, which have a model but not an org id.
     */
    public function dispatchFor(?Organization $organization, string $event, array $payload): int
    {
        return $this->dispatch($organization?->id, $event, $payload);
    }
}
