<?php

namespace Tests\Feature\Ai;

use App\Services\Ai\PlanValidator;
use App\Services\Ai\UnsupportedQuestionException;
use Tests\TestCase;

/**
 * The regression net.
 *
 * Renaming a metric, dropping a dimension, or swapping the planning model are
 * all changes that break AI mode silently — the endpoint still returns 200 and
 * the numbers just get quieter and wronger. This asserts the layer's contract
 * directly, with no vendor in the loop.
 */
class GoldenPlanTest extends TestCase
{
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

    public function test_the_fixture_covers_every_entity(): void
    {
        $covered = collect($this->golden['accepted'])->pluck('plan.entity')->unique();

        foreach (array_keys(\App\Services\Ai\SemanticLayer::entities()) as $entity) {
            $this->assertTrue($covered->contains($entity), "No golden plan covers '{$entity}'");
        }
    }

    public function test_the_fixture_covers_every_metric(): void
    {
        $covered = collect($this->golden['accepted'])
            ->map(fn ($case) => $case['plan']['entity'] . '.' . $case['plan']['metric'])
            ->unique();

        foreach (\App\Services\Ai\SemanticLayer::entities() as $entityKey => $entity) {
            foreach (array_keys($entity['metrics']) as $metricKey) {
                $this->assertTrue(
                    $covered->contains("{$entityKey}.{$metricKey}"),
                    "No golden plan covers '{$entityKey}.{$metricKey}'"
                );
            }
        }
    }
}
