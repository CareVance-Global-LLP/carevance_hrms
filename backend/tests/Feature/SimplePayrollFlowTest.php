<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\Organization;
use App\Models\PayRun;
use App\Models\PayrollProfile;
use App\Models\Payslip;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\WithoutMiddleware;
use Tests\TestCase;

class SimplePayrollFlowTest extends TestCase
{
    use RefreshDatabase;
    use WithoutMiddleware;

    public function test_fixed_monthly_salary_generates_review_run_and_prevents_duplicate_runs(): void
    {
        [$org, $admin, $employee] = $this->baseSetup('fixed-full');
        $month = now()->format('Y-m');
        $this->salaryProfile($org, $employee, ['salary_type' => 'fixed_monthly', 'monthly_salary' => 2000, 'working_days' => 2]);
        $this->attendance($org, $employee, $month, 1, 8);
        $this->attendance($org, $employee, $month, 2, 8);

        $response = $this->actingAs($admin)
            ->postJson('/api/payroll/runs/generate', ['month' => $month])
            ->assertOk();

        $this->assertSame('review', $response->json('run.status'));
        $this->assertSame(1, PayRun::query()->where('organization_id', $org->id)->where('payroll_month', $month)->count());
        $this->assertSame(2000.0, (float) $response->json('run.net_pay'));

        $this->actingAs($admin)
            ->postJson('/api/payroll/runs/generate', ['month' => $month])
            ->assertOk();

        $this->assertSame(1, PayRun::query()->where('organization_id', $org->id)->where('payroll_month', $month)->count());
    }

    public function test_fixed_monthly_salary_with_lop_bonus_approval_lock_and_payslip_generation(): void
    {
        [$org, $admin, $employee] = $this->baseSetup('fixed-lop');
        $month = now()->format('Y-m');
        $this->salaryProfile($org, $employee, ['salary_type' => 'fixed_monthly', 'monthly_salary' => 2000, 'working_days' => 2]);
        $this->attendance($org, $employee, $month, 1, 8);

        $this->actingAs($admin)
            ->postJson('/api/payroll/adjustments', [
                'user_id' => $employee->id,
                'month' => $month,
                'type' => 'bonus',
                'amount' => 200,
                'reason' => 'Monthly performance bonus',
            ])
            ->assertCreated();

        $runId = (int) $this->actingAs($admin)
            ->postJson('/api/payroll/runs/generate', ['month' => $month])
            ->assertOk()
            ->json('run.id');

        $item = $this->actingAs($admin)
            ->getJson("/api/payroll/runs/{$runId}")
            ->assertOk()
            ->json('items.0');

        $this->assertSame(1000.0, (float) data_get($item, 'breakdown.lop_deduction'));
        $this->assertSame(200.0, (float) data_get($item, 'breakdown.bonus'));
        $this->assertSame(1200.0, (float) data_get($item, 'net_pay'));

        $this->actingAs($admin)->postJson("/api/payroll/runs/{$runId}/approve")->assertOk();
        $this->actingAs($admin)->postJson("/api/payroll/runs/{$runId}/mark-paid")->assertOk();

        $this->assertDatabaseHas('payslips', [
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'period_month' => $month,
            'payment_status' => 'paid',
            'publish_status' => 'published',
        ]);

        $this->actingAs($admin)
            ->postJson('/api/payroll/runs/generate', ['month' => $month])
            ->assertStatus(422);
    }

    public function test_hourly_salary_uses_approved_worked_hours(): void
    {
        [$org, $admin, $employee] = $this->baseSetup('hourly');
        $month = now()->format('Y-m');
        $this->salaryProfile($org, $employee, ['salary_type' => 'hourly', 'hourly_rate' => 100, 'working_days' => 2]);
        $this->attendance($org, $employee, $month, 1, 10);

        $runId = (int) $this->actingAs($admin)
            ->postJson('/api/payroll/runs/generate', ['month' => $month])
            ->assertOk()
            ->json('run.id');

        $item = $this->actingAs($admin)->getJson("/api/payroll/runs/{$runId}")->assertOk()->json('items.0');

        $this->assertSame('hourly', data_get($item, 'salary_type'));
        $this->assertSame(10.0, (float) data_get($item, 'approved_worked_hours'));
        $this->assertSame(1000.0, (float) data_get($item, 'net_pay'));
        $this->assertSame('ready', data_get($item, 'status'));
    }

