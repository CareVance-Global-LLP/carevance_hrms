<?php

namespace App\Services\Ai;

use Illuminate\Support\Str;

/**
 * Picks the handful of entities a question is actually about, so the planner
 * prompt carries five entities instead of eighty.
 *
 * The schema derives to ~80 entities over 2,612 columns. Sending that catalogue
 * on every question would cost more tokens than the answer is worth, and would
 * grow every time somebody adds a table — planning latency would degrade as
 * coverage improved, which is exactly backwards. So retrieval runs FIRST, and
 * it runs LOCALLY: no model call, no embedding service, no network.
 *
 * Three ideas carry the whole thing:
 *
 *  1. An entity is reachable BY ITS OWN NAME. That is what makes 80 derived
 *     entities findable without an 80-entry map — the synonym map below only
 *     exists for the words that match no table name at all.
 *
 *  2. A token that matches EVERY entity names none of them. "status" is a
 *     column on attendance, leave, assets and tasks; returning all four is the
 *     same as returning nothing, except it costs a prompt and looks like an
 *     answer. So structural matches are weighted by how DISCRIMINATING the
 *     token is — inverse document frequency across the catalogue.
 *
 *  3. Every word is reduced to ONE canonical form, on both sides of the
 *     comparison. Emitting a word and its singular as two tokens double-counts
 *     any word the inflector rewrites: "beta" also yields "betum", so "beta"
 *     scored twice where "alpha" scored once and ties stopped being ties.
 */
final class EntityRetriever
{
    /** Below this, a match is noise and the question is refused instead. */
    private const FLOOR = 3.0;

    private const DEFAULT_TOP = 5;

    /** A synonym that names the entity outright — the strongest signal there is. */
    private const SYNONYM_NAMES = 10.0;

    /**
     * A synonym that points at the CONCEPT rather than one table. In a derived
     * schema "salary" should surface payroll_runs and payroll_monthly_runs
     * behind payroll_items, rather than only the one table named below.
     */
    private const SYNONYM_POINTS_AT = 5.0;

    /** Where a token matched matters: an entity's name beats a column's. */
    private const WEIGHTS = [
        'identity' => 6.0,   // entity key, label, table name
        'metric' => 4.0,
        'dimension' => 2.0,
        'column' => 1.0,
    ];

