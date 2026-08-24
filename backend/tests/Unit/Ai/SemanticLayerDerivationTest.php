<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\SchemaIntrospector;
use App\Services\Ai\SemanticLayer;
use Illuminate\Database\Events\MigrationsEnded;
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

    /**
     * The spec says derivation is `never computed per request`, and this is the
     * assertion that means it.
     *
     * `entity()` read `entities()` rather than `cached()`, so every lookup
     * re-derived all 149 entities from the live schema — 0.95s each against
     * Postgres, with no amortisation, and about eight lookups between
     * PlanValidator and QueryPlanExecutor for one question. The cache was
     * correct and nothing used it.
     *
     * Asserted as "issues no query", NOT as a duration. A timing assertion
     * would be flaky on CI, and worse, it could not fail here at all: the suite
     * runs on :memory: SQLite where deriving the whole schema is nearly free,
     * which is exactly why this defect survived a green suite.
     */
    public function test_a_lookup_never_touches_the_database(): void
    {
        // Warm the layer once, the way the first lookup in a request does.
        SemanticLayer::cached();

        DB::enableQueryLog();

        $entity = SemanticLayer::entity('payroll');
        $metric = SemanticLayer::metric('payroll', 'avg_net_pay');
        $late = SemanticLayer::metric('attendance', 'late_count');
        $department = SemanticLayer::dimension('payroll', 'department');
        $status = SemanticLayer::dimension('leave', 'status');
        $name = SemanticLayer::listColumn('employees', 'name');

        $this->assertSame(
            [],
            DB::getQueryLog(),
            'a warm lookup went back to the schema — entity() is reading entities() instead of cached()'
        );

        // Every lookup must still ANSWER. Without this, an entity() that
        // returned null for everything would satisfy the assertion above
        // perfectly, and the test would be pinning a broken layer.
        foreach (compact('entity', 'metric', 'late', 'department', 'status', 'name') as $what => $value) {
            $this->assertNotNull($value, "{$what} resolved to null — the layer answered nothing");
        }
    }

    /**
     * The memo in front of the cache is what makes the lookups above free, and
     * it is also the one thing `Cache::flush()` cannot clear. It deliberately
     * does not revalidate its fingerprint on a hit — that check IS the schema
     * walk — so it can only be made safe across a test run by being droppable,
     * which `Tests\TestCase::setUp()` relies on for every test in the suite.
     */
    public function test_the_memo_can_be_dropped_so_a_stale_layer_cannot_outlive_its_schema(): void
    {
        $before = SemanticLayer::cached();

        SemanticLayer::forgetCached();

        DB::enableQueryLog();
        $after = SemanticLayer::cached();

        $this->assertNotSame([], DB::getQueryLog(), 'forgetCached() did not drop the memo');
        $this->assertSame(array_keys($before), array_keys($after), 'the rebuilt layer disagrees with the dropped one');
    }

    /**
     * The layer is cached under a STATIC key, so a migration is the only thing
     * that can tell it the schema moved. That makes the listener in
     * `AppServiceProvider::boot()` load-bearing: unregistered, the cache goes
     * on describing columns that no longer exist until the day-long TTL expires.
     * A listener nobody tests is a listener that silently stops being registered,
     * so this fires the real event through the container rather than calling
     * `forgetCached()` directly — calling it directly would test the method and
     * prove nothing about the wiring.
     *
     * This single assertion covers BOTH caching layers, which is worth knowing
     * before anyone weakens it: if `forgetCached()` dropped only the memo and
     * left the cache entry, `Cache::remember()` would hit the store, return
     * without invoking its callback, and issue no query — and this would fail
     * exactly as it does when the listener is missing.
     */
    public function test_a_migration_rebuilds_the_layer(): void
    {
        SemanticLayer::cached();

        DB::enableQueryLog();
        SemanticLayer::metric('payroll', 'avg_net_pay');
        $this->assertSame([], DB::getQueryLog(), 'fixture assumption: the layer is warm before the migration');

        event(new MigrationsEnded('up'));

        DB::flushQueryLog();
        $metric = SemanticLayer::metric('payroll', 'avg_net_pay');

        $this->assertNotSame(
            [],
            DB::getQueryLog(),
            'MigrationsEnded did not invalidate the layer — is the listener still registered in AppServiceProvider::boot()?'
        );

        // And it rebuilt into something usable, rather than merely emptying.
        $this->assertNotNull($metric, 'the rebuilt layer answered nothing');
        $this->assertSame('curated', $metric['origin']);
    }
}