    public function test_exception_items_block_payroll_approval(): void
    {
        [$org, $admin, $employee] = $this->baseSetup('exception');
        $month = now()->format('Y-m');
        $this->salaryProfile($org, $employee, ['salary_type' => 'hourly', 'hourly_rate' => 100, 'working_days' => 2]);

        $runId = (int) $this->actingAs($admin)
            ->postJson('/api/payroll/runs/generate', ['month' => $month])
            ->assertOk()
            ->json('run.id');

        $item = $this->actingAs($admin)->getJson("/api/payroll/runs/{$runId}")->assertOk()->json('items.0');
        $this->assertSame('exception', data_get($item, 'status'));
        $this->assertContains('Hourly employee has no approved hours', data_get($item, 'warnings'));

        $this->actingAs($admin)
            ->postJson("/api/payroll/runs/{$runId}/approve")
            ->assertStatus(422);
    }

    public function test_employee_can_only_access_their_own_payslip(): void
    {
        [$org, $admin, $firstEmployee] = $this->baseSetup('payslip-access');
        $secondEmployee = User::query()->create([
            'name' => 'Second Employee',
            'email' => 'second-payslip-access@test.com',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        $month = now()->format('Y-m');
        foreach ([$firstEmployee, $secondEmployee] as $index => $employee) {
            $this->salaryProfile($org, $employee, ['salary_type' => 'fixed_monthly', 'monthly_salary' => 2000 + ($index * 500), 'working_days' => 1]);
            $this->attendance($org, $employee, $month, 1, 8);
        }

        $runId = (int) $this->actingAs($admin)->postJson('/api/payroll/runs/generate', ['month' => $month])->assertOk()->json('run.id');
        $this->actingAs($admin)->postJson("/api/payroll/runs/{$runId}/approve")->assertOk();
        $this->actingAs($admin)->postJson("/api/payroll/runs/{$runId}/mark-paid")->assertOk();

        $ownPayslipId = Payslip::query()->where('user_id', $firstEmployee->id)->value('id');
        $otherPayslipId = Payslip::query()->where('user_id', $secondEmployee->id)->value('id');

        $this->actingAs($firstEmployee)
            ->getJson('/api/payroll/payslips')
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $ownPayslipId);

        $this->actingAs($firstEmployee)
            ->getJson("/api/payroll/payslips/{$otherPayslipId}")
            ->assertNotFound();
    }

    private function baseSetup(string $slug): array
    {
        $org = Organization::query()->create([
            'name' => 'Simple Payroll '.$slug,
            'slug' => 'simple-payroll-'.$slug,
        ]);

        $admin = User::query()->create([
            'name' => 'Payroll Admin',
            'email' => 'admin-'.$slug.'@test.com',
            'password' => bcrypt('password123'),
            'role' => 'admin',
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        $employee = User::query()->create([
            'name' => 'Payroll Employee',
            'email' => 'employee-'.$slug.'@test.com',
            'password' => bcrypt('password123'),
            'role' => 'employee',
            'organization_id' => $org->id,
            'is_active' => true,
        ]);

        return [$org, $admin, $employee];
    }

    private function salaryProfile(Organization $org, User $employee, array $meta): PayrollProfile
    {
        return PayrollProfile::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'currency' => 'INR',
            'payout_method' => 'mock',
            'payroll_start_date' => now()->startOfMonth()->toDateString(),
            'payroll_eligible' => true,
            'reimbursements_eligible' => true,
            'is_active' => true,
            'meta' => array_merge([
                'salary_type' => 'fixed_monthly',
                'monthly_salary' => 0,
                'hourly_rate' => 0,
                'working_days' => 30,
                'overtime_enabled' => true,
                'overtime_hourly_rate' => 0,
                'productivity_bonus_enabled' => false,
                'productivity_bonus_rate' => 0,
            ], $meta),
        ]);
    }

    private function attendance(Organization $org, User $employee, string $month, int $day, float $hours): AttendanceRecord
    {
        $date = Carbon::createFromFormat('Y-m-d', $month.'-'.str_pad((string) $day, 2, '0', STR_PAD_LEFT));

        return AttendanceRecord::query()->create([
            'organization_id' => $org->id,
            'user_id' => $employee->id,
            'attendance_date' => $date->toDateString(),
            'check_in_at' => $date->copy()->setTime(9, 0)->toDateTimeString(),
            'check_out_at' => $date->copy()->setTime(9 + (int) min($hours, 12), 0)->toDateTimeString(),
            'worked_seconds' => (int) round($hours * 3600),
            'status' => 'present',
        ]);
    }
}