    /**
     * The words people use for things the schema calls something else. Nobody
     * types "payroll_items", and "wage" appears in no column name.
     *
     * Each target is either an entity KEY or a TABLE name, and the two forms
     * behave differently on purpose:
     *
     *   - a single word ("payroll") is a CONCEPT: it matches that entity
     *     exactly, and also any other entity whose own name carries the word —
     *     which is how sibling tables reach the prompt as secondary candidates.
     *   - a name with underscores ("payroll_items") is one specific table and is
     *     exact-match only, so "employee_work_infos" cannot drag in every table
     *     with "work" in its name.
     *
     * The hand-written and the derived catalogues are keyed differently
     * ("payroll" vs "payroll_items") and retrieval has to work on both, so
     * every concept lists both spellings.
     *
     * @var array<string, list<string>>
     */
    private const SYNONYMS = [
        // salary|pay|ctc|payroll|wage -> payroll
        'salary' => ['payroll', 'payroll_items'],
        'pay' => ['payroll', 'payroll_items'],
        'ctc' => ['payroll', 'payroll_items'],
        'payroll' => ['payroll', 'payroll_items'],
        'wage' => ['payroll', 'payroll_items'],
        'payslip' => ['payroll', 'payroll_items'],
        'compensation' => ['payroll', 'payroll_items'],
        'earning' => ['payroll', 'payroll_items'],
        'deduction' => ['payroll', 'payroll_items'],

        // absent|present|late|attendance -> attendance
        'absent' => ['attendance', 'attendance_records'],
        'present' => ['attendance', 'attendance_records'],
        'late' => ['attendance', 'attendance_records'],
        'attendance' => ['attendance', 'attendance_records'],
        'punch' => ['attendance', 'attendance_records'],
        'clock' => ['attendance', 'attendance_records'],
        'absence' => ['attendance', 'attendance_records'],

        // leave|holiday|pto|vacation -> leave
        'leave' => ['leave', 'leave_requests'],
        'holiday' => ['leave', 'leave_requests'],
        'pto' => ['leave', 'leave_requests'],
        'vacation' => ['leave', 'leave_requests'],
        'sick' => ['leave', 'leave_requests'],
        'casual' => ['leave', 'leave_requests'],

        /*
         * who|people|staff|employee|headcount -> employees
         *
         * Three targets, because in a derived schema the PERSON and their
         * EMPLOYMENT are different tables and a question about staff may need
         * either. Order here decides nothing — ties break on catalogue order.
         */
        'who' => ['employees', 'users', 'employee_work_infos'],
        'people' => ['employees', 'users', 'employee_work_infos'],
        'staff' => ['employees', 'users', 'employee_work_infos'],
        'employee' => ['employees', 'users', 'employee_work_infos'],
        'headcount' => ['employees', 'users', 'employee_work_infos'],
        'joiner' => ['employees', 'users', 'employee_work_infos'],
        'workforce' => ['employees', 'users', 'employee_work_infos'],
        'team' => ['employees', 'users', 'employee_work_infos'],

        // asset|laptop|device -> assets
        'asset' => ['assets'],
        'laptop' => ['assets'],
        'device' => ['assets'],
        'equipment' => ['assets'],
        'hardware' => ['assets'],

        // task|project|work -> work
        'task' => ['work', 'tasks'],
        'project' => ['work', 'tasks'],
        'work' => ['work', 'tasks'],
        'timesheet' => ['work', 'tasks'],
        'todo' => ['work', 'tasks'],

        // candidate|hiring|applicant|job -> hiring
        'candidate' => ['hiring', 'candidates'],
        'hiring' => ['hiring', 'candidates'],
        'applicant' => ['hiring', 'candidates'],
        'job' => ['hiring', 'candidates'],
        'recruitment' => ['hiring', 'candidates'],
        'interview' => ['hiring', 'candidates'],
        'offer' => ['hiring', 'candidates'],
        'opening' => ['hiring', 'candidates'],
        'vacancy' => ['hiring', 'candidates'],
    ];

    /** Words that carry no signal about WHICH entity is meant. */
    private const STOPWORDS = [
        'a', 'an', 'and', 'are', 'as', 'at', 'average', 'avg', 'be', 'by', 'compare',
        'count', 'created', 'do', 'each', 'every', 'find', 'for', 'from', 'get', 'give',
        'group', 'has', 'have', 'how', 'in', 'is', 'it', 'list', 'many', 'me', 'more',
        'most', 'much', 'my', 'of', 'on', 'or', 'our', 'per', 'show', 'sum', 'than',
        'that', 'the', 'their', 'then', 'there', 'this', 'to', 'top', 'total', 'value',
        'was', 'were', 'what', 'when', 'where', 'which', 'with', 'number', 'all',
    ];

    /**
     * The entities a question is about, ranked, capped at $top, and only those
     * above the floor. An empty return is a refusal — scoreAll() is what the
     * refusal reads to say what it considered.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return array<string, array<string, mixed>>  entity key => its definition
     */
    public static function forQuestion(string $question, array $catalogue, int $top = self::DEFAULT_TOP): array
    {
        /*
         * A caller that omits the cap sends null; one that means "no cap" sends
         * 0. Both mean "use the default" — honouring a 0 would starve the
         * prompt of every entity and refuse every question, which is the
         * mistake `limit` made in PlanValidator.
         */
        $top = $top > 0 ? $top : self::DEFAULT_TOP;

        $scores = self::scoreAll($question, $catalogue);

        /*
         * AN ENTITY THE QUESTION NAMED OUTRIGHT IS RESERVED A SLOT.
         *
         * Scoring alone let the SUBJECT of a sentence lose to its own
         * predicate. "list employees with no bank account" scored
         * `employee_bank_accounts` 105.6 and `employees` 18.7 — eighth, past
         * the cap, so the prompt never saw the entity the question was about
         * and the model answered "the employee master entity is not in this
         * system's catalogue". Four bank-named tables matched "bank" and
         * "account" structurally and buried the one word that was a naming.
         *
         * `SYNONYM_NAMES` already encodes the distinction: a synonym that
         * names an entity is a promise about which table is meant, not
         * evidence to be weighed against how many column names happen to
         * collide. Scoring it 10 and then letting 105 outrank it discards
         * that. So a named entity is placed first, and the remaining slots
         * are filled by score as before.
         *
         * The predicate's tables still come — they are what a cross-entity
         * filter would need — they just no longer come INSTEAD.
         */
        $picked = [];

        foreach (self::namedEntities($question, $catalogue) as $key) {
            if (count($picked) >= $top) {
                break;
            }

            $picked[$key] = $catalogue[$key];
        }

        foreach ($scores as $key => $score) {
            if (count($picked) >= $top) {
                break;
            }

            if ($score < self::FLOOR) {
                break; // ranked, so the first entity below the floor ends it
            }

            $picked[$key] = $catalogue[$key];
        }

        return $picked;
    }

