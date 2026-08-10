<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\User;
use App\Services\Payroll\SalaryCalculationService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Gross is the employee's own earnings, not the cost to company.
 *
 * Employer PF and the gratuity provision are the employer's cost — Code on
 * Wages s.2(y) excludes both from "wages". Two of the three engines set gross
 * equal to monthly CTC, which pays those amounts to the employee as special
 * allowance: on a ₹6,00,000 CTC the employer spent the full ₹50,000 on wages
 * and then funded ₹1,800 PF and ₹962 gratuity on top, ₹2,762 a month per head
 * beyond the agreed cost. The same employee also came out with three different
 * gross figures depending on which engine ran.
 */
class GrossDefinitionConsistencyTest extends TestCase
{
    use RefreshDatabase;

    /** 6,00,000 CTC => 50,000/month, less 1,800 employer PF and 962 gratuity. */
    private const EXPECTED_MONTHLY_GROSS = 47238.0;

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
            'annual_ctc' => 600000,
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
                'user_id' => $this->employee->id,
                'attendance_date' => $date->toDateString(),
                'check_in_at' => $date->copy()->setTime(9, 30),
                'check_out_at' => $date->copy()->setTime(18, 30),
                'worked_seconds' => 8 * 3600,
                'late_minutes' => 0,
                'status' => 'present',
            ]);
        }
    }

    public function test_auto_process_engine_excludes_employer_cost_from_gross(): void
    {
        $this->postJson('/api/payroll/auto/quick-process', [
            'month_year' => $this->monthYear,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $item = PayrollItem::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertEqualsWithDelta(self::EXPECTED_MONTHLY_GROSS, (float) $item->gross_salary, 1.0);
    }

    public function test_department_engine_produces_the_same_gross(): void
    {
        $this->postJson('/api/payroll/employees/'.$this->employee->id.'/process', [
            'month_year' => $this->monthYear,
            'annual_ctc' => 600000,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $item = PayrollItem::where('user_id', $this->employee->id)->firstOrFail();

        $this->assertEqualsWithDelta(self::EXPECTED_MONTHLY_GROSS, (float) $item->gross_salary, 1.0);
    }

    public function test_payslip_engine_produces_the_same_gross(): void
    {
        $result = app(SalaryCalculationService::class)->calculateSalary($this->employee->id, 6, 2026);

        $this->assertEqualsWithDelta(
            self::EXPECTED_MONTHLY_GROSS,
            (float) $result['total_earnings'],
            1.0,
            'A payslip must not disagree with the run that produced it.'
        );
    }

    public function test_gross_plus_employer_cost_reconciles_to_ctc(): void
    {
        $this->postJson('/api/payroll/auto/quick-process', [
            'month_year' => $this->monthYear,
        ], $this->apiHeadersFor($this->admin))->assertOk();

        $item = PayrollItem::where('user_id', $this->employee->id)->firstOrFail();

        // The whole point of the definition: what the employer spends is the
        // employee's wages plus the employer-side contributions, and that must
        // come back to the agreed cost to company.
        $this->assertEqualsWithDelta(
            50000.0,
            (float) $item->gross_salary + (float) $item->total_employer_contributions,
            1.0,
            'Gross + employer contributions must equal monthly CTC, not exceed it.'
        );
    }
}
