<?php

namespace Tests\Feature;

use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\PayrollOverride;
use App\Models\PayrollOverrideAudit;
use App\Models\SalaryComponent;
use App\Models\User;
use App\Services\Payroll\OverrideBalancingService;
use App\Services\PayrollCalculatorService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Raising an override: what is refused, and when.
 *
 * The refusals are the feature. An override that stores cleanly and fails at
 * finalisation weeks later — RazorpayX's behaviour, reported as a batch-wide
 * "all employees are showing as skipped and I cannot finalise payroll" — costs
 * the most at the worst point in the payroll calendar. Every check here fires
 * while the admin is still looking at the screen and the fix is a keystroke.
 */
class PayrollOverrideStoreTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $admin;
    private User $employee;

    /** 12,00,000 a year is 1,00,000 a month, which makes basic 40,000 at 40%. */
    private float $annualCtc = 1200000.0;

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
            'annual_ctc' => $this->annualCtc,
            'basic_percentage' => 40,
            'hra_percentage' => 50,
            'conveyance_allowance' => 1600,
            'is_metro_city' => true,
        ]);

        $this->gatedComponent();
    }

    private function gatedComponent(array $attributes = []): SalaryComponent
    {
        return SalaryComponent::create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => 'Basic Salary',
            'code' => 'BASIC',
            'category' => 'basic',
            'impact' => 'earning',
            'value_type' => 'percentage',
            'default_value' => 40,
            'is_taxable' => true,
            'is_active' => true,
            'allow_employee_override' => true,
        ], $attributes));
    }

    private function payload(array $overrides = []): array
    {
        return array_merge([
            'user_id' => $this->employee->id,
            'scope' => 'component',
            'target' => 'basic',
            'value' => 45000,
            'balance_mode' => 'preserve_ctc',
            'effective_from' => '2026-06-01',
            'reason' => 'Correcting an understated basic agreed at offer.',
        ], $overrides);
    }

    private function raise(array $overrides = [])
    {
        return $this->actingAs($this->admin)
            ->postJson('/api/payroll/operations/overrides', $this->payload($overrides));
    }

    /** The balancer's own ceiling, so the test never hardcodes the arithmetic. */
    private function maxPermitted(): float
    {
        return app(PayrollCalculatorService::class)->maxBasicWithinCtc($this->annualCtc / 12, [
            'basic_percentage' => 0.40,
            'hra_percentage_of_basic' => 0.50,
            'conveyance_allowance' => 1600,
        ]);
    }

    #[Test]
    public function an_override_within_the_envelope_is_raised_as_pending(): void
    {
        $response = $this->raise()->assertStatus(201);

        $response->assertJsonPath('data.status', PayrollOverride::STATUS_PENDING);
        $response->assertJsonPath('data.target', 'basic');
        $response->assertJsonPath('data.open_ended', true);
        // Nothing has run yet, so there is no engine figure to compare against
        // — and reporting the delta as 0 would read as "this changed nothing".
        $response->assertJsonPath('data.computed_value', null);
        $response->assertJsonPath('data.delta', null);

        $override = PayrollOverride::firstOrFail();
        $this->assertSame($this->admin->id, $override->created_by);
        $this->assertNull($override->approved_by);
    }

    /**
     * Saving is a request, not an effect. This is the rule the whole module
     * rests on: the figures move at the next process, never at save.
     */
    #[Test]
    public function raising_an_override_records_a_created_audit_row(): void
    {
        $this->raise()->assertStatus(201);

        $audit = PayrollOverrideAudit::firstOrFail();

        $this->assertSame(PayrollOverrideAudit::ACTION_CREATED, $audit->action);
        $this->assertSame($this->admin->id, $audit->actor_id);
        $this->assertNull($audit->before_json, 'A creation has no prior state.');
        $this->assertSame(PayrollOverride::STATUS_PENDING, $audit->after_json['status']);
    }

    /**
     * Keka's gate — "Allow this component to be customized and overridden at
     * the employee level" — enforced server-side, so a client that offers the
     * component anyway still cannot write through it.
     */
    #[Test]
    public function an_ungated_component_is_refused_and_the_gate_is_named(): void
    {
        SalaryComponent::query()->update(['allow_employee_override' => false]);

        $response = $this->raise()
            ->assertStatus(422)
            ->assertJsonPath('success', false);

        $this->assertStringContainsString(
            'Allow this component to be overridden',
            $response->json('message'),
            'The refusal must name the gate that has to be opened, not merely refuse.',
        );

        $this->assertSame(0, PayrollOverride::count());
    }

    /**
     * Two residuals is not a preference the balancer can resolve — it genuinely
     * cannot know which component absorbs the delta.
     */
    #[Test]
    public function an_ambiguous_residual_is_refused_as_a_configuration_error(): void
    {
        $this->gatedComponent(['name' => 'Special Allowance', 'code' => 'SPL', 'category' => 'allowance', 'is_residual' => true]);
        $this->gatedComponent(['name' => 'Other Allowance', 'code' => 'OTH', 'category' => 'allowance', 'is_residual' => true]);

        $response = $this->raise()->assertStatus(422);

        $this->assertStringContainsString('More than one salary component', $response->json('message'));
        $this->assertSame(0, PayrollOverride::count());
    }

    /**
     * The refusal that matters most, and the one that must carry a number.
     *
     * "Invalid structure" is not actionable. "Basic can go up to ₹62,403.10" is,
     * and the figure has to be the balancer's own — a second derivation here
     * would eventually drift from the one the engine enforces.
     */
    #[Test]
    public function an_override_that_would_drive_the_residual_negative_is_refused_with_the_maximum(): void
    {
        $response = $this->raise(['value' => 90000])->assertStatus(422);

        $this->assertEqualsWithDelta(
            $this->maxPermitted(),
            (float) $response->json('max_permitted'),
            0.01,
            'The refusal must name the balancer\'s own ceiling, not a re-derived one.',
        );

        $this->assertSame(0, PayrollOverride::count());
    }

    /** And the named maximum is itself accepted, or the message is a dead end. */
    #[Test]
    public function the_maximum_the_refusal_names_is_itself_accepted(): void
    {
        $this->raise(['value' => floor($this->maxPermitted())])->assertStatus(201);
    }

    /**
     * Increasing gross funds the change by enlarging the envelope, so the
     * residual is untouched and the ceiling does not apply.
     */
    #[Test]
    public function increasing_gross_is_not_held_to_the_residual_ceiling(): void
    {
        $this->raise(['value' => 90000, 'balance_mode' => 'increase_gross'])->assertStatus(201);
    }

    #[Test]
    public function two_overlapping_overrides_on_the_same_target_are_refused(): void
    {
        $this->raise(['effective_from' => '2026-06-01', 'effective_to' => '2026-08-31'])->assertStatus(201);

        $response = $this->raise(['effective_from' => '2026-08-01', 'effective_to' => '2026-09-30'])
            ->assertStatus(422);

        $this->assertStringContainsString('Close the existing override first', $response->json('message'));
        $this->assertSame(1, PayrollOverride::count());
    }

    /** An open-ended override reaches forever, so nothing after it can be raised. */
    #[Test]
    public function an_open_ended_override_blocks_a_later_one_on_the_same_target(): void
    {
        $this->raise(['effective_from' => '2026-06-01'])->assertStatus(201);

        $this->raise(['effective_from' => '2027-01-01'])->assertStatus(422);
    }

    #[Test]
    public function a_non_overlapping_period_on_the_same_target_is_allowed(): void
    {
        $this->raise(['effective_from' => '2026-06-01', 'effective_to' => '2026-06-30'])->assertStatus(201);

        $this->raise(['effective_from' => '2026-07-01', 'effective_to' => '2026-07-31'])->assertStatus(201);
    }

    /** A rejected override is history, not cover. */
    #[Test]
    public function a_rejected_override_does_not_block_a_replacement(): void
    {
        $this->raise()->assertStatus(201);
        PayrollOverride::query()->update(['status' => PayrollOverride::STATUS_REJECTED]);

        $this->raise()->assertStatus(201);
    }

    #[Test]
    public function an_override_without_a_reason_is_refused(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/payroll/operations/overrides', collect($this->payload())->except('reason')->all())
            ->assertStatus(422)
            ->assertJsonValidationErrors('reason');
    }

    #[Test]
    public function a_one_word_reason_is_refused(): void
    {
        $this->raise(['reason' => 'fix'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('reason');
    }

    /**
     * Phase 1 refuses the other three scopes outright. An ad-hoc override that
     * stores cleanly and then does nothing at process time is a worse failure
     * than one that never stored.
     */
    #[Test]
    public function an_unsupported_scope_is_refused_rather_than_half_accepted(): void
    {
        $response = $this->raise(['scope' => 'adhoc'])->assertStatus(422);

        $this->assertStringContainsString('not yet supported', $response->json('message'));
        $this->assertSame(0, PayrollOverride::count());
    }

    /**
     * The global scope makes the cross-tenant case a non-resolution rather than
     * a separate check, which is exactly the point of it.
     */
    #[Test]
    public function an_employee_in_another_organisation_cannot_be_targeted(): void
    {
        $otherOrg = Organization::factory()->create();
        $stranger = User::factory()->create(['organization_id' => $otherOrg->id, 'role' => 'employee']);

        $this->raise(['user_id' => $stranger->id])
            ->assertStatus(422)
            ->assertJsonPath('message', 'That employee is not in this organisation.');

        $this->assertSame(0, PayrollOverride::count());
    }

    /**
     * "Set basic to 6,00,000" has two arithmetic meanings and the engine cannot
     * guess which. Defaulting silently would pick one of them on the admin's
     * behalf, and the two differ by the employee's whole CTC.
     */
    #[Test]
    public function a_component_override_must_state_what_funds_it(): void
    {
        $this->actingAs($this->admin)
            ->postJson('/api/payroll/operations/overrides', collect($this->payload())->except('balance_mode')->all())
            ->assertStatus(422);

        $this->assertSame(0, PayrollOverride::count());
    }

    /** The residual is snapshotted at entry, not re-derived when it is applied. */
    #[Test]
    public function the_absorbing_component_is_recorded_when_the_override_is_raised(): void
    {
        $residual = $this->gatedComponent([
            'name' => 'Special Allowance',
            'code' => 'SPL',
            'category' => 'allowance',
            'is_residual' => true,
        ]);

        $this->raise()->assertStatus(201);

        $this->assertSame($residual->id, PayrollOverride::firstOrFail()->balancing_target_id);
    }

    #[Test]
    public function a_statutory_override_needs_no_component_gate(): void
    {
        SalaryComponent::query()->update(['allow_employee_override' => false]);

        $this->raise([
            'scope' => 'statutory',
            'target' => 'pf',
            'value' => 1800,
            'balance_mode' => null,
        ])->assertStatus(201);
    }

    /**
     * Nothing about payroll moves when an override is saved. This is the rule
     * every other guarantee in the module depends on.
     */
    #[Test]
    public function saving_an_override_does_not_touch_the_salary_structure(): void
    {
        $before = EmployeePayrollTemplate::firstOrFail()->only([
            'annual_ctc', 'basic_percentage', 'hra_percentage', 'conveyance_allowance',
        ]);

        $this->raise()->assertStatus(201);

        $this->assertEquals($before, EmployeePayrollTemplate::firstOrFail()->only([
            'annual_ctc', 'basic_percentage', 'hra_percentage', 'conveyance_allowance',
        ]));
    }

    #[Test]
    public function an_employee_cannot_raise_an_override(): void
    {
        $this->actingAs($this->employee)
            ->postJson('/api/payroll/operations/overrides', $this->payload())
            ->assertStatus(403);
    }

    /** Preview answers "what would happen" and a refusal is a successful answer. */
    #[Test]
    public function preview_returns_a_refusal_as_two_hundred_where_store_returns_four_twenty_two(): void
    {
        $preview = $this->actingAs($this->admin)->postJson('/api/payroll/operations/overrides/preview', [
            'user_id' => $this->employee->id,
            'target' => 'basic',
            'value' => 90000,
            'balance_mode' => OverrideBalancingService::MODE_PRESERVE_CTC,
        ])->assertStatus(200);

        $this->assertFalse($preview->json('preview.permitted'));

        $this->raise(['value' => 90000])->assertStatus(422);
    }
}
