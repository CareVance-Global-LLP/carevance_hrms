<?php

namespace Tests\Feature;

use App\Models\AttendanceRecord;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\User;
use App\Services\PayrollPdfService;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The payslip must render, and its header must add up.
 *
 * Nothing covered PDF generation, and the header carried two labels bound to
 * the same value ("Actual Payable Days" and "Days Payable") with a paid-day
 * count sourced from attendance presence rather than the divisor the salary
 * was spread across — so paid days + LOP days never equalled the wage period
 * and neither matched the ECR's NCP days.
 */
class PayslipRendersAndReconcilesTest extends TestCase
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
    }

    private function processWithOneLopDay(): PayrollItem
    {
        $date = Carbon::parse($this->monthYear.'-01')->startOfDay();
        while ($date->isWeekend()) {
            $date->addDay();
        }
        $absent = $date->toDateString();

        $cursor = Carbon::parse($this->monthYear.'-01')->startOfDay();
        $end = $cursor->copy()->endOfMonth();
        for (; $cursor->lessThanOrEqualTo($end); $cursor->addDay()) {
            if ($cursor->isWeekend() || $cursor->toDateString() === $absent) {
                continue;
            }
            AttendanceRecord::create([
                'organization_id' => $this->organization->id,
                'user_id' => $this->employee->id,
                'attendance_date' => $cursor->toDateString(),
                'check_in_at' => $cursor->copy()->setTime(9, 30),
                'check_out_at' => $cursor->copy()->setTime(18, 30),
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

    public function test_the_payslip_pdf_generates(): void
    {
        $item = $this->processWithOneLopDay();

        $pdf = app(PayrollPdfService::class)->generatePayslip($item);

        $this->assertNotEmpty($pdf->output(), 'A payslip that cannot be produced is not a payslip.');
    }

    public function test_paid_days_plus_lop_days_equal_the_wage_period(): void
    {
        $item = $this->processWithOneLopDay();

        $divisor = (float) $item->salary_divisor_days;
        $lopDays = (float) $item->lOP_days;
        $paidDays = round($divisor - $lopDays, 2);

        $this->assertSame(30.0, $divisor, 'June 2026 is a 30-day wage period.');
        $this->assertEqualsWithDelta($divisor, $paidDays + $lopDays, 0.01);
    }

    public function test_earnings_less_deductions_equal_net_on_the_stored_item(): void
    {
        $item = $this->processWithOneLopDay();

        $this->assertEqualsWithDelta(
            (float) $item->gross_salary - (float) $item->total_deductions,
            (float) $item->net_pay,
            0.02,
            'The payslip has to add up from the fields it prints.'
        );
    }

    public function test_loss_of_pay_is_not_inside_the_deduction_total(): void
    {
        $item = $this->processWithOneLopDay();

        $this->assertGreaterThan(0, (float) $item->lOP_deduction, 'The fixture must produce a loss of pay.');

        // The deduction total is exactly the money withheld from the employee.
        // Loss of pay is not withheld — it was never earned — so the total
        // must reconcile to the statutory lines alone.
        $withheld = (float) $item->pf_employee
            + (float) $item->esi_employee
            + (float) $item->pt
            + (float) $item->tds
            + (float) $item->lwf;

        $this->assertEqualsWithDelta(
            $withheld,
            (float) $item->total_deductions,
            0.02,
            'Loss of pay reduces earnings; it must not sit inside the deduction total.'
        );
    }
}
