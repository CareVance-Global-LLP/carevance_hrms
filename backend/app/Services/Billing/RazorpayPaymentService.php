<?php

namespace App\Services\Billing;

use App\Models\Organization;
use App\Models\PaymentTransaction;
use Illuminate\Support\Facades\Config;
use Illuminate\Support\Facades\Log;
use Razorpay\Api\Api;

class RazorpayPaymentService
{
    private Api $api;

    public function __construct()
    {
        $keyId = Config::get('services.razorpay.key_id');
        $keySecret = Config::get('services.razorpay.key_secret');
        
        if (!$keyId || !$keySecret) {
            throw new \Exception('Razorpay credentials not configured');
        }
        
        $this->api = new Api($keyId, $keySecret);
    }

    /**
     * Create a Razorpay order for subscription payment
     */
    public function createOrder(Organization $organization, array $paymentData): array
    {
        try {
            $amount = $paymentData['amount'] * 100; // Convert to paise (Razorpay uses smallest currency unit)
            $currency = $paymentData['currency'] ?? 'INR';
            $receipt = 'order_' . $organization->id . '_' . time();

            $orderData = [
                'amount' => $amount,
                'currency' => $currency,
                'receipt' => $receipt,
                'notes' => [
                    'organization_id' => $organization->id,
                    'organization_name' => $organization->name,
                    'plan_code' => $paymentData['plan_code'] ?? $organization->plan_code,
                    'billing_cycle' => $paymentData['billing_cycle'] ?? $organization->billing_cycle,
                    'seats' => $paymentData['seats'] ?? $organization->max_seats,
                    'payment_type' => $paymentData['payment_type'] ?? 'subscription', // subscription, upgrade, add_seats
                ],
            ];

            $order = $this->api->order->create($orderData);

            // Store order details in database
            PaymentTransaction::create([
                'organization_id' => $organization->id,
                'provider' => 'razorpay',
                'provider_order_id' => $order->id,
                'amount' => $paymentData['amount'],
                'currency' => $currency,
                'status' => 'created',
                'payment_type' => $paymentData['payment_type'] ?? 'subscription',
                'metadata' => json_encode($orderData['notes']),
            ]);

            return [
                'success' => true,
                'order_id' => $order->id,
                'amount' => $amount,
                'currency' => $currency,
                'key_id' => Config::get('services.razorpay.key_id'),
            ];
        } catch (\Exception $e) {
            Log::error('Razorpay order creation failed', [
                'organization_id' => $organization->id,
                'error' => $e->getMessage(),
            ]);
            
            return [
                'success' => false,
                'message' => 'Failed to create payment order: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * Verify payment signature
     */
    public function verifyPayment(array $data): array
    {
        try {
            $razorpayOrderId = $data['razorpay_order_id'];
            $razorpayPaymentId = $data['razorpay_payment_id'];
            $razorpaySignature = $data['razorpay_signature'];

            // Verify signature
            $generatedSignature = hash_hmac(
                'sha256',
                $razorpayOrderId . '|' . $razorpayPaymentId,
                Config::get('services.razorpay.key_secret')
            );

            if (!hash_equals($generatedSignature, $razorpaySignature)) {
                return [
                    'success' => false,
                    'message' => 'Invalid payment signature',
                ];
            }

            // Fetch payment details from Razorpay
            $payment = $this->api->payment->fetch($razorpayPaymentId);

            if ($payment->status !== 'captured') {
                return [
                    'success' => false,
                    'message' => 'Payment not captured. Status: ' . $payment->status,
                ];
            }

            // Update transaction record
            $transaction = PaymentTransaction::where('provider_order_id', $razorpayOrderId)->first();
            
            if ($transaction) {
                $transaction->update([
                    'provider_payment_id' => $razorpayPaymentId,
                    'status' => 'completed',
                    'paid_at' => now(),
                    'provider_response' => json_encode($payment->toArray()),
                ]);
            }

            return [
                'success' => true,
                'payment_id' => $razorpayPaymentId,
                'order_id' => $razorpayOrderId,
                'amount' => $payment->amount / 100, // Convert back from paise
                'currency' => $payment->currency,
            ];
        } catch (\Exception $e) {
            Log::error('Razorpay payment verification failed', [
                'error' => $e->getMessage(),
            ]);
            
            return [
                'success' => false,
                'message' => 'Payment verification failed: ' . $e->getMessage(),
            ];
        }
    }

    /**
     * Verify webhook signature
     */
    public function verifyWebhookSignature(string $payload, string $signature): bool
    {
        $webhookSecret = Config::get('services.razorpay.webhook_secret');
        
        if (!$webhookSecret) {
            return false;
        }

        $expectedSignature = hash_hmac('sha256', $payload, $webhookSecret);
        
        return hash_equals($expectedSignature, $signature);
    }

    /**
     * Handle webhook events
     */
    public function handleWebhook(array $payload): array
    {
        $event = $payload['event'] ?? '';
        $entity = $payload['payload']['payment']['entity'] ?? [];

        Log::info('Razorpay webhook received', [
            'event' => $event,
            'payment_id' => $entity['id'] ?? null,
        ]);

        switch ($event) {
            case 'payment.captured':
                return $this->handlePaymentCaptured($entity);
                
            case 'payment.failed':
                return $this->handlePaymentFailed($entity);
                
            case 'order.paid':
                return $this->handleOrderPaid($payload['payload']['order']['entity'] ?? []);
                
            default:
                return [
                    'success' => true,
                    'message' => 'Event ignored: ' . $event,
                ];
        }
    }

    /**
     * Handle payment.captured webhook
     */
    private function handlePaymentCaptured(array $payment): array
    {
        $orderId = $payment['order_id'] ?? null;
        $paymentId = $payment['id'] ?? null;

        if (!$orderId) {
            return [
                'success' => false,
                'message' => 'No order ID in payment data',
            ];
        }

        $transaction = PaymentTransaction::where('provider_order_id', $orderId)->first();

        if (!$transaction) {
            return [
                'success' => false,
                'message' => 'Transaction not found for order: ' . $orderId,
            ];
        }

        // Update transaction
        $transaction->update([
            'provider_payment_id' => $paymentId,
            'status' => 'completed',
            'paid_at' => now(),
            'provider_response' => json_encode($payment),
        ]);

        return [
            'success' => true,
            'message' => 'Payment captured processed',
            'transaction_id' => $transaction->id,
        ];
    }

    /**
     * Handle payment.failed webhook
     */
    private function handlePaymentFailed(array $payment): array
    {
        $orderId = $payment['order_id'] ?? null;
        
        if ($orderId) {
            PaymentTransaction::where('provider_order_id', $orderId)
                ->update([
                    'status' => 'failed',
                    'provider_response' => json_encode($payment),
                ]);
        }

        return [
            'success' => true,
            'message' => 'Payment failure recorded',
        ];
    }

    /**
     * Handle order.paid webhook
     */
    private function handleOrderPaid(array $order): array
    {
        $orderId = $order['id'] ?? null;
        
        if ($orderId) {
            PaymentTransaction::where('provider_order_id', $orderId)
                ->update([
                    'status' => 'completed',
                    'paid_at' => now(),
                ]);
        }

        return [
            'success' => true,
            'message' => 'Order paid processed',
        ];
    }

    /**
     * Fetch payment details
     */
    public function fetchPayment(string $paymentId): ?array
    {
        try {
            $payment = $this->api->payment->fetch($paymentId);
            return $payment->toArray();
        } catch (\Exception $e) {
            Log::error('Failed to fetch Razorpay payment', [
                'payment_id' => $paymentId,
                'error' => $e->getMessage(),
            ]);
            return null;
        }
    }

    /**
     * Refund a payment
     */
    public function refundPayment(string $paymentId, ?float $amount = null): array
    {
        try {
            $refundData = [];
            
            if ($amount) {
                $refundData['amount'] = $amount * 100; // Convert to paise
            }

            $refund = $this->api->payment->fetch($paymentId)->refund($refundData);

            // Update transaction
            PaymentTransaction::where('provider_payment_id', $paymentId)
                ->update([
                    'status' => 'refunded',
                    'refunded_at' => now(),
                    'refund_amount' => $amount,
                ]);

            return [
                'success' => true,
                'refund_id' => $refund->id,
                'amount' => $amount,
            ];
        } catch (\Exception $e) {
            Log::error('Razorpay refund failed', [
                'payment_id' => $paymentId,
                'error' => $e->getMessage(),
            ]);
            
            return [
                'success' => false,
                'message' => 'Refund failed: ' . $e->getMessage(),
            ];
        }
    }
}
