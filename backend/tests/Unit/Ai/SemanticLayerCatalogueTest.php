<?php

namespace Tests\Unit\Ai;

use App\Services\Ai\EntityRetriever;
use App\Services\Ai\SemanticLayer;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * The planner prompt, and the reason a correct layer still answered wrong.
 *
 * `SemanticLayer::dimension('payroll', 'department')` has always existed and
 * has always joined `groups` correctly. Yet on 24 Aug 2026 the model refused
 * "compare average net pay by department" with *"department is not a supported
 * group-by dimension for the payroll entity"* — a refusal it had no business
 * issuing, and one no amount of testing the LAYER could have caught.
 *
 * The catalogue was the problem. All 149 entities went into every prompt
 * (~48,000 characters), and `payroll`'s share of it was a single ~2,500
 * character run-on line that merged its 95 group-by dimensions and its 94 list
 * columns into one `per/columns:` list of names. `department` was in there,
 * three-quarters of the way along. The model could not find it, so it
 * concluded it was not there.
 *
 * So this file tests the prompt as a READABLE DOCUMENT, because that is what
 * it is. Three properties carry it, and each maps to a way the run-on failed:
 *
 *  - every kind of name lives on its OWN labelled line, so "is department a
 *    group-by dimension?" is answered by a line that says `group_by`;
 *  - no line runs past 400 characters, so no name is buried mid-paragraph;
 *  - five entities fit in 6,000 characters, which is the budget the whole
 *    retrieval design exists to protect.
 *
 * RefreshDatabase: the catalogue is derived from the real schema.
 */
class SemanticLayerCatalogueTest extends TestCase
{
    use RefreshDatabase;

    /** The budget §13 exists to hold. Five retrieved entities, ~1.5k tokens. */
    private const BUDGET = 6000;

    /** Long enough for a real list, short enough that a name cannot hide in one. */
    private const MAX_LINE = 400;

    /**
     * DEFECT 1, stated as an assertion.
     *
     * `department` must be findable as a group-by dimension of `payroll`, and
     * `avg_net_pay` as a metric, and the two must be on DIFFERENT lines with
     * DIFFERENT labels — because a reader who cannot tell which list a name
     * came from cannot tell what the name is for.
     */
    public function test_a_group_by_dimension_and_a_metric_sit_on_distinguishable_lines(): void
    {
        $text = SemanticLayer::catalogueFor(['payroll']);

        $groupBy = self::lineNaming($text, 'group_by', 'department');
        $metrics = self::lineNaming($text, 'metrics', 'avg_net_pay');

        $this->assertNotNull(
            $groupBy,
            "'department' is not named on any group_by line of payroll's catalogue — this is the refusal regression"
        );
        $this->assertNotNull($metrics, "'avg_net_pay' is not named on any metrics line of payroll's catalogue");
        $this->assertNotSame($groupBy, $metrics, 'metrics and dimensions were emitted on the same line');
    }

    /**
     * The merge itself, refused by name. `per/columns:` printed one list under
     * a label that meant two things; whichever question the reader had, half
     * the names on the line were answering a different one.
     */
    public function test_dimensions_and_columns_are_never_merged_into_one_run(): void
    {
        foreach (self::sampleSets() as $label => $keys) {
            foreach (self::lines(SemanticLayer::catalogueFor($keys)) as $line) {
                $this->assertNotSame(
                    'per/columns',
                    self::labelOf($line),
                    "{$label}: dimensions and list columns are merged into one list again"
                );
            }
        }
    }

    /**
     * Curated metrics are named individually and MARKED, because their
     * definitions are hand-verified and a derived one's is not. A planner that
     * cannot tell them apart cannot prefer the verified one.
     */
    public function test_every_curated_metric_is_named_and_marked(): void
    {
        $keys = ['payroll', 'attendance', 'leave', 'employees'];
        $text = SemanticLayer::catalogueFor($keys);

        $named = [];

        foreach (self::linesLabelled($text, 'metrics (curated)') as $line) {
            array_push($named, ...self::namesOn($line));
        }

        foreach ($keys as $key) {
            foreach (SemanticLayer::entity($key)['metrics'] as $metric => $definition) {
                if (($definition['origin'] ?? null) !== 'curated') {
                    continue;
                }

                $this->assertTrue(
                    in_array($metric, $named, true),
                    "{$key}.{$metric} is curated and must be named on a marked metrics line"
                );
            }
        }
    }

