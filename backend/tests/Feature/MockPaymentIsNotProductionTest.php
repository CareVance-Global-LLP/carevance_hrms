<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The development shortcut must not exist in production.
 *
 * `POST /billing/mock-pay` activates a paid subscription with no payment at
 * all. It is admin-gated, which is not a defence: the admin is exactly the
 * person who benefits from never paying, and every tenant has one.
 *
 * The same controller already gets this right one method away —
 * verifyRazorpayPayment's `mock_order_` branch is guarded by
 * `app()->environment('local', 'testing')`. This holds mockPay to that
 * standard rather than inventing a new one.
 */
class MockPaymentIsNotProductionTest extends TestCase
{
    use RefreshDatabase;

    private function adminOfUnpaidOrg(): array
    {
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

    public function test_mock_pay_is_refused_in_production(): void
    {
        [$organization, $admin] = $this->adminOfUnpaidOrg();

        app()->detectEnvironment(fn () => 'production');

        $response = $this->actingAs($admin)->postJson('/api/billing/mock-pay');

        $response->assertStatus(404);

        $this->assertSame(
            'inactive',
            $organization->fresh()->subscription_status,
            'an admin in production must not be able to grant themselves a paid plan'
        );
    }

    public function test_mock_pay_still_works_in_testing(): void
    {
        [$organization, $admin] = $this->adminOfUnpaidOrg();

        // The shortcut exists for a reason; removing it outright would break
        // local development and this suite.
        $this->actingAs($admin)->postJson('/api/billing/mock-pay')->assertOk();

        $this->assertSame('active', $organization->fresh()->subscription_status);
    }
}
