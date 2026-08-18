<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\PayrollOverride;
use App\Models\User;
use App\Services\Payroll\OverrideApplicationService;
use App\Services\PayrollCalculatorService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Overrides apply at process time, and record what they replaced.
 *
 * Both values are kept because only the pair explains a payslip: `value` is
 * what was paid, `computed_value` is what the engine would have paid. The
 * cascade is the part no product in this market surfaces — overriding basic
 * moves HRA, employer PF and the gratuity provision with it, and without a
 * record of that the differences report can say HRA changed but never why.
 */
class OverrideApplicationTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private User $employee;
    private OverrideApplicationService $application;

    private float $monthlyCtc = 100000.0;

    private array $config = [
        'basic_percentage' => 0.40,
        'hra_percentage_of_basic' => 0.50,
        'conveyance_allowance' => 1600,
    ];

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->employee = User::factory()->create([
            'organization_id' => $this->organization->id,
            'role' => 'employee',
        ]);
        $this->application = app(OverrideApplicationService::class);
    }

    private function baseComponents(): array
    {
        return app(PayrollCalculatorService::class)
            ->calculateSalaryComponents($this->monthlyCtc, $this->config);
    }

    private function override(array $attributes = []): PayrollOverride
    {
        return PayrollOverride::create(array_merge([
            'organization_id' => $this->organization->id,
            'user_id' => $this->employee->id,
            'scope' => 'component',
            'target' => 'basic',
            'mode' => 'fixed',
            'value' => 45000,
            'balance_mode' => 'preserve_ctc',
            'effective_from' => '2026-06-01',
            'reason' => 'Correction to an understated component',
            'status' => PayrollOverride::STATUS_APPROVED,
        ], $attributes));
    }

    private function applyFor(string $monthYear = '2026-06'): array
    {
        return $this->application->apply(
            $this->baseComponents(),
            $this->employee->id,
            $this->organization->id,
            $monthYear,
            $this->monthlyCtc,
            $this->config,
        );
    }

    #[Test]
    public function no_override_leaves_the_structure_untouched(): void
    {
        $result = $this->applyFor();

        $this->assertSame([], $result['applied']);
        $this->assertEquals($this->baseComponents(), $result['components']);
    }

    #[Test]
    public function an_approved_override_moves_the_component_it_names(): void
    {
        $this->override(['value' => 45000]);

        $components = $this->applyFor()['components'];

        $this->assertEqualsWithDelta(45000.0, $components['basic'], 0.01);
    }

    /**
     * The half that explains the payslip. Without computed_value the register
     * can say what was paid but never what would have been.
     */
    #[Test]
    public function the_engines_own_figure_is_written_back(): void
    {
        $override = $this->override(['value' => 45000]);

        $this->applyFor();

        // 40% of a 100,000 monthly CTC.
        $this->assertEqualsWithDelta(40000.0, (float) $override->fresh()->computed_value, 0.01);
        $this->assertSame(5000.0, $override->fresh()->delta());
    }

    /**
     * Overriding basic does not move basic alone. HRA is derived from it, and
     * the residual absorbs the amplified delta — 1.548 per rupee here, because
     * employer PF is already at its cap.
     */
    #[Test]
    public function the_cascade_records_every_derived_component_that_moved(): void
    {
        $override = $this->override(['value' => 45000]);

        $cascade = $this->applyFor()['applied'][0]['cascade'];

        $this->assertArrayHasKey('hra', $cascade, 'HRA is derived from basic and must appear.');
        $this->assertArrayHasKey('special_allowance', $cascade, 'The residual absorbed the delta.');
        $this->assertArrayNotHasKey('basic', $cascade, 'The overridden component is not part of its own cascade.');

        // HRA is half of basic, so a 5,000 rise in basic moves it by 2,500.
        $this->assertEqualsWithDelta(2500.0, $cascade['hra']['delta'], 0.01);
        // And the residual falls by more than the raise itself.
        $this->assertLessThan(-5000.0, $cascade['special_allowance']['delta']);

        // assertEquals, not assertSame: the snapshot round-trips through JSON,
        // which renders 2500.0 as 2500 and decodes it as an int.
        $this->assertEquals($cascade, $override->fresh()->cascade_snapshot);
    }

    /**
     * The identity has to survive an override, or the payslip stops footing —
     * which is the defect the residual clamp used to cause.
     */
    #[Test]
    public function the_components_still_sum_to_gross_after_an_override(): void
    {
        $this->override(['value' => 45000]);

        $c = $this->applyFor()['components'];

        $this->assertEqualsWithDelta(
            $c['gross'],
            $c['basic'] + $c['hra'] + $c['conveyance'] + $c['special_allowance'],
            0.01
        );
    }

    #[Test]
    public function a_pending_override_does_not_apply(): void
    {
        $this->override(['status' => PayrollOverride::STATUS_PENDING]);

        $this->assertSame([], $this->applyFor()['applied']);
    }

    #[Test]
    public function an_override_outside_its_date_range_does_not_apply(): void
    {
        $this->override(['effective_from' => '2026-06-01', 'effective_to' => '2026-06-30']);

        $this->assertSame([], $this->applyFor('2026-07')['applied']);
        $this->assertCount(1, $this->applyFor('2026-06')['applied']);
    }

    /**
     * A previously valid override can stop fitting if the structure moves
     * underneath it — a CTC cut, say. Skipping is right: the alternative is
     * paying out of a residual the employee no longer has.
     */
    #[Test]
    public function an_override_that_no_longer_fits_is_skipped_rather_than_forced(): void
    {
        $this->override(['value' => 95000]);

        $result = $this->applyFor();

        $this->assertSame([], $result['applied']);
        $this->assertEqualsWithDelta(40000.0, $result['components']['basic'], 0.01, 'The structure is left as computed.');
    }

    /**
     * An override naming a component this structure does not produce is a
     * configuration error, not a reason to fail the run and leave the employee
     * unpaid.
     */
    #[Test]
    public function an_override_on_an_unknown_component_does_not_break_the_run(): void
    {
        $this->override(['target' => 'nonexistent_component']);

        $result = $this->applyFor();

        $this->assertSame([], $result['applied']);
        $this->assertEqualsWithDelta(40000.0, $result['components']['basic'], 0.01);
    }
}
