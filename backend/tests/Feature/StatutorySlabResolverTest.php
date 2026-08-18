<?php

namespace Tests\Feature;

use App\Services\Payroll\StatutorySlabResolver;
use App\Services\PTStateService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Statutory slabs resolve against the period being computed.
 *
 * The question neither Keka nor greytHR documents: when you recompute March,
 * whose slab applies? March's. That is the whole reason the table carries a
 * date range instead of a "current" flag, and it is the property that makes a
 * corrected month reproducible.
 */
class StatutorySlabResolverTest extends TestCase
{
    use RefreshDatabase;

    private StatutorySlabResolver $resolver;

    protected function setUp(): void
    {
        parent::setUp();
        $this->resolver = app(StatutorySlabResolver::class);
    }

    #[Test]
    public function the_migration_seeds_every_configured_jurisdiction(): void
    {
        $expected = count(PTStateService::getStates());

        $this->assertSame(
            $expected,
            DB::table('statutory_slabs')->where('kind', 'pt')->count(),
            'Every jurisdiction the service knows about must have a row, or resolution silently falls back.'
        );

        $this->assertGreaterThan(0, DB::table('statutory_slabs')->where('kind', 'lwf')->count());
    }

    /**
     * The migration moves the data; it must not restate it. Any drift here is a
     * silent change to what employees are charged.
     */
    #[Test]
    public function the_seeded_table_agrees_with_the_compiled_constants(): void
    {
        foreach (PTStateService::getStates() as $state) {
            foreach ([5000.0, 15000.0, 30000.0, 60000.0] as $gross) {
                $this->assertEqualsWithDelta(
                    PTStateService::calculate($state['code'], $gross, 6),
                    $this->resolver->professionalTax($state['code'], $gross, '2026-06'),
                    0.01,
                    "Seeded slab for {$state['code']} disagrees with the constant at gross {$gross}"
                );
            }
        }
    }

    /**
     * Maharashtra's February instalment applies only to the top band — that is
     * what makes the top band total the ₹2,500 annual figure. Applying it to
     * every non-zero band over-collects from lower earners.
     */
    #[Test]
    public function the_special_month_instalment_survives_the_move_to_the_table(): void
    {
        $this->assertSame(300.0, $this->resolver->professionalTax('maharashtra', 25000, '2026-02'));
        $this->assertSame(175.0, $this->resolver->professionalTax('maharashtra', 9000, '2026-02'));
        $this->assertSame(200.0, $this->resolver->professionalTax('maharashtra', 25000, '2026-01'));
    }

    #[Test]
    public function a_jurisdiction_that_levies_nothing_still_deducts_nothing(): void
    {
        foreach (['delhi', 'chandigarh', 'goa', 'uttarakhand'] as $state) {
            $this->assertSame(
                0.0,
                $this->resolver->professionalTax($state, 500000, '2026-06'),
                "{$state} levies no professional tax"
            );
        }
    }

    /**
     * The property the whole design turns on: a rate change closes the old row
     * and opens a new one, and each month keeps resolving to the rate that was
     * in force then.
     */
    #[Test]
    public function a_rate_change_does_not_restate_earlier_months(): void
    {
        // Karnataka's stored slab is nil to 15,000 then 200.
        $this->assertSame(200.0, $this->resolver->professionalTax('karnataka', 30000, '2026-05'));

        DB::table('statutory_slabs')
            ->where('kind', 'pt')->where('state_code', 'karnataka')
            ->update(['effective_to' => '2026-05-31']);

        DB::table('statutory_slabs')->insert([
            'kind' => 'pt',
            'state_code' => 'karnataka',
            'effective_from' => '2026-06-01',
            'effective_to' => null,
            'frequency' => 'monthly',
            'slabs' => json_encode(['monthly' => [
                ['min' => 0, 'max' => 15000, 'amount' => 0],
                ['min' => 15001, 'max' => null, 'amount' => 250],
            ]]),
            'annual_cap' => 2500,
            'source_note' => 'Test fixture',
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $fresh = app(StatutorySlabResolver::class);

        $this->assertSame(250.0, $fresh->professionalTax('karnataka', 30000, '2026-06'), 'June is on the new rate.');
        $this->assertSame(200.0, $fresh->professionalTax('karnataka', 30000, '2026-05'), 'May must keep the rate May paid.');
        $this->assertSame(200.0, $fresh->professionalTax('karnataka', 30000, '2026-04'));
    }

    /**
     * A rate that takes effect mid-month governs that whole month: a statutory
     * base cannot change halfway through a contribution period without making
     * the return unfilable.
     */
    #[Test]
    public function a_mid_month_effective_date_governs_the_whole_month(): void
    {
        DB::table('statutory_slabs')
            ->where('kind', 'pt')->where('state_code', 'karnataka')
            ->update(['effective_from' => '2026-06-20']);

        $this->assertSame(
            200.0,
            app(StatutorySlabResolver::class)->professionalTax('karnataka', 30000, '2026-06')
        );
    }

    #[Test]
    public function an_unknown_state_deducts_nothing(): void
    {
        $this->assertSame(0.0, $this->resolver->professionalTax('atlantis', 50000, '2026-06'));
        $this->assertSame(0.0, $this->resolver->professionalTax('', 50000, '2026-06'));
    }

    /**
     * No stored slab may breach the Article 276(2) ceiling — the same property
     * asserted over the constants, re-asserted over the table it seeded, since
     * a future row could be added without going through the constants at all.
     */
    #[Test]
    public function no_stored_slab_breaches_the_constitutional_cap(): void
    {
        foreach (PTStateService::getStates() as $state) {
            $annual = 0.0;
            for ($month = 1; $month <= 12; $month++) {
                $annual += $this->resolver->professionalTax(
                    $state['code'],
                    1000000,
                    sprintf('2026-%02d', $month)
                );
            }

            $this->assertLessThanOrEqual(
                2500.0,
                $annual,
                "{$state['code']} exceeds the Article 276(2) ceiling of 2,500"
            );
        }
    }
}
