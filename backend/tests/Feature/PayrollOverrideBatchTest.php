<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollOverride;
use App\Models\PayrollOverrideAudit;
use App\Models\SalaryComponent;
use App\Models\User;
use App\Services\PayrollCalculatorService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * The grid's Update button: many overrides raised as one act.
 *
 * ALL OR NOTHING is the property under test. A partial write is how a grid
 * drifts from the sheet it came from — the officer is told "3 of 12 applied",
 * cannot tell which 3, and their next export disagrees with what they believe
 * they did. Every test that expects a refusal therefore also asserts that
 * nothing at all was written.
 *
 * The arithmetic is shared with the CSV importer through
 * OverrideChangeAssessor, so a value the grid accepts is one the file would
 * accept too.
 */
class PayrollOverrideBatchTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $second;

    private float $annualCtc = 1200000.0;

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();

        $this->admin = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        // A second admin, so the sole-admin rules are not what is being tested.
        $this->second = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'admin',
        ]);

        foreach ([['Basic Salary', 'BASIC', 'basic'], ['House Rent Allowance', 'HRA', 'allowance']] as [$name, $code, $category]) {
            SalaryComponent::create([
                'organization_id' => $this->organization->id,
                'name' => $name,
                'code' => $code,
                'category' => $category,
                'impact' => 'earning',
                'value_type' => 'percentage',
                'default_value' => 40,
                'is_taxable' => true,
                'is_active' => true,
                'allow_employee_override' => true,
            ]);
        }
    }

    private function employee(array $template = []): User
    {
        $user = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);

        EmployeePayrollTemplate::create(array_merge([
            'organization_id' => $this->organization->id,
            'user_id' => $user->id,
            'annual_ctc' => $this->annualCtc,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'is_metro_city' => true,
            'is_active' => true,
        ], $template));

        return $user;
    }

    private function raise(array $payload)
    {
        return $this->actingAs($this->admin)->postJson(
            '/api/payroll/operations/overrides',
            array_merge([
                'reason' => 'Annual revision FY 2026-27',
                'effective_from' => '2026-09-01',
            ], $payload),
        );
    }

    /** The balancer's own ceiling, so nothing here hardcodes the arithmetic. */
    private function maxBasicAnnual(): float
    {
        return floor(app(PayrollCalculatorService::class)->maxBasicWithinCtc($this->annualCtc / 12, [
            'basic_percentage' => 0.40,
            'hra_percentage_of_basic' => 0.50,
            'conveyance_allowance' => 1600,
            'medical_allowance' => 0,
        ])) * 12;
    }

    #[Test]
    public function many_employees_are_raised_in_one_request(): void
    {
        $first = $this->employee();
        $second = $this->employee();

        $response = $this->raise([
            'items' => [
                ['user_id' => $first->id, 'target' => 'basic', 'value_annual' => 540000],
                ['user_id' => $second->id, 'target' => 'basic', 'value_annual' => 520000],
            ],
        ])->assertStatus(201);

        $this->assertCount(2, $response->json('data'));
        $this->assertSame(2, PayrollOverride::count());

        // Stored monthly, as every override is.
        $this->assertEqualsWithDelta(45000.0, (float) PayrollOverride::where('user_id', $first->id)->first()->value, 0.01);
    }

    /** Saving raises a request; it does not move anybody's pay. */
    #[Test]
    public function every_row_lands_as_pending_and_is_audited(): void
    {
        $employee = $this->employee();

        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]],
        ])->assertStatus(201);

        $override = PayrollOverride::firstOrFail();

        $this->assertSame(PayrollOverride::STATUS_PENDING, $override->status);
        $this->assertSame('ui', $override->source);
        $this->assertSame(1, PayrollOverrideAudit::where('action', PayrollOverrideAudit::ACTION_CREATED)->count());
    }

    /**
     * The property this endpoint exists for. One bad item and nothing is
     * written — not the good ones, not partially.
     */
    #[Test]
    public function one_impossible_item_fails_the_whole_request(): void
    {
        $good = $this->employee();
        $bad = $this->employee();

        $response = $this->raise([
            'items' => [
                ['user_id' => $good->id, 'target' => 'basic', 'value_annual' => 540000],
                ['user_id' => $bad->id, 'target' => 'basic', 'value_annual' => 9000000],
            ],
        ])->assertStatus(422);

        $this->assertNotEmpty($response->json('errors'));
        $this->assertSame(0, PayrollOverride::count(), 'A partial write is how the grid drifts from its file.');
    }

    /** The refusal names the employee and the ceiling, not merely "invalid". */
    #[Test]
    public function a_refusal_names_the_employee_and_the_maximum(): void
    {
        $employee = $this->employee();

        $response = $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 9000000]],
        ])->assertStatus(422);

        $message = $response->json('errors.0.message');

        $this->assertStringContainsString($employee->name, $message);
        $this->assertStringContainsString(number_format($this->maxBasicAnnual()), $message);
    }

    /** And the figure it names is itself accepted. */
    #[Test]
    public function the_maximum_the_refusal_names_is_accepted(): void
    {
        $employee = $this->employee();

        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => $this->maxBasicAnnual()]],
        ])->assertStatus(201);
    }

    /**
     * Two items for one employee are judged together. Pinning HRA changes what
     * a rupee of basic costs the residual, so judging basic alone would refuse
     * a pair that balances perfectly well.
     */
    #[Test]
    public function a_basic_raise_and_an_hra_pin_are_judged_as_one_change(): void
    {
        $employee = $this->employee();
        $beyondAlone = $this->maxBasicAnnual() + 240000;

        // Basic alone at this figure is refused...
        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => $beyondAlone]],
        ])->assertStatus(422);

        // ...but the same basic with HRA pinned low costs the residual far less.
        $this->raise([
            'items' => [
                ['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => $beyondAlone],
                ['user_id' => $employee->id, 'target' => 'hra', 'value_annual' => 60000],
            ],
        ])->assertStatus(201);

        $this->assertSame(2, PayrollOverride::count());
    }

    /** The consequence rides back with the row, so the grid needs no second call. */
    #[Test]
    public function the_response_carries_the_preview_for_each_row(): void
    {
        $employee = $this->employee();

        $response = $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]],
        ])->assertStatus(201);

        $preview = $response->json('data.0.preview');

        $this->assertNotNull($preview);
        $this->assertSame(480000, $preview['computed_annual'], 'What the structure would have produced.');
        $this->assertSame(270000, $preview['hra_moves_to'], 'HRA follows basic when it is not itself pinned.');
        $this->assertGreaterThan(1.0, $preview['amplification']);
    }

    /**
     * A pending override must be visible on the grid without moving the figure.
     *
     * `annual` is what will be paid, and a pending request has not changed
     * that — but the grid showed nothing at all for one, so an officer who
     * saved a change watched the cell snap back to the structure figure and
     * could not tell a saved request from a failed save.
     */
    #[Test]
    public function a_pending_override_is_reported_on_the_grid_without_changing_what_is_paid(): void
    {
        $employee = $this->employee();

        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]],
        ])->assertStatus(201);

        $row = collect(
            $this->actingAs($this->admin)
                ->getJson('/api/payroll/operations/overrides/grid')
                ->assertStatus(200)
                ->json('data'),
        )->firstWhere('user_id', $employee->id);

        $this->assertSame(480000, $row['components']['basic']['annual'], 'A pending override must not move what is paid.');
        $this->assertSame(540000, $row['components']['basic']['pending_annual'], 'But it must be visible.');
        $this->assertSame('pending', $row['components']['basic']['status']);
    }

    /** Once approved, the figure moves and there is no longer anything pending. */
    #[Test]
    public function approving_moves_the_paid_figure_and_clears_the_pending_marker(): void
    {
        $employee = $this->employee();

        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]],
        ])->assertStatus(201);

        // A second admin approves — maker-checker, and not the employee's own pay.
        $this->actingAs($this->second)
            ->postJson('/api/payroll/operations/overrides/'.PayrollOverride::firstOrFail()->id.'/approve')
            ->assertStatus(200);

        $row = collect(
            $this->actingAs($this->admin)
                ->getJson('/api/payroll/operations/overrides/grid')
                ->assertStatus(200)
                ->json('data'),
        )->firstWhere('user_id', $employee->id);

        $this->assertSame(540000, $row['components']['basic']['annual']);
        $this->assertSame(480000, $row['components']['basic']['computed_annual'], 'What the structure would have produced.');
        $this->assertNull($row['components']['basic']['pending_annual']);
        // HRA follows basic — 50% of the new figure, not the old.
        $this->assertSame(270000, $row['components']['hra']['annual']);
    }

    /** A second override on the same target closes the first rather than racing it. */
    #[Test]
    public function raising_again_supersedes_the_previous_override(): void
    {
        $employee = $this->employee();

        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]],
        ])->assertStatus(201);

        $this->raise([
            'effective_from' => '2026-10-01',
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 560000]],
        ])->assertStatus(201);

        $this->assertSame(2, PayrollOverride::count());

        $first = PayrollOverride::orderBy('id')->first();
        $this->assertSame('2026-09-30', $first->effective_to?->toDateString(), 'The prior override ends the day before the new one starts.');
    }

    #[Test]
    public function an_ungated_component_fails_the_request(): void
    {
        $employee = $this->employee();
        SalaryComponent::query()->update(['allow_employee_override' => false]);

        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]],
        ])->assertStatus(422);

        $this->assertSame(0, PayrollOverride::count());
    }

    #[Test]
    public function an_employee_with_no_ctc_fails_the_request(): void
    {
        $employee = $this->employee(['annual_ctc' => 0]);

        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]],
        ])->assertStatus(422);
    }

    #[Test]
    public function an_employee_in_another_organisation_fails_the_request(): void
    {
        $otherOrg = Organization::factory()->create();
        $stranger = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'employee']);

        $this->raise([
            'items' => [['user_id' => $stranger->id, 'target' => 'basic', 'value_annual' => 540000]],
        ])->assertStatus(422);

        $this->assertSame(0, PayrollOverride::withoutOrganizationScope()->count());
    }

    #[Test]
    public function a_batch_without_a_reason_is_refused(): void
    {
        $employee = $this->employee();

        $this->actingAs($this->admin)
            ->postJson('/api/payroll/operations/overrides', [
                'effective_from' => '2026-09-01',
                'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]],
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors('reason');
    }

    /** 500 is the stated ceiling; beyond it the request is refused, not truncated. */
    #[Test]
    public function more_than_five_hundred_items_is_refused(): void
    {
        $employee = $this->employee();

        $items = array_fill(0, 501, ['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]);

        $this->raise(['items' => $items])
            ->assertStatus(422)
            ->assertJsonValidationErrors('items');
    }

    #[Test]
    public function an_unknown_target_is_refused(): void
    {
        $employee = $this->employee();

        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'special_allowance', 'value_annual' => 100000]],
        ])->assertStatus(422)->assertJsonValidationErrors('items.0.target');
    }

    #[Test]
    public function an_employee_cannot_raise_a_batch(): void
    {
        $employee = $this->employee();

        $this->actingAs($employee)
            ->postJson('/api/payroll/operations/overrides', [
                'reason' => 'Annual revision',
                'effective_from' => '2026-09-01',
                'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => 540000]],
            ])
            ->assertStatus(403);
    }

    /**
     * The grid and the CSV importer must agree. A value one accepts, the other
     * must accept — they share OverrideChangeAssessor precisely so that a
     * figure typed into a cell and the same figure in a spreadsheet cannot get
     * different answers.
     */
    #[Test]
    public function the_grid_and_the_importer_agree_on_the_ceiling(): void
    {
        $employee = $this->employee();
        $template = EmployeePayrollTemplate::where('user_id', $employee->id)->firstOrFail();

        $assessment = app(\App\Services\Payroll\OverrideChangeAssessor::class)
            ->assess($template, ['basic' => (int) $this->maxBasicAnnual() + 120000]);

        $this->assertFalse($assessment['permitted']);
        $this->assertEqualsWithDelta($this->maxBasicAnnual(), $assessment['max_basic_annual'], 12);

        // ...and the endpoint refuses exactly the same figure.
        $this->raise([
            'items' => [['user_id' => $employee->id, 'target' => 'basic', 'value_annual' => $this->maxBasicAnnual() + 120000]],
        ])->assertStatus(422);
    }
}
