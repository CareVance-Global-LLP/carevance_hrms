<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\User;
use App\Services\ArrearCalculatorService;
use App\Services\SalaryRevisionService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Salary revision and CTC-change arrear detection.
 *
 * Both services called PayrollCalculatorService::calculatePayroll with named
 * arguments that do not exist on it (state:, isMetro:, config: against
 * $stateCode, $isMetroCity, $customConfig), so either would fatal with
 * "Unknown named parameter" the moment it was invoked. Neither has a route or
 * controller caller today, which is why the breakage went unnoticed — these
 * tests pin the contract so the code is correct whenever it is wired up.
 */
class SalaryRevisionArrearCalculationTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;

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
            'is_metro_city' => false,
        ]);
    }

    public function test_generating_a_revision_letter_does_not_fatal(): void
    {
        $letter = app(SalaryRevisionService::class)->generateLetter(
            $this->employee->id,
            $this->organization->id,
            750000,
            'promotion',
            'Annual cycle',
            $this->admin->id
        );

        $this->assertSame(600000.0, (float) $letter->old_ctc);
        $this->assertSame(750000.0, (float) $letter->new_ctc);
        $this->assertSame(25.0, (float) $letter->revision_percentage);
    }

    public function test_revision_letter_records_both_salary_breakdowns(): void
    {
        $letter = app(SalaryRevisionService::class)->generateLetter(
            $this->employee->id,
            $this->organization->id,
            750000,
            'promotion',
            'Annual cycle',
            $this->admin->id
        );

        $this->assertNotEmpty($letter->old_breakdown, 'The old CTC breakdown must be computed, not skipped.');
        $this->assertNotEmpty($letter->new_breakdown);
        $this->assertGreaterThan(
            $letter->old_breakdown['monthly']['gross'],
            $letter->new_breakdown['monthly']['gross'],
            'A raise must produce a larger monthly gross.'
        );
    }

    public function test_detecting_ctc_changes_does_not_fatal(): void
    {
        $arrears = app(ArrearCalculatorService::class)
            ->detectCtcChanges($this->employee->id, $this->organization->id, '2026-06');

        // No historical payroll items exist, so nothing is owed — the point is
        // that the detection runs at all rather than throwing.
        $this->assertIsArray($arrears);
    }

    /**
     * The template stores percentages as whole numbers (40 = 40%) while the
     * calculator's config expects fractions (0.40). Passing the raw 40 through
     * would make basic forty times gross.
     */
    public function test_revision_breakdown_uses_template_percentages_at_the_right_scale(): void
    {
        $letter = app(SalaryRevisionService::class)->generateLetter(
            $this->employee->id,
            $this->organization->id,
            600000,
            'correction',
            'No change',
            $this->admin->id
        );

        $monthly = $letter->new_breakdown['monthly'];
        $basic = (float) $letter->new_breakdown['components']['earnings']['basic'];

        $this->assertLessThanOrEqual(
            (float) $monthly['gross'],
            $basic,
            'Basic can never exceed gross.'
        );
        $this->assertEqualsWithDelta(20000.0, $basic, 1.0, '40% of a 50,000 monthly CTC.');
    }
}
