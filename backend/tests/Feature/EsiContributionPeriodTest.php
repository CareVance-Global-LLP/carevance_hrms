<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\Payroll\EsiContributionPeriodService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ESI coverage is fixed for a whole contribution period (Apr-Sep, Oct-Mar).
 * An employee covered at the start stays covered to the end of that period
 * even if a raise takes them over the ₹21,000 ceiling partway through.
 */
class EsiContributionPeriodTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private EsiContributionPeriodService $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
        $this->service = app(EsiContributionPeriodService::class);
    }

    private function contributedIn(string $monthYear, float $esi = 150.0): void
    {
        // Built the way production builds it: the run holds its contents while
        // it is still open, and only then advances. Creating items directly on
        // an 'approved' run is refused by PayrollItemObserver, correctly --
        // adding money to a closed run is exactly what it exists to stop.
        $run = PayrollMonthlyRun::create([
            'organization_id' => $this->organization->id,
            'month_year' => $monthYear,
            'status' => 'draft',
        ]);

        PayrollItem::create([
            'payroll_run_id' => $run->id,
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'month_year' => $monthYear,
            'gross_salary' => 20000,
            'esi_employee' => $esi,
            'net_pay' => 19850,
        ]);

        $run->update(['status' => 'approved']);
    }

    public function test_april_to_september_is_one_period(): void
    {
        $april = $this->service->periodFor('2026-04');
        $september = $this->service->periodFor('2026-09');

        $this->assertSame($april['label'], $september['label']);
        $this->assertSame('2026-04-01', $april['start']->toDateString());
        $this->assertSame('2026-09-30', $april['end']->toDateString());
    }

    public function test_october_to_march_is_one_period_across_the_year_boundary(): void
    {
        $october = $this->service->periodFor('2026-10');
        $february = $this->service->periodFor('2027-02');

        $this->assertSame($october['label'], $february['label'], 'October and the following February share a period.');
        $this->assertSame('2026-10-01', $february['start']->toDateString());
        $this->assertSame('2027-03-31', $february['end']->toDateString());
    }

    public function test_wages_under_the_ceiling_are_covered(): void
    {
        $this->assertTrue(
            $this->service->isCovered($this->employee->id, $this->organization->id, '2026-06', 20000, 21000)
        );
    }

    public function test_crossing_the_ceiling_mid_period_keeps_coverage(): void
    {
        // Contributed in April and May; a June raise takes them to 25,000.
        $this->contributedIn('2026-04');
        $this->contributedIn('2026-05');

        $this->assertTrue(
            $this->service->isCovered($this->employee->id, $this->organization->id, '2026-06', 25000, 21000),
            'Coverage must continue to the end of the contribution period.'
        );
    }

    public function test_coverage_ends_with_the_period(): void
    {
        // Contributed through the April-September period only.
        $this->contributedIn('2026-04');
        $this->contributedIn('2026-09');

        $this->assertFalse(
            $this->service->isCovered($this->employee->id, $this->organization->id, '2026-10', 25000, 21000),
            'A new contribution period re-tests the ceiling from scratch.'
        );
    }

    public function test_a_new_joiner_above_the_ceiling_is_never_covered(): void
    {
        $this->assertFalse(
            $this->service->isCovered($this->employee->id, $this->organization->id, '2026-06', 30000, 21000),
            'Someone who never contributed in this period and earns above the ceiling is out.'
        );
    }

    public function test_a_month_with_no_esi_deducted_does_not_create_coverage(): void
    {
        $this->contributedIn('2026-04', 0.0);

        $this->assertFalse(
            $this->service->isCovered($this->employee->id, $this->organization->id, '2026-06', 25000, 21000)
        );
    }
}
