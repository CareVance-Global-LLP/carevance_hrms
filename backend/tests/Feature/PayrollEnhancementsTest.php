<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\Payroll;
use App\Models\PayrollAdjustment;
use App\Models\PayrollProfile;
use App\Models\PayrollStructure;
use App\Models\PayrollTaxDeclaration;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMiddleware;
use Tests\TestCase;

class PayrollEnhancementsTest extends TestCase
{
    use RefreshDatabase;
    use WithoutMiddleware;

    public function test_generate_records_applies_approved_adjustments_and_compliance_breakdown(): void
    {
        config()->set('payroll.mode', 'mock');

        [$org, $admin, $employee] = $this->baseSetup();
        PayrollStructure::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'basic_salary' => 30000,
            'currency' => 'INR',
            'effective_from' => now()->startOfMonth()->toDateString(),
            'is_active' => true,
        ]);

        PayrollProfile::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'payroll_code' => 'EMP-001',
            'pay_group' => 'Monthly',
            'payout_method' => 'bank_transfer',
            'bank_account_number' => '1234567890',
            'bank_ifsc_swift' => 'TEST0001',
            'bank_verification_status' => 'verified',
            'tax_identifier' => 'ABCDE1234F',
            'pan_or_tax_id' => 'ABCDE1234F',
            'tax_regime' => 'new',
            'pf_account_number' => 'PF-123',
            'uan' => 'UAN-123',
            'payroll_eligible' => true,
            'reimbursements_eligible' => true,
            'is_active' => true,
            'bonus_amount' => 500,
            'tax_amount' => 0,
        ]);

        PayrollTaxDeclaration::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'financial_year' => now()->month >= 4 ? now()->year.'-'.(now()->year + 1) : (now()->year - 1).'-'.now()->year,
            'tax_regime' => 'new',
            'status' => 'approved',
            'sections' => ['investments' => ['total' => 0]],
            'approved_snapshot' => ['investments' => ['total' => 0]],
        ]);

        $month = now()->format('Y-m');
        PayrollAdjustment::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'title' => 'Performance Bonus',
            'kind' => 'bonus',
            'source' => 'manual',
            'effective_month' => $month,
            'amount' => 2000,
            'currency' => 'INR',
            'status' => 'approved',
        ]);
        PayrollAdjustment::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'title' => 'Meal Penalty',
            'kind' => 'manual_deduction',
            'source' => 'manager_override',
            'effective_month' => $month,
            'amount' => 300,
            'currency' => 'INR',
            'status' => 'approved',
        ]);

        $response = $this->actingAs($admin)
            ->postJson('/api/payroll/records/generate', [
                'payroll_month' => $month,
                'user_id' => $employee->id,
                'payout_method' => 'bank_transfer',
            ])
            ->assertOk();

        $record = $response->json('generated.0');
        $this->assertSame('bank_transfer', $record['payout_method']);
        $this->assertSame(2000.0, (float) data_get($record, 'adjustment_breakdown.earnings_total'));
        $this->assertSame(300.0, (float) data_get($record, 'adjustment_breakdown.deductions_total'));
        $this->assertSame(1800.0, (float) data_get($record, 'compliance_breakdown.totals.employee_deductions'));
        $this->assertSame(1800.0, (float) data_get($record, 'compliance_breakdown.totals.employer_contributions'));
    }

    public function test_tax_declaration_review_updates_profile_status(): void
    {
        [$org, $admin, $employee] = $this->baseSetup();

        $profile = PayrollProfile::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'payroll_code' => 'EMP-002',
            'pay_group' => 'Monthly',
            'payout_method' => 'mock',
            'tax_identifier' => 'ABCDE1234F',
            'payroll_eligible' => true,
            'reimbursements_eligible' => true,
            'is_active' => true,
        ]);

        $declarationResponse = $this->actingAs($admin)
            ->postJson('/api/payroll/workspace/tax-declarations', [
                'user_id' => $employee->id,
                'payroll_profile_id' => $profile->id,
                'financial_year' => '2026-2027',
                'tax_regime' => 'new',
                'status' => 'submitted',
                'sections' => ['investments' => ['total' => 150000]],
            ])
            ->assertCreated();

        $declarationId = (int) $declarationResponse->json('id');

        $this->actingAs($admin)
            ->postJson("/api/payroll/workspace/tax-declarations/{$declarationId}/approve")
            ->assertOk()
            ->assertJsonPath('status', 'approved');

        $profile->refresh();
        $this->assertSame('approved', $profile->declaration_status);
        $this->assertSame('new', $profile->tax_regime);
    }

    public function test_pay_run_can_move_through_validation_and_finance_approval(): void
    {
        config()->set('payroll.mode', 'mock');

        [$org, $admin, $employee] = $this->baseSetup();
        PayrollStructure::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'basic_salary' => 10000,
            'currency' => 'INR',
            'effective_from' => now()->startOfMonth()->toDateString(),
            'is_active' => true,
        ]);

        $month = now()->format('Y-m');
        $this->actingAs($admin)
            ->postJson('/api/payroll/records/generate', [
                'payroll_month' => $month,
                'user_id' => $employee->id,
            ])
            ->assertOk();

        $runId = (int) $this->actingAs($admin)
            ->getJson("/api/payroll/workspace/runs?payroll_month={$month}")
            ->assertOk()
            ->json('data.0.id');

        $this->actingAs($admin)
            ->postJson("/api/payroll/workspace/runs/{$runId}/status", ['status' => 'validated'])
            ->assertOk()
            ->assertJsonPath('status', 'validated');

        $this->actingAs($admin)
            ->postJson("/api/payroll/workspace/runs/{$runId}/status", ['status' => 'manager_approved'])
            ->assertOk()
            ->assertJsonPath('status', 'manager_approved');

        $this->actingAs($admin)
            ->postJson("/api/payroll/workspace/runs/{$runId}/status", ['status' => 'finance_approved'])
            ->assertOk()
            ->assertJsonPath('status', 'finance_approved');
    }

    public function test_payroll_workspace_reports_load_successfully(): void
    {
        [$org, $admin, $employee] = $this->baseSetup();

        PayrollProfile::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'payroll_code' => 'EMP-REPORT-001',
            'pay_group' => 'Monthly',
            'payout_method' => 'mock',
            'tax_identifier' => 'ABCDE1234F',
            'payroll_eligible' => true,
            'reimbursements_eligible' => true,
            'is_active' => true,
        ]);

        Payroll::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'payroll_month' => now()->format('Y-m'),
            'basic_salary' => 25000,
            'allowances' => 2500,
            'deductions' => 500,
            'bonus' => 1000,
            'tax' => 1500,
            'net_salary' => 26500,
            'payment_status' => 'pending',
            'payroll_status' => 'draft',
        ]);

        $this->actingAs($admin)
            ->getJson('/api/payroll/workspace/reports?payroll_month='.now()->format('Y-m'))
            ->assertOk()
            ->assertJsonStructure([
                'monthly_summary',
                'monthly_trend',
                'component_totals',
                'employee_payroll_sheet',
                'department_payroll_cost',
                'deductions_report',
                'tax_report',
                'compliance_report',
                'payout_status_report',
            ]);
    }

    private function baseSetup(): array
    {
        $org = Organization::query()->create([
            'name' => 'Enhanced Payroll Org',
            'slug' => 'enhanced-payroll-org',
        ]);

        $admin = User::query()->create([
            'name' => 'Enhanced Admin',
            'email' => 'enhanced-admin@test.com',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $org->id,
        ]);

        $employee = User::query()->create([
            'name' => 'Enhanced Employee',
            'email' => 'enhanced-employee@test.com',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
        ]);

        return [$org, $admin, $employee];
    }
}
