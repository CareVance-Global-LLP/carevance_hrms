<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The EPFO ECR must be internally consistent.
 *
 * EPFO validates that the employee contribution is 12% of the EPF wages
 * declared on the same row. The return declared the full-month basic while the
 * engine deducted PF on the LOP-reduced basic, so for anyone with loss of pay
 * the contribution fell short of 12% of the declared wage — an upload
 * rejection, and where accepted an apparent under-remittance carrying s.7Q
 * interest and s.14B damages.
 */
class EcrWageConsistencyTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;
    private string $monthYear = '2026-06';

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            // 3,00,000 CTC keeps basic (~10,000) below the 15,000 PF ceiling,
            // so the cap cannot mask the LOP reduction.
            'annual_ctc' => 300000,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'pf_enabled' => true,
            'esi_enabled' => false,
            'pt_enabled' => false,
            'tds_enabled' => false,
            'tax_regime' => 'new',
            'pt_state' => '',
        ]);
    }

    private function firstWeekday(): Carbon
    {
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        while ($date->isWeekend()) {
            $date->addDay();
        }

        return $date;
    }

    private function runPayrollWithOneLopDay(): PayrollItem
    {
        $absent = $this->firstWeekday()->toDateString();
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $date->copy()->endOfMonth();

        for (; $date->lessThanOrEqualTo($end); $date->addDay()) {
            if ($date->isWeekend() || $date->toDateString() === $absent) {
                continue;
            }
            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $this->employee->id,
                'attendance_date' => $date->toDateString(),
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
                'worked_seconds' => 8 * 3600,
                'late_minutes' => 0,
                'status' => 'present',
            ]);
        }

        $this->postJson('/api/payroll/auto/quick-process', [
            'month_year' => $this->monthYear,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        return PayrollItem::where('user_id', $this->employee->id)->firstOrFail();
    }

    public function test_declared_epf_wages_match_the_contribution_deducted(): void
    {
        $item = $this->runPayrollWithOneLopDay();

        $this->assertGreaterThan(0, (float) $item->lOP_days, 'The fixture must actually produce loss of pay.');

        // What the ECR would declare, via the same helper the generator uses.
        $method = new \ReflectionMethod(\App\Services\PayrollFilingService::class, 'payableBasic');
        $method->setAccessible(true);
        $declaredWages = min((float) $method->invoke(null, $item), 15000.0);

        $this->assertEqualsWithDelta(
            $declaredWages * 0.12,
            (float) $item->pf_employee,
            1.0,
            'EPFO checks the contribution against the wages on the same row.'
        );
    }

    public function test_a_month_with_lop_declares_less_than_full_attendance_would(): void
    {
        // A colleague on the identical salary who missed nothing, so the only
        // difference between the two declared wages is the loss of pay.
        $colleague = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
        EmployeePayrollTemplate::create([
            'organization_id' => $this->organization->id,
            'user_id' => $colleague->id,
            'annual_ctc' => 300000,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'pf_enabled' => true,
            'esi_enabled' => false,
            'pt_enabled' => false,
            'tds_enabled' => false,
            'tax_regime' => 'new',
            'pt_state' => '',
        ]);

        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $date->copy()->endOfMonth();
        for (; $date->lessThanOrEqualTo($end); $date->addDay()) {
            if ($date->isWeekend()) {
                continue;
            }
            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $colleague->id,
                'attendance_date' => $date->toDateString(),
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
                'worked_seconds' => 8 * 3600,
                'late_minutes' => 0,
                'status' => 'present',
            ]);
        }

        $item = $this->runPayrollWithOneLopDay();
        $colleagueItem = PayrollItem::where('user_id', $colleague->id)->firstOrFail();

        $method = new \ReflectionMethod(\App\Services\PayrollFilingService::class, 'payableBasic');
        $method->setAccessible(true);

        $this->assertLessThan(
            (float) $method->invoke(null, $colleagueItem),
            (float) $method->invoke(null, $item),
            'A month with loss of pay declares less EPF wage than full attendance on the same salary.'
        );
    }

    public function test_full_attendance_declares_the_whole_basic(): void
    {
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $date->copy()->endOfMonth();
        for (; $date->lessThanOrEqualTo($end); $date->addDay()) {
            if ($date->isWeekend()) {
                continue;
            }
            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $this->employee->id,
                'attendance_date' => $date->toDateString(),
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
                'worked_seconds' => 8 * 3600,
                'late_minutes' => 0,
                'status' => 'present',
            ]);
        }

        $this->postJson('/api/payroll/auto/quick-process', [
            'month_year' => $this->monthYear,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $item = PayrollItem::where('user_id', $this->employee->id)->firstOrFail();

        $method = new \ReflectionMethod(\App\Services\PayrollFilingService::class, 'payableBasic');
        $method->setAccessible(true);

        $this->assertEqualsWithDelta((float) $item->basic, (float) $method->invoke(null, $item), 0.01);
    }
}