    /** Only the named entities. Retrieval is pointless if the catalogue leaks the rest. */
    public function test_it_carries_only_the_named_entities(): void
    {
        $text = SemanticLayer::catalogueFor(['payroll']);

        $this->assertCount(1, self::linesLabelled($text, null), 'more than one entity header was emitted');

        foreach (['asset_count', 'late_count', 'leave_days_taken', 'headcount'] as $foreign) {
            $this->assertStringNotContainsString($foreign, $text, "an unrelated entity's metric reached the catalogue");
        }
    }

    /**
     * The budget the whole retrieval design exists to protect. Asserted in
     * characters so it does not depend on a tokeniser, over the five widest
     * entities the schema actually has — computed rather than hard-coded, so a
     * new wide table cannot quietly become the new worst case without this
     * noticing.
     */
    public function test_five_entities_stay_within_the_prompt_budget(): void
    {
        foreach (self::sampleSets() as $label => $keys) {
            $this->assertCount(5, $keys, "{$label}: fixture assumption — five entities");

            $length = strlen(SemanticLayer::catalogueFor($keys));

            $this->assertLessThan(
                self::BUDGET,
                $length,
                "{$label}: five entities cost {$length} characters — over the ".self::BUDGET.' budget'
            );
        }
    }

    /** A name three-quarters of the way along a 2,500 character line is a name nobody finds. */
    public function test_no_line_runs_past_the_readable_limit(): void
    {
        foreach (self::sampleSets() as $label => $keys) {
            foreach (self::lines(SemanticLayer::catalogueFor($keys)) as $number => $line) {
                $this->assertLessThan(
                    self::MAX_LINE,
                    strlen($line),
                    "{$label}: line {$number} is ".strlen($line).' characters — long enough to hide a name in'
                );
            }
        }
    }

    /**
     * Legibility bought by dropping vocabulary is not legibility, it is the
     * same refusal arriving quietly. Every group-by dimension the layer holds
     * must be NAMED on a group_by line, and every listable field must appear.
     */
    public function test_no_vocabulary_is_lost_to_the_layout(): void
    {
        foreach (['payroll', 'employees', 'attendance', 'leave'] as $key) {
            $entity = SemanticLayer::entity($key);
            $text = SemanticLayer::catalogueFor([$key]);

            $grouped = [];

            foreach (self::linesLabelled($text, 'group_by') as $line) {
                array_push($grouped, ...self::namesOn($line));
            }

            foreach (array_keys($entity['dimensions']) as $dimension) {
                $this->assertTrue(
                    in_array($dimension, $grouped, true),
                    "{$key}.{$dimension} is groupable but was not named on a group_by line"
                );
            }

            foreach (array_keys($entity['list_columns']) as $column) {
                $this->assertStringContainsString($column, $text, "{$key}.{$column} is listable but never appears");
            }
        }
    }

    /**
     * Compression only preserves coverage if every metric name remains
     * DERIVABLE. A column carrying all four of sum/avg/min/max is named once
     * on the numeric group-by line and the legend spells the prefixes out;
     * anything else is enumerated. Either way the name has to be reachable.
     */
    public function test_every_derived_metric_name_is_still_reachable(): void
    {
        $text = SemanticLayer::catalogueFor(['payroll']);
        $entity = SemanticLayer::entity('payroll');

        $named = [];

        foreach (self::lines($text) as $line) {
            if (self::labelOf($line) === null) {
                continue;
            }

            array_push($named, ...self::namesOn($line));
        }

        foreach ($entity['metrics'] as $metric => $definition) {
            if (in_array($metric, $named, true)) {
                continue; // enumerated literally
            }

            $column = $definition['column'];

            $this->assertNotNull($column, "payroll.{$metric} is neither named nor derivable");
            $this->assertTrue(
                in_array($column, $named, true),
                "payroll.{$metric} is not named and its column '{$column}' is not on a group_by line either"
            );
        }
    }

