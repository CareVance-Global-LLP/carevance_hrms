<?php

namespace Tests\Unit;

use App\Models\FbpAllocation;
use App\Models\FbpComponent;
use App\Models\Organization;
use App\Models\User;
use App\Services\FbpService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * FBP taxability tests.
 *
 * Verifies that only the portion of a taxable FBP component above its
 * exemption limit is taxed, and that non-taxable components (e.g. food
 * coupons) remain fully exempt. These protect the real-money FBP tax
 * exemption bug fix in FbpService::calculateTaxExemptions.
 */
class FbpTaxExemptionTest extends TestCase
{
    use RefreshDatabase;

    protected FbpService $fbp;
    protected Organization $organization;
    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        $this->fbp = new FbpService();
        $this->organization = Organization::create([
            'name' => 'Test Org',
            'slug' => 'test-org-' . uniqid(),
        ]);
        $this->user = User::factory()->create([
            'organization_id' => $this->organization->id,
        ]);
    }

    private function makeComponent(array $attributes): FbpComponent
    {
        return FbpComponent::create(array_merge([
            'organization_id' => $this->organization->id,
            'name' => 'Component',
            'code' => 'CMP-' . uniqid(),
            'category' => 'allowance',
            'max_exempt_limit' => 50000,
            'requires_proof' => false,
            'is_taxable' => true,
            'description' => 'test',
            'is_active' => true,
        ], $attributes));
    }

    private function makeAllocation(FbpComponent $component, float $approved): FbpAllocation
    {
        return FbpAllocation::create([
            'organization_id' => $this->organization->id,
            'user_id' => $this->user->id,
            'fbp_component_id' => $component->id,
            'financial_year' => '2025-26',
            'allocated_amount' => $approved,
            'utilized_amount' => $approved,
            'claimed_amount' => $approved,
            'approved_amount' => $approved,
            'status' => 'active',
        ]);
    }

    /**
     * Taxable component: approved amount within the exemption limit -> taxable 0.
     */
    public function test_taxable_claim_within_limit_is_fully_exempt(): void
    {
        $component = $this->makeComponent(['is_taxable' => true, 'max_exempt_limit' => 50000]);
        $this->makeAllocation($component, 50000);

        $result = $this->fbp->calculateTaxExemptions($this->user->id, $this->organization->id);

        $this->assertCount(1, $result);
        $this->assertEquals(50000, $result[0]['approved']);
        $this->assertEquals(50000, $result[0]['exempt_amount']);
        $this->assertEquals(0, $result[0]['taxable_amount']);
    }

    /**
     * Taxable component: approved amount above the exemption limit ->
     * taxable = approved - limit.
     */
    public function test_taxable_claim_above_limit_taxes_only_excess(): void
    {
        $component = $this->makeComponent(['is_taxable' => true, 'max_exempt_limit' => 50000]);
        $this->makeAllocation($component, 80000);

        $result = $this->fbp->calculateTaxExemptions($this->user->id, $this->organization->id);

        $this->assertEquals(80000, $result[0]['approved']);
        $this->assertEquals(50000, $result[0]['exempt_amount']);
        $this->assertEquals(30000, $result[0]['taxable_amount']);
    }

    /**
     * Non-taxable component (food coupons) remains fully exempt regardless
     * of approved amount.
     */
    public function test_non_taxable_component_remains_fully_exempt(): void
    {
        $component = $this->makeComponent(['is_taxable' => false, 'max_exempt_limit' => 50000]);
        $this->makeAllocation($component, 120000);

        $result = $this->fbp->calculateTaxExemptions($this->user->id, $this->organization->id);

        $this->assertEquals(120000, $result[0]['approved']);
        $this->assertEquals(120000, $result[0]['exempt_amount']);
        $this->assertEquals(0, $result[0]['taxable_amount']);
    }

    /**
     * Multiple components: each is netted independently and the tax-base
     * exclusion equals the sum of (approved - taxable).
     */
    public function test_fbp_tax_exclusion_sums_non_taxable_portion(): void
    {
        $taxable = $this->makeComponent(['is_taxable' => true, 'max_exempt_limit' => 50000]);
        $this->makeAllocation($taxable, 80000); // 30000 taxable, 50000 exempt

        $nonTaxable = $this->makeComponent(['is_taxable' => false, 'max_exempt_limit' => 50000]);
        $this->makeAllocation($nonTaxable, 20000); // 0 taxable, 20000 exempt

        $exclusion = $this->fbp->getFbpTaxExclusion($this->user->id, $this->organization->id);

        // 50000 (within-limit portion of taxable) + 20000 (full non-taxable)
        $this->assertEquals(70000, $exclusion);
    }
}
