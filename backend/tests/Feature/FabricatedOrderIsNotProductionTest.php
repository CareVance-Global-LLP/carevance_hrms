<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * An order that does not exist must not be reported as created.
 *
 * `createRazorpayOrder` had three separate exits returning
 * `success: true` with `'order_id' => 'mock_order_' . time()` — when the keys
 * were absent or still placeholders, when the service reported credentials
 * missing, and on literally any other exception. None of them checked the
 * environment.
 *
 * Since the verification endpoint's `mock_order_` branch IS gated to
 * local/testing, a production customer was handed a fabricated order id,
 * told it succeeded, and then refused when they tried to pay against it. The
 * failure surfaced one step later than it happened, which is the expensive
 * place for it to surface.
 *
 * The mock path is genuinely useful in development, so it stays there.
 */
class FabricatedOrderIsNotProductionTest extends TestCase
{
    use RefreshDatabase;

    private function payingAdmin(): User
    {
        // Razorpay deliberately unconfigured — the production condition.
        config(['services.razorpay.key_id' => null, 'services.razorpay.key_secret' => null]);

        $organization = Organization::factory()->create([
            'subscription_status' => 'inactive',
            'subscription_intent' => 'paid',
            // The billing profile is checked before any of this, so it has to
            // be complete or the test never reaches the code under test.
            'address_line' => '1 Residency Road',
            'city' => 'Bengaluru',
            'state' => 'Karnataka',
            'postal_code' => '560025',
            'country' => 'India',
        ]);

        return User::factory()->create([
            'organization_id' => $organization->id,
            'role' => 'admin',
        ]);
    }

    public function test_production_does_not_fabricate_an_order_when_the_gateway_is_unconfigured(): void
    {
        $admin = $this->payingAdmin();

        app()->detectEnvironment(fn () => 'production');

        $response = $this->actingAs($admin)->postJson('/api/billing/razorpay/create-order', [
            'amount' => 4999,
        ]);

        $this->assertNotSame(
            true,
            $response->json('success'),
            'a gateway that cannot create an order has not created one'
        );

        $this->assertStringNotContainsString(
            'mock_order_',
            (string) json_encode($response->json()),
            'a fabricated order id must never reach a paying customer'
        );
    }

    public function test_development_still_gets_its_mock_order(): void
    {
        $admin = $this->payingAdmin();

        $response = $this->actingAs($admin)->postJson('/api/billing/razorpay/create-order', [
            'amount' => 4999,
        ]);

        $response->assertOk();
        $this->assertStringContainsString(
            'mock_order_',
            (string) json_encode($response->json()),
            'the development shortcut must keep working where development happens'
        );
    }
}