    public function test_an_unknown_or_empty_entity_set_produces_nothing(): void
    {
        $this->assertSame('', SemanticLayer::catalogueFor([]));
        $this->assertSame('', SemanticLayer::catalogueFor(['nationality', 'no_such_table']));
    }

    /**
     * End to end, on the question that actually failed. Retrieval picks the
     * entities, the catalogue describes them, and `department` has to survive
     * both steps — the layer being right about it is what made this defect so
     * hard to see.
     */
    public function test_the_question_that_regressed_reaches_a_catalogue_naming_department(): void
    {
        $retrieved = EntityRetriever::forQuestion(
            'compare average net pay by department',
            SemanticLayer::cached()
        );

        $this->assertArrayHasKey('payroll', $retrieved, 'retrieval did not even offer payroll');

        $text = SemanticLayer::catalogueFor(array_keys($retrieved));

        $this->assertNotNull(
            self::lineNaming($text, 'group_by', 'department'),
            'the prompt for the regressed question still does not name department as a group-by dimension'
        );
        $this->assertNotNull(self::lineNaming($text, 'metrics', 'avg_net_pay'));
        $this->assertLessThan(self::BUDGET, strlen($text));
    }

    /**
     * The sets every structural assertion runs over: the real retrieved sets
     * for the questions this work exists to answer, plus the five widest
     * entities in the schema, which is the worst case by construction.
     *
     * @return array<string, list<string>>
     */
    private static function sampleSets(): array
    {
        $catalogue = SemanticLayer::cached();

        $widths = [];

        foreach ($catalogue as $key => $entity) {
            $widths[$key] = count($entity['dimensions']) + count($entity['list_columns']);
        }

        arsort($widths);

        $sets = ['the five widest entities in the schema' => array_slice(array_keys($widths), 0, 5)];

        foreach ([
            'compare average net pay by department',
            'who was absent more than 3 days last month',
            'list employees who joined this year',
        ] as $question) {
            $sets["retrieved for '{$question}'"] = array_keys(EntityRetriever::forQuestion($question, $catalogue));
        }

        return $sets;
    }

    /** @return list<string> */
    private static function lines(string $text): array
    {
        return $text === '' ? [] : explode("\n", $text);
    }

    /**
     * The label before the first colon. Null for an entity header or a legend
     * line, neither of which carries one.
     */
    private static function labelOf(string $line): ?string
    {
        $trimmed = trim($line);

        if (str_starts_with($trimmed, '#') || str_starts_with($trimmed, '- ')) {
            return null;
        }

        $colon = strpos($trimmed, ':');

        return $colon === false ? null : substr($trimmed, 0, $colon);
    }

    /** @return list<string> */
    private static function namesOn(string $line): array
    {
        if (self::labelOf($line) === null) {
            return [];
        }

        $trimmed = trim($line);

        return array_map('trim', explode(',', substr($trimmed, strpos($trimmed, ':') + 1)));
    }

    /**
     * Lines whose label starts with $prefix — `group_by` matches both
     * `group_by:` and `group_by (numeric):`. Pass null for the entity headers.
     *
     * @return list<string>
     */
    private static function linesLabelled(string $text, ?string $prefix): array
    {
        $matched = [];

        foreach (self::lines($text) as $line) {
            if ($prefix === null) {
                if (str_starts_with(trim($line), '- ')) {
                    $matched[] = $line;
                }

                continue;
            }

            $label = self::labelOf($line);

            if ($label !== null && str_starts_with($label, $prefix)) {
                $matched[] = $line;
            }
        }

        return $matched;
    }

    /** The first line labelled $prefix that NAMES $name, or null if none does. */
    private static function lineNaming(string $text, string $prefix, string $name): ?string
    {
        foreach (self::linesLabelled($text, $prefix) as $line) {
            if (in_array($name, self::namesOn($line), true)) {
                return $line;
            }
        }

        return null;
    }
}
