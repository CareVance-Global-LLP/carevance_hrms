<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * A payment that could not be verified is not a payment.
 *
 * `verifyRazorpayPayment` wrapped the gateway call in a try/catch whose catch
 * block called activateSubscription() and returned "Payment verified
 * successfully." The comment above it read "Fall back to mock payment success
 * on error."
 *
 * RazorpayPaymentService's constructor throws when the credentials are absent,
 * so on any deployment where the gateway is not configured — which is every
 * deployment before someone sets the keys — the catch was the ONLY path that
 * ever ran. Posting the endpoint granted a paid plan for free, and said so
 * convincingly.
 *
 * The mock path above it is gated to local/testing and is left alone; this is
 * about what happens when the real gateway cannot answer.
 */
class BillingGatewayFailureTest extends TestCase
{
    use RefreshDatabase;

    private function unconfiguredOrgAndAdmin(): array
    {
        // The exact production condition: no keys, so the service constructor
        // throws before any verification can happen.
        config(['services.razorpay.key_id' => null, 'services.razorpay.key_secret' => null]);

        $organization = Organization::factory()->create([
            'subscription_status' => 'inactive',
            'subscription_intent' => 'paid',
        ]);

        $admin = User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'admin',
        ]);

        return [$organization, $admin];
    }

    public function test_an_unverifiable_payment_does_not_activate_the_subscription(): void
    {
        [$organization, $admin] = $this->unconfiguredOrgAndAdmin();

        $this->actingAs($admin)->postJson('/api/billing/razorpay/verify-payment', [
            'razorpay_order_id' => 'order_NoSuchOrder',
            'razorpay_payment_id' => 'pay_NoSuchPayment',
            'razorpay_signature' => 'not-a-real-signature',
        ]);

        $this->assertSame(
            'inactive',
            $organization->fresh()->subscription_status,
            'a gateway that could not verify the payment must not grant a paid plan'
        );
    }

    public function test_it_does_not_report_success_for_a_payment_it_could_not_verify(): void
    {
        [, $admin] = $this->unconfiguredOrgAndAdmin();

        $response = $this->actingAs($admin)->postJson('/api/billing/razorpay/verify-payment', [
            'razorpay_order_id' => 'order_NoSuchOrder',
            'razorpay_payment_id' => 'pay_NoSuchPayment',
            'razorpay_signature' => 'not-a-real-signature',
        ]);

        $response->assertStatus(422);
        $this->assertFalse(
            (bool) ($response->json('success') ?? false),
            'telling the payer their payment succeeded is worse than the failure itself'
        );
    }

    public function test_no_expiry_is_written_when_verification_fails(): void
    {
        [$organization, $admin] = $this->unconfiguredOrgAndAdmin();

        $this->actingAs($admin)->postJson('/api/billing/razorpay/verify-payment', [
            'razorpay_order_id' => 'order_NoSuchOrder',
            'razorpay_payment_id' => 'pay_NoSuchPayment',
            'razorpay_signature' => 'not-a-real-signature',
        ]);

        $this->assertNull(
            $organization->fresh()->subscription_expires_at,
            'an unverified payment must not buy a period'
        );
    }
}