    /**
     * The entities this question NAMED, best-scoring first.
     *
     * Naming is the `SYNONYM_NAMES` case of `synonymScore()` — the token
     * matched the entity key or its table, rather than pointing at a concept
     * one of its columns happens to carry.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return list<string>
     */
    private static function namedEntities(string $question, array $catalogue): array
    {
        $tokens = self::tokenise($question);
        $named = [];

        foreach ($catalogue as $key => $entity) {
            $table = (string) ($entity['table'] ?? $key);

            foreach ($tokens as $token) {
                /*
                 * A token that IS the entity's name names it, before any map is
                 * consulted. This case is not redundant with the synonym below:
                 * "project" is mapped to the `work` concept, whose table is
                 * `tasks`, so against a schema-derived catalogue the map named
                 * `tasks` and left the literal `projects` table to fight for a
                 * slot on score alone.
                 */
                $canonical = self::normalise($token);

                if ($canonical === self::normalise($key) || $canonical === self::normalise($table)) {
                    $named[] = $key;
                    continue 2;
                }

                foreach (self::synonymTargets($token) as $target) {
                    if ($target === $key || $target === $table) {
                        $named[] = $key;
                        continue 3;
                    }
                }
            }
        }

        if (count($named) < 2) {
            return $named;
        }

        // More than one entity named — "leave taken by employee" names both.
        // Order them by their own score so the stronger subject leads.
        $scores = self::scoreAll($question, $catalogue);
        usort($named, fn (string $left, string $right) => ($scores[$right] ?? 0.0) <=> ($scores[$left] ?? 0.0));

        return $named;
    }

    /**
     * Every entity with its score, ranked highest first, ties broken by
     * catalogue order.
     *
     * Entities that matched nothing score 0.0 and are still present: a refusal
     * has to be able to say what it considered, or "I can't answer that" gives
     * the reader nothing to rephrase against.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return array<string, float>
     */
    public static function scoreAll(string $question, array $catalogue): array
    {
        $tokens = self::tokenise($question);
        $documentFrequency = self::documentFrequency($catalogue);
        $entityCount = max(1, count($catalogue));

        $scores = [];
        $position = [];
        $index = 0;

        foreach ($catalogue as $key => $entity) {
            $position[$key] = $index++;
            $haystack = self::haystackFor($key, $entity);
            $table = is_string($entity['table'] ?? null) ? $entity['table'] : '';
            $score = 0.0;

            foreach ($tokens as $token) {
                $score += self::synonymScore($token, $key, $table, $haystack['identity']);

                // Structural matches, discounted by how many entities the token
                // reaches. A token on every table discriminates nothing.
                $reach = $documentFrequency[$token] ?? 0;

                if ($reach === 0) {
                    continue;
                }

                $idf = log($entityCount / $reach);

                if ($idf <= 0.0) {
                    continue; // on every entity — carries no signal at all
                }

                foreach (self::WEIGHTS as $field => $weight) {
                    if (isset($haystack[$field][$token])) {
                        $score += $weight * $idf;
                    }
                }
            }

            $scores[$key] = round($score, 4);
        }

        /*
         * Score descending, catalogue order on a tie. Written out rather than
         * leaning on PHP 8's stable sort, because "two entities scored the same
         * and we returned them in the order they are defined" is a rule a
         * reviewer should be able to read off the code.
         */
        uksort($scores, fn (string $a, string $b): int => ($scores[$b] <=> $scores[$a]) ?: ($position[$a] <=> $position[$b]));

        return $scores;
    }

