<?php

namespace App\Services\Payroll;

use App\Models\Payroll;
use Illuminate\Support\Facades\Http;
use RuntimeException;

class StripePayrollPayoutService implements PayrollPayoutService
{
    public function payout(Payroll $payroll, ?string $simulateStatus = null): array
    {
        $secret = (string) config('services.stripe.secret');
        if ($secret === '') {
            throw new RuntimeException('Stripe secret key is not configured.');
        }

        $currency = strtolower((string) config('payroll.default_currency', 'inr'));
        $amountCents = max(1, (int) round(((float) $payroll->net_salary) * 100));
        $successUrl = (string) config('payroll.stripe_success_url', 'http://localhost:5173/payroll?payment=success');
        $cancelUrl = (string) config('payroll.stripe_cancel_url', 'http://localhost:5173/payroll?payment=cancelled');

        $request = Http::asForm()
            ->withToken($secret)
            ->timeout(30);

        $response = $request->post('https://api.stripe.com/v1/checkout/sessions', [
                'mode' => 'payment',
                'success_url' => $successUrl.'&payroll_id='.$payroll->id.'&checkout_session_id={CHECKOUT_SESSION_ID}',
                'cancel_url' => $cancelUrl.'&payroll_id='.$payroll->id,
                'customer_email' => (string) ($payroll->user?->email ?: ''),
                'line_items[0][quantity]' => 1,
                'line_items[0][price_data][currency]' => $currency,
                'line_items[0][price_data][unit_amount]' => $amountCents,
                'line_items[0][price_data][product_data][name]' => sprintf('Payroll payout for %s', $payroll->user?->name ?: 'Employee'),
                'line_items[0][price_data][product_data][description]' => 'Payroll month '.$payroll->payroll_month,
                'metadata[payroll_id]' => (string) $payroll->id,
                'metadata[employee_id]' => (string) $payroll->user_id,
                'metadata[payroll_month]' => (string) $payroll->payroll_month,
                'payment_intent_data[description]' => sprintf('Payroll payout for %s (%s)', $payroll->user?->name ?: 'Employee', $payroll->payroll_month),
                'payment_intent_data[metadata][payroll_id]' => (string) $payroll->id,
                'payment_intent_data[metadata][employee_id]' => (string) $payroll->user_id,
                'payment_intent_data[metadata][payroll_month]' => (string) $payroll->payroll_month,
            ]);

        if (!$response->successful()) {
            return [
                'provider' => 'stripe',
                'transaction_id' => null,
                'status' => 'failed',
                'raw_response' => [
                    'error' => 'Stripe API request failed',
                    'status' => $response->status(),
                    'body' => $response->json(),
                ],
            ];
        }

        $payload = $response->json();

        return [
            'provider' => 'stripe',
            'transaction_id' => $payload['id'] ?? null,
            'status' => 'pending',
            'checkout_url' => $payload['url'] ?? null,
            'raw_response' => $payload,
        ];
    }

    public function fetchCheckoutSession(string $checkoutSessionId): array
    {
        $secret = (string) config('services.stripe.secret');
        if ($secret === '') {
            throw new RuntimeException('Stripe secret key is not configured.');
        }

        $request = Http::withToken($secret)->timeout(30);

        $response = $request->get("https://api.stripe.com/v1/checkout/sessions/{$checkoutSessionId}", [
            'expand' => ['payment_intent'],
        ]);

        if (!$response->successful()) {
            throw new RuntimeException('Unable to fetch Stripe checkout session status.');
        }

        $payload = $response->json();
        if (!is_array($payload)) {
            throw new RuntimeException('Invalid Stripe checkout session response.');
        }

        return $payload;
    }

    public function verifyWebhookSignature(string $payload, string $signatureHeader): bool
    {
        $secret = (string) config('services.stripe.webhook_secret');
        if ($secret === '' || $signatureHeader === '') {
            return false;
        }

        $parts = collect(explode(',', $signatureHeader))
            ->mapWithKeys(function (string $part) {
                $pair = explode('=', trim($part), 2);
                return count($pair) === 2 ? [$pair[0] => $pair[1]] : [];
            });

        $timestamp = (string) $parts->get('t', '');
        $signature = (string) $parts->get('v1', '');
        if ($timestamp === '' || $signature === '') {
            return false;
        }

        $signedPayload = $timestamp.'.'.$payload;
        $expected = hash_hmac('sha256', $signedPayload, $secret);

        return hash_equals($expected, $signature);
    }

    public function mapStripeStatusToPayoutStatus(string $stripeStatus): string
    {
        return match ($stripeStatus) {
            'succeeded' => 'success',
            'processing', 'requires_action', 'requires_confirmation', 'requires_capture' => 'pending',
            default => 'failed',
        };
    }
}
