<?php

namespace Tests\Feature\Ai;

use App\Services\Ai\PlanValidator;
use App\Services\Ai\UnsupportedQuestionException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The regression net.
 *
 * Renaming a metric, dropping a dimension, or swapping the planning model are
 * all changes that break AI mode silently — the endpoint still returns 200 and
 * the numbers just get quieter and wronger. This asserts the layer's contract
 * directly, with no vendor in the loop.
 *
 * RefreshDatabase: PlanValidator resolves every plan through SemanticLayer,
 * which now derives from the real schema.
 */
class GoldenPlanTest extends TestCase
{
    use RefreshDatabase;

    private PlanValidator $validator;
    private array $golden;

    protected function setUp(): void
    {
        parent::setUp();

        $this->validator = new PlanValidator();
        $this->golden = json_decode(
            file_get_contents(base_path('tests/Fixtures/ai/golden-plans.json')),
            true
        );
    }

    public function test_every_accepted_plan_validates(): void
    {
        foreach ($this->golden['accepted'] as $case) {
            try {
                $plan = $this->validator->validate($case['plan']);
                $this->assertSame($case['plan']['entity'], $plan['entity'], $case['question']);
            } catch (UnsupportedQuestionException $e) {
                $this->fail("'{$case['question']}' should validate but was refused: {$e->getDetail()}");
            }
        }
    }

    public function test_every_refused_plan_is_refused(): void
    {
        foreach ($this->golden['refused'] as $case) {
            try {
                $this->validator->validate($case['plan']);
                $this->fail("'{$case['question']}' should have been refused but validated.");
            } catch (UnsupportedQuestionException $e) {
                $this->assertNotEmpty($e->getDetail(), $case['question']);
            }
        }
    }

    /**
     * "Every entity" now means every CURATED entity, not every one of the ~80
     * SemanticLayer derives from the schema. Coverage of the derived surface
     * is already proven structurally, by SchemaIntrospectorTest — this fixture
     * pins the hand-verified surface, the one a wrong number could hide in.
     * Requiring 22 named questions to enumerate 80 schema tables would make
     * this fixture a second, weaker copy of SchemaIntrospectorTest's own
     * assertions rather than a check on curated correctness.
     */
    public function test_the_fixture_covers_every_entity(): void
    {
        $covered = collect($this->golden['accepted'])->pluck('plan.entity')->unique();

        foreach (\App\Services\Ai\SemanticLayer::entities() as $entity => $definition) {
            if (! self::hasCuratedMetric($definition)) {
                continue;
            }

            $this->assertTrue($covered->contains($entity), "No golden plan covers '{$entity}'");
        }
    }

    /** Same restriction as above, at metric granularity. */
    public function test_the_fixture_covers_every_metric(): void
    {
        $covered = collect($this->golden['accepted'])
            ->map(fn ($case) => $case['plan']['entity'] . '.' . $case['plan']['metric'])
            ->unique();

        foreach (\App\Services\Ai\SemanticLayer::entities() as $entityKey => $entity) {
            foreach ($entity['metrics'] as $metricKey => $metric) {
                if (($metric['origin'] ?? null) !== 'curated') {
                    continue;
                }

                $this->assertTrue(
                    $covered->contains("{$entityKey}.{$metricKey}"),
                    "No golden plan covers '{$entityKey}.{$metricKey}'"
                );
            }
        }
    }

    private static function hasCuratedMetric(array $entity): bool
    {
        foreach ($entity['metrics'] as $metric) {
            if (($metric['origin'] ?? null) === 'curated') {
                return true;
            }
        }

        return false;
    }
}
