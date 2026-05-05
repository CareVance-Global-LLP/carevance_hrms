<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Payroll;
use App\Models\PayrollAllowance;
use App\Models\PayrollDeduction;
use App\Models\PayrollStructure;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMiddleware;
use Tests\TestCase;

class PayrollWorkflowTest extends TestCase
{
    use RefreshDatabase;
    use WithoutMiddleware;

    public function test_admin_can_generate_edit_process_and_mock_payroll_payout(): void
    {
        config()->set('payroll.mode', 'mock');

        $org = Organization::create([
            'name' => 'Test Org',
            'slug' => 'test-org',
        ]);

        $admin = User::create([
            'name' => 'Admin',
            'email' => 'admin@test.com',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);

        $employee = User::create([
            'name' => 'Employee',
            'email' => 'employee@test.com',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
        ]);

        $structure = PayrollStructure::create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'basic_salary' => 50000,
            'currency' => 'INR',
            'effective_from' => now()->startOfMonth()->toDateString(),
            'is_active' => true,
        ]);

        PayrollAllowance::create([
            'payroll_structure_id' => $structure->id,
            'name' => 'HRA',
            'calculation_type' => 'fixed',
            'amount' => 5000,
        ]);

        PayrollDeduction::create([
            'payroll_structure_id' => $structure->id,
            'name' => 'PF',
            'calculation_type' => 'fixed',
            'amount' => 1500,
        ]);

        $month = now()->format('Y-m');

        $this->actingAs($admin)
            ->postJson('/api/payroll/records/generate', [
                'payroll_month' => $month,
                'user_id' => $employee->id,
            ])
            ->assertStatus(200)
            ->assertJson([
                'generated_count' => 1,
                'skipped_count' => 0,
            ]);

        $payroll = Payroll::where('organization_id', $org->id)->firstOrFail();
        $this->assertSame(53500.0, (float) $payroll->net_salary);

        $this->actingAs($admin)
            ->patchJson("/api/payroll/records/{$payroll->id}", [
                'bonus' => 2000,
                'tax' => 3000,
            ])
            ->assertStatus(200);

        $payroll->refresh();
        $this->assertSame(52500.0, (float) $payroll->net_salary);

        $this->actingAs($admin)
            ->postJson("/api/payroll/records/{$payroll->id}/status", [
                'payroll_status' => 'processed',
            ])
            ->assertStatus(200);

        $this->actingAs($admin)
            ->postJson("/api/payroll/records/{$payroll->id}/payout", [
                'simulate_status' => 'success',
                'payout_method' => 'mock',
            ])
            ->assertStatus(200)
            ->assertJsonPath('transaction.status', 'success');

        $payroll->refresh();
        $this->assertSame('paid', $payroll->payroll_status);
        $this->assertSame('success', $payroll->payout_status);
    }
}

