<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\MetricOverrides;
use App\Services\Ai\SchemaIntrospector;
use App\Services\Ai\SemanticLayer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Coverage is derived; correctness is curated. This test asserts the seam
 * between the two, because that seam is where a right number becomes a wrong
 * one — a merge that replaces a whole entity loses fifty derived metrics, and a
 * merge that ignores the override reintroduces the ₹76,313 average.
 *
 * RefreshDatabase because entities() now derives from the real schema —
 * SemanticLayer stopped being pure hand-written data the moment it started
 * consuming SchemaIntrospector, and every test that touches it needs a
 * migrated database under it or it silently sees zero tables.
 */
class SemanticLayerDerivationTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_curated_override_beats_derivation_without_deleting_its_siblings(): void
    {
        $metric = SemanticLayer::metric('payroll', 'avg_net_pay');

        $this->assertSame('curated', $metric['origin']);
        $this->assertContains(['payroll_items.net_pay', '>', 0], $metric['where']);

        // The override replaced ONE metric, not the table's whole metric set.
        $this->assertGreaterThan(5, count(SemanticLayer::entity('payroll')['metrics']));
    }

    public function test_a_derived_metric_declares_that_it_is_naive(): void
    {
        $metrics = SemanticLayer::entity('assets')['metrics'];
        $origins = array_column($metrics, 'origin');

        $this->assertContains('derived', $origins, 'derivation produced no derived metric at all');
        foreach ($metrics as $name => $metric) {
            $this->assertContains($metric['origin'], ['derived', 'curated'], "{$name} has no origin");
        }
    }

    public function test_the_concept_key_and_its_table_name_are_not_both_entities(): void
    {
        $this->assertNotNull(SemanticLayer::entity('payroll'));
        $this->assertNull(SemanticLayer::entity('payroll_items'));

        $this->assertNotNull(SemanticLayer::entity('activity'));
        $this->assertNull(SemanticLayer::entity('activity_sessions'));
    }

    public function test_an_excluded_column_is_not_reachable_by_any_route(): void
    {
        foreach (SemanticLayer::entities() as $key => $entity) {
            foreach (['dimensions', 'list_columns'] as $bucket) {
                foreach (array_keys($entity[$bucket]) as $name) {
                    $this->assertFalse(
                        SchemaIntrospector::isExcludedColumn($name),
                        "{$key}.{$bucket}.{$name} exposes an excluded column"
                    );
                }
            }
        }
    }

    public function test_every_person_bearing_entity_can_be_grouped_by_employee(): void
    {
        // Grouping by employee is what turns "how many" into "who", and "who" is
        // most of what an admin asks.
        foreach (['payroll', 'attendance', 'leave', 'activity'] as $key) {
            $this->assertNotNull(
                SemanticLayer::dimension($key, 'employee'),
                "{$key} cannot answer 'who' — it has no employee dimension"
            );
        }
    }

    public function test_coverage_is_the_schema_not_eight_tables(): void
    {
        $this->assertGreaterThan(70, count(SemanticLayer::entities()));
    }

    public function test_list_column_lookup_refuses_an_unknown_column(): void
    {
        $this->assertNotNull(SemanticLayer::listColumn('employees', 'name'));
        $this->assertNull(SemanticLayer::listColumn('employees', 'pan'));
        $this->assertNull(SemanticLayer::listColumn('employees', 'nationality'));
    }

    public function test_the_prompt_catalogue_carries_only_the_retrieved_entities(): void
    {
        $text = SemanticLayer::promptCatalogueFor(['payroll', 'attendance']);

        $this->assertStringContainsString('avg_net_pay', $text);
        $this->assertStringNotContainsString('asset_count', $text);
    }

    public function test_cached_does_not_re_derive(): void
    {
        SemanticLayer::cached();

        DB::enableQueryLog();
        SemanticLayer::cached();

        $this->assertSame([], DB::getQueryLog(), 'cached() went back to the database');
    }

    /**
     * Pins the prompt budget. `payroll` alone derives 300+ sum/avg/min/max
     * metrics (one set per numeric column), and enumerating them blew a
     * single entity past the whole catalogue's token budget — 8,666 chars
     * (~2,166 tokens) for `payroll` alone, against a spec target of 1-2k
     * tokens for the retrieved set. `promptCatalogueFor()` now expresses
     * derived metrics by pattern instead of enumeration; this is the
     * regression guard so a future derived metric (a new column, a new
     * table) cannot silently reopen the budget without a test noticing.
     *
     * Asserted in characters, not tokens, so this does not depend on a
     * tokeniser. `payroll` is included deliberately — it is the worst case.
     */
    public function test_the_prompt_catalogue_stays_within_budget(): void
    {
        $entities = ['employees', 'payroll', 'attendance', 'leave', 'assets', 'work', 'hiring', 'activity'];

        $text = SemanticLayer::promptCatalogueFor($entities);

        $this->assertLessThan(
            8000,
            strlen($text),
            'promptCatalogueFor() over the 8 concept entities exceeds the prompt budget — '.strlen($text).' chars'
        );
    }

    /**
     * The budget test above proves the catalogue is small; this proves it did
     * not get small by silently dropping vocabulary. `basic` is a real
     * payroll_items money column with no curated override, so it only
     * reaches the catalogue through the derived pattern line — if the
     * pattern compression ever lost a column instead of just its enumerated
     * form, this is what would catch it.
     */
    public function test_a_derived_only_column_still_reaches_the_catalogue_via_its_pattern(): void
    {
        $text = SemanticLayer::promptCatalogueFor(['payroll']);

        $metric = SemanticLayer::metric('payroll', 'sum_basic');
        $this->assertSame('derived', $metric['origin'], 'fixture assumption: sum_basic must be a real derived metric');

        $this->assertStringContainsString('basic', $text);
        // Not enumerated: the compound key must NOT appear literally, or the
        // catalogue is back to spelling out every aggregate per column.
        $this->assertStringNotContainsString('sum_basic', $text);
    }
}
