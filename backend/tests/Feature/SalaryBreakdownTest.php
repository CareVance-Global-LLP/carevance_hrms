<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\SalaryTemplate;
use App\Models\User;
use App\Services\SalaryBreakdownService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The Salary Breakdown panel's arithmetic.
 *
 * The point of the service is that it composes two engines that disagree:
 * SalaryTemplate::calculateBreakdown() names the components but builds gross
 * additively, and PayrollCalculatorService computes the statutory figures but
 * knows nothing about a structure. The tests that matter are the ones that pin
 * the seam — that the earnings still add up to gross, and that the per-employee
 * flags are honoured.
 */
class SalaryBreakdownTest extends TestCase
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
    }

    private function structure(array $overrides = []): SalaryTemplate
    {
        return SalaryTemplate::create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => 'Executive',
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_amount' => 1600,
            'meal_allowance' => 2200,
        ], $overrides));
    }

    private function config(array $overrides = []): EmployeePayrollTemplate
    {
        return EmployeePayrollTemplate::create(array_merge([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'pt_state' => 'maharashtra',
            'tax_regime' => 'new',
            'is_metro_city' => true,
            'pf_enabled' => true,
            'esi_enabled' => true,
            'pt_enabled' => true,
            'tds_enabled' => true,
        ], $overrides));
    }

    private function breakdown(?SalaryTemplate $structure, float $ctc, EmployeePayrollTemplate $config): array
    {
        return app(SalaryBreakdownService::class)
            ->forEmployee($this->employee, $structure, $ctc, $config);
    }

    public function test_the_earnings_add_up_to_gross(): void
    {
        $result = $this->breakdown($this->structure(), 600000, $this->config());

        $earningsTotal = array_sum(array_column($result['earnings'], 'monthly'));

        $this->assertEqualsWithDelta($result['monthly']['gross'], $earningsTotal, 0.02);
    }

    /**
     * Gross is CTC less the employer's own costs, per
     * PayrollCalculatorService::calculateSalaryComponents. Using the structure's
     * additive gross instead would not balance to CTC.
     */
    public function test_gross_is_ctc_less_employer_pf_and_gratuity(): void
    {
        $result = $this->breakdown($this->structure(), 600000, $this->config());

        $monthlyCtc = 600000 / 12;
        $basic = $monthlyCtc * 0.40;
        $employerPf = min($basic, 15000) * 0.12;
        $gratuity = $basic * 0.0481;

        $this->assertEqualsWithDelta($monthlyCtc - $employerPf - $gratuity, $result['monthly']['gross'], 0.02);
    }

    public function test_a_named_structure_component_appears_as_its_own_line(): void
    {
        $result = $this->breakdown($this->structure(), 600000, $this->config());

        $keys = array_column($result['earnings'], 'key');
        $this->assertContains('meal', $keys, 'The structure\'s meal allowance should be its own row, not folded into special allowance.');
        $this->assertContains('special_allowance', $keys);
    }

    public function test_a_disabled_deduction_is_omitted(): void
    {
        $result = $this->breakdown($this->structure(), 600000, $this->config(['pf_enabled' => false]));

        $this->assertNotContains('pf_employee', array_column($result['deductions'], 'key'));
    }

    /**
     * Professional tax is state-levied and several states levy none. An unset
     * state must yield zero, never a fallback to a real state's slabs.
     */
    public function test_an_unset_pt_state_yields_zero_professional_tax(): void
    {
        $result = $this->breakdown($this->structure(), 600000, $this->config(['pt_state' => null]));

        $pt = collect($result['deductions'])->firstWhere('key', 'pt');

        $this->assertNotNull($pt);
        $this->assertSame(0.0, $pt['monthly']);
        $this->assertNotEmpty($result['warnings']);
    }

    public function test_it_still_renders_without_a_salary_structure(): void
    {
        $result = $this->breakdown(null, 600000, $this->config());

        $this->assertNotEmpty($result['earnings']);
        $this->assertEqualsWithDelta(
            $result['monthly']['gross'],
            array_sum(array_column($result['earnings'], 'monthly')),
            0.02,
        );
        $this->assertNotEmpty($result['warnings']);
    }

    /** An over-allocated structure is reported, not rendered as a negative row. */
    public function test_an_over_allocating_structure_warns_instead_of_going_negative(): void
    {
        $structure = $this->structure(['meal_allowance' => 500000]);

        $result = $this->breakdown($structure, 600000, $this->config());

        $this->assertNotEmpty($result['warnings']);
        foreach ($result['earnings'] as $line) {
            $this->assertGreaterThan(0, $line['monthly']);
        }
    }

    public function test_net_is_gross_less_the_deductions_shown(): void
    {
        $result = $this->breakdown($this->structure(), 600000, $this->config());

        $deductionsTotal = array_sum(array_column($result['deductions'], 'monthly'));

        $this->assertEqualsWithDelta($deductionsTotal, $result['monthly']['total_deductions'], 0.02);
        $this->assertEqualsWithDelta(
            $result['monthly']['gross'] - $deductionsTotal,
            $result['monthly']['net'],
            0.02,
        );
    }

    // ── The endpoint ──────────────────────────────────────────────────────

    public function test_the_endpoint_returns_a_breakdown_for_the_stored_configuration(): void
    {
        $structure = $this->structure();
        $this->config(['annual_ctc' => 600000, 'salary_template_id' => $structure->id]);

        $response = $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown",
            $this->apiHeadersFor($this->admin),
        )->assertOk();

        $this->assertSame($structure->id, $response->json('source.salary_template_id'));
        $this->assertFalse($response->json('source.is_preview'));
        $this->assertNotEmpty($response->json('earnings'));
    }

    /** Passing a structure the employee is not assigned marks the result a preview. */
    public function test_a_structure_override_is_flagged_as_a_preview(): void
    {
        $assigned = $this->structure();
        $other = $this->structure(['name' => 'Standard', 'basic_percentage' => 50, 'meal_allowance' => 0]);
        $this->config(['annual_ctc' => 600000, 'salary_template_id' => $assigned->id]);

        $response = $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown?salary_template_id={$other->id}",
            $this->apiHeadersFor($this->admin),
        )->assertOk();

        $this->assertTrue($response->json('source.is_preview'));
        $this->assertSame($other->id, $response->json('source.salary_template_id'));
    }

    /**
     * Custom mode replaces the structure with typed percentages. The point of
     * the panel is asking "what if basic were 50%?", so the returned basic must
     * actually follow the number sent, not the assigned structure's 40%.
     */
    public function test_custom_percentages_drive_the_breakdown(): void
    {
        $assigned = $this->structure(); // basic 40%
        $this->config(['annual_ctc' => 600000, 'salary_template_id' => $assigned->id]);

        $response = $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown?custom[basic_percentage]=50&custom[hra_percentage]=40",
            $this->apiHeadersFor($this->admin),
        )->assertOk();

        $this->assertTrue($response->json('source.is_custom'));
        $this->assertTrue($response->json('source.is_preview'));
        $this->assertNull($response->json('source.salary_template_id'));

        $earnings = collect($response->json('earnings'));
        $basic = $earnings->firstWhere('key', 'basic');
        $hra = $earnings->firstWhere('key', 'hra');

        $this->assertEqualsWithDelta((600000 / 12) * 0.50, $basic['monthly'], 0.02);
        $this->assertEqualsWithDelta($basic['monthly'] * 0.40, $hra['monthly'], 0.02);
    }

    /**
     * A rupee amount is an input format, not a second engine. Both are
     * MONTHLY, matching the conveyance field beside them.
     */
    public function test_a_custom_basic_amount_is_converted_to_a_percentage(): void
    {
        $this->config(['annual_ctc' => 600000]);

        $response = $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown?custom[basic_amount]=25000",
            $this->apiHeadersFor($this->admin),
        )->assertOk();

        $basic = collect($response->json('earnings'))->firstWhere('key', 'basic');

        // 25,000 of a 50,000 monthly CTC is 50%.
        $this->assertEqualsWithDelta(25000, $basic['monthly'], 0.02);
    }

    /**
     * HRA is a share of BASIC, so it has to be rated against the basic the
     * conversion produced — not against CTC, and not against the structure's
     * original basic.
     */
    public function test_a_custom_hra_amount_is_rated_against_the_converted_basic(): void
    {
        $this->config(['annual_ctc' => 600000]);

        $response = $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown?custom[basic_amount]=25000&custom[hra_amount]=10000",
            $this->apiHeadersFor($this->admin),
        )->assertOk();

        $earnings = collect($response->json('earnings'));

        $this->assertEqualsWithDelta(25000, $earnings->firstWhere('key', 'basic')['monthly'], 0.02);
        $this->assertEqualsWithDelta(10000, $earnings->firstWhere('key', 'hra')['monthly'], 0.02);
    }

    /** The amount wins, and the response says so rather than choosing silently. */
    public function test_an_amount_beats_a_percentage_and_warns(): void
    {
        $this->config(['annual_ctc' => 600000]);

        $response = $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown?custom[basic_percentage]=40&custom[basic_amount]=25000",
            $this->apiHeadersFor($this->admin),
        )->assertOk();

        $basic = collect($response->json('earnings'))->firstWhere('key', 'basic');
        $this->assertEqualsWithDelta(25000, $basic['monthly'], 0.02);

        $this->assertNotEmpty(
            collect($response->json('warnings'))->filter(fn ($w) => str_contains($w, 'amount was used')),
        );
    }

    /** A zero basic is entirely reachable — an admin clearing the field. */
    public function test_an_hra_amount_against_a_zero_basic_does_not_divide_by_zero(): void
    {
        $this->config(['annual_ctc' => 600000]);

        $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown?custom[basic_amount]=0&custom[hra_amount]=10000",
            $this->apiHeadersFor($this->admin),
        )->assertOk();
    }

    public function test_a_custom_breakdown_still_balances_to_gross(): void
    {
        $this->config(['annual_ctc' => 600000]);

        $response = $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown?custom[basic_percentage]=55&custom[hra_percentage]=30&custom[da_percentage]=5",
            $this->apiHeadersFor($this->admin),
        )->assertOk();

        $earningsTotal = collect($response->json('earnings'))->sum('monthly');

        $this->assertEqualsWithDelta($response->json('monthly.gross'), $earningsTotal, 0.02);
    }

    /**
     * The transient model must survive calculateBreakdown() with only a couple
     * of heads supplied.
     *
     * A plain `new SalaryTemplate([...])` left the unsupplied decimal columns
     * null and the decimal casts threw "Unable to cast value to a decimal" —
     * a 500 on every custom-mode request. It passed through the endpoint tests
     * anyway, because those built structures with create(), which reloads the
     * database's own column defaults. This asserts the no-database path.
     */
    public function test_a_transient_structure_survives_with_only_some_heads_set(): void
    {
        $structure = SalaryTemplate::transient([
            'name' => 'Custom',
            'basic_percentage' => 40,
            'hra_percentage' => 50,
        ]);

        $breakdown = $structure->calculateBreakdown(2000000);

        $this->assertEqualsWithDelta((2000000 / 12) * 0.40, $breakdown['monthly']['basic'], 0.02);
        $this->assertSame(0.0, (float) $breakdown['monthly']['cca']);
    }

    public function test_custom_mode_works_for_an_employee_on_a_large_ctc(): void
    {
        $assigned = $this->structure();
        $this->config(['annual_ctc' => 2000000, 'salary_template_id' => $assigned->id]);

        $response = $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown"
                . '?salary_template_id=' . $assigned->id
                . '&annual_ctc=2000000&pt_state=maharashtra'
                . '&custom[basic_percentage]=40&custom[hra_percentage]=50&custom[da_percentage]=0'
                . '&custom[conveyance_amount]=1600&custom[nps_percentage]=0&custom[vpf_percentage]=0',
            $this->apiHeadersFor($this->admin),
        )->assertOk();

        $this->assertTrue($response->json('source.is_custom'));
        $this->assertEqualsWithDelta(
            $response->json('monthly.gross'),
            collect($response->json('earnings'))->sum('monthly'),
            0.02,
        );
    }

    public function test_a_custom_percentage_above_one_hundred_is_rejected(): void
    {
        $this->config(['annual_ctc' => 600000]);

        $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown?custom[basic_percentage]=150",
            $this->apiHeadersFor($this->admin),
        )->assertStatus(422);
    }

    public function test_an_employee_without_a_ctc_is_refused_with_a_reason(): void
    {
        $this->config(['annual_ctc' => null]);

        $this->getJson(
            "/api/payroll/employee-cards/{$this->employee->id}/breakdown",
            $this->apiHeadersFor($this->admin),
        )->assertStatus(422);
    }

    public function test_it_will_not_break_down_another_organisations_employee(): void
    {
        $otherOrg = Organization::factory()->create();
        $outsider = User::factory()->create([
            'organization_id' => $otherOrg->id,
            'role' => 'employee',
        ]);

        $this->getJson(
            "/api/payroll/employee-cards/{$outsider->id}/breakdown",
            $this->apiHeadersFor($this->admin),
        )->assertNotFound();
    }
}