    /**
     * What one token is worth to one entity as a synonym: it either NAMES the
     * entity or points at its concept, and the better of the two counts once.
     * Summing every matching target would score an entity twice for one word.
     *
     * @param  array<string, true>  $identity
     */
    private static function synonymScore(string $token, string $key, string $table, array $identity): float
    {
        $best = 0.0;

        foreach (self::synonymTargets($token) as $target) {
            if ($target === $key || $target === $table) {
                return self::SYNONYM_NAMES; // nothing beats naming the entity
            }

            if (! str_contains($target, '_') && isset($identity[self::normalise($target)])) {
                $best = max($best, self::SYNONYM_POINTS_AT);
            }
        }

        return $best;
    }

    /**
     * The map is looked up by canonical form, so the plural a person typed finds
     * the singular somebody wrote down — and so "people", whose canonical form
     * is "person", stays reachable at all.
     *
     * @return list<string>
     */
    private static function synonymTargets(string $token): array
    {
        static $normalised = null;

        if ($normalised === null) {
            $normalised = [];

            foreach (self::SYNONYMS as $word => $targets) {
                $normalised[self::normalise($word)] = $targets;
            }
        }

        return $normalised[$token] ?? [];
    }

    /**
     * How many entities each token reaches, for the IDF discount.
     *
     * @param  array<string, array<string, mixed>>  $catalogue
     * @return array<string, int>
     */
    private static function documentFrequency(array $catalogue): array
    {
        $frequency = [];

        foreach ($catalogue as $key => $entity) {
            $seen = [];

            foreach (self::haystackFor($key, $entity) as $bucket) {
                foreach (array_keys($bucket) as $token) {
                    $seen[$token] = true;
                }
            }

            foreach (array_keys($seen) as $token) {
                $frequency[$token] = ($frequency[$token] ?? 0) + 1;
            }
        }

        return $frequency;
    }

    /**
     * The searchable words of one entity, bucketed by where they came from.
     *
     * Keys are split on underscores, so `absent_days` is reachable by "absent"
     * and by "days" — people ask in words, not in column names.
     *
     * @param  array<string, mixed>  $entity
     * @return array<string, array<string, true>>
     */
    private static function haystackFor(string $key, array $entity): array
    {
        $buckets = ['identity' => [], 'metric' => [], 'dimension' => [], 'column' => []];

        $add = function (string $bucket, ?string $text) use (&$buckets): void {
            foreach (self::tokenise((string) $text) as $token) {
                $buckets[$bucket][$token] = true;
            }
        };

        $add('identity', $key);
        $add('identity', is_string($entity['label'] ?? null) ? $entity['label'] : null);
        $add('identity', is_string($entity['table'] ?? null) ? $entity['table'] : null);

        foreach (['metrics' => 'metric', 'dimensions' => 'dimension', 'list_columns' => 'column'] as $source => $bucket) {
            foreach ((array) ($entity[$source] ?? []) as $itemKey => $item) {
                $add($bucket, (string) $itemKey);
                $add($bucket, is_array($item) && is_string($item['label'] ?? null) ? $item['label'] : null);
            }
        }

        return $buckets;
    }

    /**
     * Lowercase, split on anything non-alphanumeric, drop stopwords, and reduce
     * each word to ONE canonical form.
     *
     * @return list<string>
     */
    private static function tokenise(string $text): array
    {
        $parts = preg_split('/[^a-z0-9]+/i', strtolower($text), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        $tokens = [];

        foreach ($parts as $part) {
            $canonical = self::normalise($part);

            if (strlen($canonical) < 2) {
                continue;
            }

            if (in_array($part, self::STOPWORDS, true) || in_array($canonical, self::STOPWORDS, true)) {
                continue;
            }

            $tokens[] = $canonical;
        }

        return array_values(array_unique($tokens));
    }

    /**
     * One word, one form. Singularising is what makes "salaries" reach payroll
     * and "laptops" reach assets; doing it on BOTH sides of every comparison is
     * what stops a word the inflector rewrites from scoring twice.
     */
    private static function normalise(string $word): string
    {
        return Str::singular(strtolower($word));
    }
}
