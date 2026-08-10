<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Tests\TestCase;

/**
 * The rest of the suite runs with payroll.dev_mode on, because payroll feature
 * tests are about payroll, not billing — without it they 403 at the gate before
 * reaching anything they mean to assert.
 *
 * This is the one place that turns it back off, so the gate itself stays
 * covered. Previously nothing tested it at all.
 */
class PayrollPlanGateTest extends TestCase
{
    use RefreshDatabase;

    private function makeAdminWithoutPayrollPlan(): User
    {
        $organization = Organization::create([
            'name' => 'No Payroll Plan Org',
            'slug' => 'no-payroll-plan-org',
        ]);

        return User::create([
            'name' => 'Admin',
            'email' => 'plan-gate-admin@example.com',
            'password' => Hash::make('password123'),
            'role' => 'admin',
            'organization_id' => $organization->id,
        ]);
    }

    public function test_payroll_routes_are_blocked_when_the_plan_lacks_the_feature(): void
    {
        config()->set('payroll.dev_mode', false);

        $admin = $this->makeAdminWithoutPayrollPlan();

        $this->getJson('/api/payroll/all-employees', $this->apiHeadersFor($admin))
            ->assertForbidden()
            ->assertJsonPath('error_code', 'PLAN_FEATURE_UNAVAILABLE');
    }

    public function test_dev_mode_bypasses_the_plan_gate(): void
    {
        config()->set('payroll.dev_mode', true);

        $admin = $this->makeAdminWithoutPayrollPlan();

        $this->getJson('/api/payroll/all-employees', $this->apiHeadersFor($admin))
            ->assertOk();
    }

    public function test_the_gate_reads_config_so_it_survives_config_caching(): void
    {
        // Regression lock. Both payroll middlewares used to read
        // env('PAYROLL_DEV_MODE') directly. env() returns its default once a
        // deploy runs `php artisan config:cache`, so the flag silently stopped
        // working in production with no error to trace.
        config()->set('payroll.dev_mode', false);
        putenv('PAYROLL_DEV_MODE=true');

        try {
            $admin = $this->makeAdminWithoutPayrollPlan();

            $this->getJson('/api/payroll/all-employees', $this->apiHeadersFor($admin))
                ->assertForbidden();
        } finally {
            putenv('PAYROLL_DEV_MODE');
        }
    }
}
