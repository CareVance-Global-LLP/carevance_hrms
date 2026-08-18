<?php

namespace Tests\Feature;

use App\Models\Organization;
use App\Models\SalaryComponent;
use App\Services\Payroll\OverrideBalancingService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * What absorbs an override, and what happens when nothing can.
 *
 * The two behaviours no vendor in this market documents, decided here:
 * the residual is a role with a taxable fallback chain, and a negative residual
 * is refused at entry with the maximum named — never clamped, never deferred to
 * finalisation, never resolved by silently dropping a component.
 */
class OverrideBalancingTest extends TestCase
{
    use RefreshDatabase;

    private Organization $organization;
    private OverrideBalancingService $balancer;

    /** The default structure: 40% basic, HRA at half of basic, 1,600 conveyance. */
    private array $config = [
        'basic_percentage' => 0.40,
        'hra_percentage_of_basic' => 0.50,
        'conveyance_allowance' => 1600,
    ];

    protected function setUp(): void
    {
        parent::setUp();

        $this->organization = Organization::factory()->create();
        $this->balancer = app(OverrideBalancingService::class);
    }

    private function salaryComponent(string $name, array $attributes = []): SalaryComponent
    {
        return SalaryComponent::create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => $name,
            'code' => strtolower(str_replace(' ', '_', $name)),
            'category' => 'allowance',
            'impact' => 'earning',
            'value_type' => 'fixed',
            'default_value' => 0,
            'is_taxable' => true,
            'is_active' => true,
        ], $attributes));
    }

    // ------------------------------------------------- The residual as a role

    #[Test]
    public function the_designated_residual_absorbs_by_default(): void
    {
        $this->salaryComponent('HRA', ['is_taxable' => false, 'residual_order' => 1]);
        $special = $this->salaryComponent('Special Allowance', ['is_residual' => true, 'residual_order' => 2]);

        $this->assertSame(
            $special->id,
            $this->balancer->resolveResidual($this->organization->id)?->id
        );
    }

    /**
     * Keka's documented fallback, and the reason is_taxable exists on this
     * table. The word taxable is load-bearing: falling back onto HRA or
     * conveyance would change the employee's tax position while trying to
     * satisfy an arithmetic identity.
     */
    #[Test]
    public function without_a_designated_residual_the_next_taxable_component_absorbs(): void
    {
        $this->salaryComponent('Conveyance', ['is_taxable' => false, 'residual_order' => 1]);
        $bonus = $this->salaryComponent('Other Allowance', ['is_taxable' => true, 'residual_order' => 2]);

        $this->assertSame(
            $bonus->id,
            $this->balancer->resolveResidual($this->organization->id)?->id,
            'The chain must skip non-taxable components rather than eroding them.'
        );
    }

    #[Test]
    public function a_component_cannot_absorb_its_own_override(): void
    {
        $special = $this->salaryComponent('Special Allowance', ['is_residual' => true]);
        $other = $this->salaryComponent('Other Allowance', ['is_taxable' => true, 'residual_order' => 5]);

        $this->assertSame(
            $other->id,
            $this->balancer->resolveResidual($this->organization->id, $special->id)?->id
        );
    }

    #[Test]
    public function nothing_taxable_means_no_residual_at_all(): void
    {
        $this->salaryComponent('HRA', ['is_taxable' => false]);
        $this->salaryComponent('Conveyance', ['is_taxable' => false]);

        $this->assertNull(
            $this->balancer->resolveResidual($this->organization->id),
            'An override with nowhere legal to land must be refused, not forced somewhere.'
        );
    }

    /**
     * Zoho enforces one residual per structure structurally. Two is not a
     * preference — the balancer genuinely cannot know which absorbs the delta.
     */
    #[Test]
    public function two_residuals_are_reported_as_a_configuration_error(): void
    {
        $this->salaryComponent('Special Allowance', ['is_residual' => true]);
        $this->assertFalse($this->balancer->hasAmbiguousResidual($this->organization->id));

        $this->salaryComponent('Flexi Allowance', ['is_residual' => true]);
        $this->assertTrue($this->balancer->hasAmbiguousResidual($this->organization->id));
    }

    // ------------------------------------------------------- The amplification

    /**
     * The number nobody shows an admin. Raising basic by 10,000 costs the
     * residual 16,681, not 10,000, because HRA is derived from basic and
     * employer PF and gratuity sit inside the CTC envelope.
     */
    #[Test]
    public function the_residual_falls_faster_than_basic_rises(): void
    {
        $monthlyCtc = 100000.0;

        $assessment = $this->balancer->assess($monthlyCtc, $this->config, 45000.0);

        $this->assertEqualsWithDelta(1.5481, $assessment['amplification'], 0.0001);

        $spent = $assessment['residual_before'] - $assessment['residual_after'];
        $raised = $assessment['requested'] - $assessment['current'];

        $this->assertGreaterThan($raised, $spent, 'The residual funds more than the raise itself.');
        $this->assertEqualsWithDelta($raised * $assessment['amplification'], $spent, 0.01);
    }

    // ------------------------------------------------------------ The refusal

    #[Test]
    public function an_override_the_residual_can_absorb_is_permitted(): void
    {
        $assessment = $this->balancer->assess(100000.0, $this->config, 45000.0);

        $this->assertTrue($assessment['permitted']);
        $this->assertGreaterThanOrEqual(0, $assessment['residual_after']);
    }

    /**
     * Refused at entry, with the maximum named. Keka drops components silently;
     * Razorpay accepts and rejects weeks later at finalisation. Both leave the
     * admin with an unexplainable payslip; this leaves them with a number.
     */
    #[Test]
    public function an_override_that_would_go_negative_is_refused_with_the_maximum(): void
    {
        $assessment = $this->balancer->assess(100000.0, $this->config, 90000.0);

        $this->assertFalse($assessment['permitted']);
        $this->assertLessThan(0, $assessment['residual_after']);
        $this->assertGreaterThan(0, $assessment['max_permitted']);
        $this->assertStringContainsString('Basic can go up to', $assessment['message']);
    }

    /**
     * The named maximum has to be exact, or it is worse than no number at all:
     * an admin who retries at the stated value and is refused again learns not
     * to trust the message.
     */
    #[Test]
    public function the_named_maximum_is_itself_permitted(): void
    {
        $refused = $this->balancer->assess(100000.0, $this->config, 90000.0);

        $atMax = $this->balancer->assess(100000.0, $this->config, $refused['max_permitted']);

        $this->assertTrue($atMax['permitted'], 'The maximum this refusal names must actually be accepted.');
        $this->assertEqualsWithDelta(0.0, $atMax['residual_after'], 0.02);
    }

    /**
     * The escape hatch: an override too large for the residual is legitimate if
     * the organisation accepts that CTC rises. That is a different decision,
     * not a workaround, which is why it is an explicit mode.
     */
    #[Test]
    public function increasing_gross_leaves_the_residual_alone(): void
    {
        $assessment = $this->balancer->assess(
            100000.0,
            $this->config,
            90000.0,
            OverrideBalancingService::MODE_INCREASE_GROSS
        );

        $this->assertTrue($assessment['permitted']);
        $this->assertSame($assessment['residual_before'], $assessment['residual_after']);
    }
}
